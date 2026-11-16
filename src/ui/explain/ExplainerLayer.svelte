<script lang="ts">
  // Renders the explainer popover (one at a time); mounted once in App.svelte.
  // Positions the card next to its anchor (below, or above when there is no room),
  // keeps it inside the viewport, follows the anchor on scroll/resize, and closes on
  // Esc / outside click.
  import { untrack } from 'svelte';
  import { scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import type { Attachment } from 'svelte/attachments';
  import { explain } from './explain.svelte';
  import { getExplainer } from '../../lib/content/explainers';
  import ExplainerCard from './ExplainerCard.svelte';

  const TOOLTIP_ID = 'z-explainer-tooltip';
  const TITLE_ID = 'z-explainer-title';
  const MARGIN = 8; // min distance to the viewport edge
  const GAP = 9; // distance to the anchor
  const MIN_H = 140;

  const cur = $derived(explain.current);
  const ex = $derived(cur ? getExplainer(cur.id, cur.ctx) : undefined);

  let wrap = $state<HTMLDivElement>();
  let pos = $state({ left: 0, top: 0, caret: 24, below: true, maxH: 600, caretShown: true });
  let placedFor: unknown = null; // the anchor the current placement was chosen for

  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  function anchorRect(): DOMRect | null {
    const c = explain.current;
    if (!c) return null;
    if (c.source?.isConnected) {
      const r = c.source.getBoundingClientRect();
      if (r.width || r.height) return r;
    }
    return c.anchor;
  }

  function place() {
    const el = wrap;
    const card = el?.firstElementChild as HTMLElement | null;
    const a = anchorRect();
    if (!el || !card || !a) return;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const w = card.offsetWidth;
    const h = card.scrollHeight + 2; // natural height (incl. border), even when clamped

    const spaceBelow = vh - MARGIN - (a.bottom + GAP);
    const spaceAbove = a.top - GAP - MARGIN;
    const fits = (below: boolean) => h <= (below ? spaceBelow : spaceAbove);
    // Keep the side chosen for this anchor while it still fits (no jumping when the card grows).
    let below: boolean;
    if (placedFor === explain.current?.anchor && fits(pos.below)) below = pos.below;
    else below = fits(true) || (!fits(false) && spaceBelow >= spaceAbove);
    placedFor = explain.current?.anchor;

    const maxH = Math.max(MIN_H, Math.min(vh - 2 * MARGIN, below ? spaceBelow : spaceAbove));
    const hh = Math.min(h, maxH);
    const top = clamp(below ? a.bottom + GAP : a.top - GAP - hh, MARGIN, Math.max(MARGIN, vh - MARGIN - hh));
    const cx = a.left + a.width / 2;
    const left = clamp(cx - w / 2, MARGIN, Math.max(MARGIN, vw - MARGIN - w));
    const caret = clamp(cx - left, 16, w - 16);
    // Only point at the anchor when the card actually sits next to it.
    const caretShown = below ? Math.abs(top - (a.bottom + GAP)) < 1 : Math.abs(top + hh - (a.top - GAP)) < 1;
    pos = { left, top, caret, below, maxH, caretShown };
  }

  // (Re)place whenever the card or its content changes size.
  $effect(() => {
    const el = wrap;
    void cur;
    void ex;
    if (!el) return;
    untrack(place);
    const ro = new ResizeObserver(() => place());
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  });

  // Global listeners: Esc, outside clicks, scroll and resize.
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && explain.current) explain.close();
    };
    const onDown = (e: PointerEvent) => {
      const c = explain.current;
      if (!c) return;
      const t = e.target;
      if (!(t instanceof Node) || wrap?.contains(t)) return;
      // Clicks on explainable symbols are handled by their own click (re-pin / toggle).
      if (t instanceof Element && t.closest('[data-explain]')) return;
      if (c.source?.contains(t)) return;
      explain.close();
    };
    const onScroll = (e: Event) => {
      const c = explain.current;
      if (!c) return;
      if (wrap && e.target instanceof Node && wrap.contains(e.target)) return;
      // A hover card without a live anchor element cannot follow: hide it.
      if (!c.pinned && !c.source?.isConnected) explain.close();
      else place();
    };
    const onResize = () => place();
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onResize);
    };
  });

  // Mark the symbol whose card is open (only for our own ZText spans; editors manage their DOM).
  $effect(() => {
    const c = cur;
    const src = c?.source;
    if (!c || !(src instanceof HTMLElement) || !src.closest('[data-ztext]')) return;
    src.classList.add('z-explain-active');
    if (!c.pinned) src.setAttribute('aria-describedby', TOOLTIP_ID);
    return () => {
      src.classList.remove('z-explain-active');
      src.removeAttribute('aria-describedby');
    };
  });

  // Pointer inside the card keeps it open; a click on a hover card pins it.
  const cardEvents: Attachment<HTMLDivElement> = (el) => {
    const enter = () => explain.keep();
    const leave = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && !explain.current?.pinned) explain.hide();
    };
    const click = () => {
      if (explain.current && !explain.current.pinned) explain.pin();
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('click', click);
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('click', click);
    };
  };
</script>

{#if cur && ex}
  <div
    bind:this={wrap}
    class="explainer"
    class:above={!pos.below}
    id={cur.pinned ? undefined : TOOLTIP_ID}
    role={cur.pinned ? 'dialog' : 'tooltip'}
    aria-modal={cur.pinned ? 'false' : undefined}
    aria-labelledby={TITLE_ID}
    style:left="{pos.left}px"
    style:top="{pos.top}px"
    style:--explainer-max-h="{pos.maxH}px"
    style:--caret-x="{pos.caret}px"
    style:transform-origin="{pos.caret}px {pos.below ? 'top' : 'bottom'}"
    transition:scale={{ start: 0.94, opacity: 0, duration: reduceMotion ? 0 : 150, easing: cubicOut }}
    {@attach cardEvents}
  >
    <ExplainerCard
      {ex}
      ctx={cur.ctx}
      pinned={cur.pinned}
      canBack={cur.history.length > 0}
      titleId={TITLE_ID}
      onclose={explain.close}
      onback={explain.back}
    />
    {#if pos.caretShown}<span class="caret" aria-hidden="true"></span>{/if}
  </div>
{/if}

<style>
  .explainer {
    position: fixed;
    z-index: 1000;
    max-width: calc(100vw - 16px);
  }
  .caret {
    position: absolute;
    left: var(--caret-x);
    top: -5px;
    width: 10px;
    height: 10px;
    margin-left: -5px;
    background: var(--bg);
    border-left: 1px solid var(--border);
    border-top: 1px solid var(--border);
    transform: rotate(45deg);
    pointer-events: none;
  }
  .above .caret {
    top: auto;
    bottom: -5px;
    transform: rotate(225deg);
  }
  @media print {
    .explainer {
      display: none;
    }
  }
</style>
