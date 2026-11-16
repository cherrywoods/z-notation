// Shared controller for explainer popovers (hover = compact card, click = pinned card).
// Plain-TS API, usable from Svelte components and from the CodeMirror editor:
//
//   explain.show({ id, anchor: el.getBoundingClientRect(), ctx })          // hover
//   explain.show({ id, anchor, ctx, pinned: true })                        // click / tap
//   explain.hide()   // pointer left the symbol (short grace period; the card itself keeps it open)
//   explain.close()  // close everything, including a pinned card
//
// Optional `source`: the element the card belongs to. When given, the card follows it on
// scroll/resize, and clicks on it do not count as "outside" clicks.
// The layer (ExplainerLayer.svelte, mounted once in App.svelte) renders `explain.current`.

import type { ExplainerContext } from '../../lib/content/explainers';

export type { ExplainerContext };

export interface ShowRequest {
  id: string;
  anchor: DOMRect;
  ctx?: ExplainerContext;
  pinned?: boolean;
  /** Element the explainer belongs to (optional; improves positioning while scrolling). */
  source?: Element;
}

export interface ActiveExplainer {
  id: string;
  anchor: DOMRect;
  ctx?: ExplainerContext;
  pinned: boolean;
  source?: Element;
  /** Explainers visited inside a pinned card (for "back"). */
  history: { id: string; ctx?: ExplainerContext }[];
}

/** Hover delay before a card appears. */
export const HOVER_DELAY = 550;
/** Grace period after leaving a symbol (time to move the pointer into the card). */
export const HIDE_GRACE = 150;
/** After a card closed, hovering another symbol within this time shows it immediately. */
const WARM_WINDOW = 400;

const sameRect = (a: DOMRect, b: DOMRect) =>
  Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1;

const sameTarget = (a: { id: string; anchor: DOMRect; source?: Element }, b: ShowRequest) =>
  a.id === b.id && (a.source && b.source ? a.source === b.source : sameRect(a.anchor, b.anchor));

class ExplainController {
  /** The card currently shown (or null). */
  current = $state.raw<ActiveExplainer | null>(null);

  #showTimer: ReturnType<typeof setTimeout> | undefined;
  #hideTimer: ReturnType<typeof setTimeout> | undefined;
  #pending: ShowRequest | null = null;
  #lastClosed = 0;

  #open(req: ShowRequest, pinned: boolean) {
    this.current = { id: req.id, anchor: req.anchor, ctx: req.ctx, source: req.source, pinned, history: [] };
  }

  #clearTimers() {
    clearTimeout(this.#showTimer);
    clearTimeout(this.#hideTimer);
    this.#pending = null;
  }

  /** Show the explainer `id` next to `anchor` (after the hover delay unless pinned). */
  show = (req: ShowRequest): void => {
    clearTimeout(this.#hideTimer);
    const cur = this.current;

    if (req.pinned) {
      this.#clearTimers();
      // Clicking the symbol of the pinned card again closes it.
      if (cur?.pinned && cur.history.length === 0 && sameTarget(cur, req)) {
        this.close();
        return;
      }
      this.#open(req, true);
      return;
    }

    // Hover: never disturb a pinned card.
    if (cur?.pinned) return;
    if (cur) {
      // A hover card is open: switch to the new symbol right away.
      if (!sameTarget(cur, req)) this.#open(req, false);
      return;
    }
    if (this.#pending && sameTarget(this.#pending, req)) return; // already waiting for this one
    clearTimeout(this.#showTimer);
    if (performance.now() - this.#lastClosed < WARM_WINDOW) {
      this.#pending = null;
      this.#open(req, false);
      return;
    }
    this.#pending = req;
    this.#showTimer = setTimeout(() => {
      const r = this.#pending;
      this.#pending = null;
      if (r && !this.current?.pinned) this.#open(r, false);
    }, HOVER_DELAY);
  };

  /** Hide a hover (non-pinned) card after a short grace period. */
  hide = (): void => {
    clearTimeout(this.#showTimer);
    this.#pending = null;
    const cur = this.current;
    if (!cur || cur.pinned) return;
    clearTimeout(this.#hideTimer);
    this.#hideTimer = setTimeout(() => {
      if (this.current && !this.current.pinned) {
        this.current = null;
        this.#lastClosed = performance.now();
      }
    }, HIDE_GRACE);
  };

  /** Close everything, including a pinned card. */
  close = (): void => {
    this.#clearTimers();
    if (this.current) this.#lastClosed = performance.now();
    this.current = null;
  };

  /** Keep a hover card open (pointer entered the card). */
  keep = (): void => {
    clearTimeout(this.#hideTimer);
  };

  /** Turn the current hover card into a pinned card. */
  pin = (): void => {
    this.keep();
    const cur = this.current;
    if (cur && !cur.pinned) this.current = { ...cur, pinned: true };
  };

  /** Inside a card: show another explainer in the same (now pinned) card. */
  navigate = (id: string, ctx?: ExplainerContext): void => {
    this.keep();
    const cur = this.current;
    if (!cur) return;
    if (cur.id === id) {
      if (!cur.pinned) this.pin();
      return;
    }
    this.current = {
      ...cur,
      id,
      ctx: ctx ?? cur.ctx,
      pinned: true,
      history: [...cur.history, { id: cur.id, ctx: cur.ctx }],
    };
  };

  /** Inside a card: go back to the previously shown explainer. */
  back = (): void => {
    const cur = this.current;
    const prev = cur?.history.at(-1);
    if (!cur || !prev) return;
    this.current = { ...cur, id: prev.id, ctx: prev.ctx, history: cur.history.slice(0, -1) };
  };
}

export const explain = new ExplainController();
