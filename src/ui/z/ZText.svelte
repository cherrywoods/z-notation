<script lang="ts">
  // Static rendering of Z text with highlighting and explainers.
  // Hover a symbol → compact explainer card; click/tap → pinned card.
  // Inside an explainer card (`nested`), clicking a symbol shows its explainer in the same card.
  import type { Attachment } from 'svelte/attachments';
  import { explain, type ExplainerContext, type ShowRequest } from '../explain/explain.svelte';
  import { zPieces } from './segments';

  interface Props {
    /** Z text (unicode; ASCII shortcuts are accepted, too). */
    text: string;
    /** Names of given sets (coloured as types). */
    givenSets?: string[];
    /** Context for Δ/Ξ explainers (state name and variables). */
    ctx?: ExplainerContext;
    /** Render as a block: newlines start new lines. */
    block?: boolean;
    /** false: highlighting only, no explainers. */
    interactive?: boolean;
    /** Inside an explainer card: no hover cards; a click navigates the card. */
    nested?: boolean;
    class?: string;
  }

  let {
    text,
    givenSets,
    ctx,
    block = false,
    interactive = true,
    nested = false,
    class: klass = '',
  }: Props = $props();

  const pieces = $derived(zPieces(text, givenSets, ctx));

  const listeners: Attachment<HTMLElement> = (root) => {
    let hovered: HTMLElement | null = null;

    const find = (e: Event): HTMLElement | null => {
      const t = e.target;
      const el = t instanceof Element ? t.closest('[data-explain]') : null;
      return el instanceof HTMLElement && root.contains(el) ? el : null;
    };
    const request = (el: HTMLElement): ShowRequest | null => {
      const p = pieces[Number(el.dataset.i)];
      if (!p?.explain) return null;
      return { id: p.explain, anchor: el.getBoundingClientRect(), ctx: p.ctx, source: el };
    };

    // Highlight all pieces of the hovered construct (e.g. both braces and the bar).
    const groupHover = (el: HTMLElement | null, on: boolean) => {
      const g = el?.dataset.group;
      if (!g) return;
      for (const x of root.querySelectorAll(`[data-group="${g}"]`)) x.classList.toggle('z-group-hover', on);
    };

    const over = (e: PointerEvent) => {
      if (!interactive || e.pointerType === 'touch') return;
      const el = find(e);
      if (!el || el === hovered) return;
      hovered = el;
      groupHover(el, true);
      if (nested) return;
      const req = request(el);
      if (req) explain.show(req);
    };
    const out = (e: PointerEvent) => {
      if (!hovered) return;
      const to = e.relatedTarget;
      if (to instanceof Node && hovered.contains(to)) return;
      groupHover(hovered, false);
      hovered = null;
      if (!nested) explain.hide();
    };
    const click = (e: MouseEvent) => {
      if (!interactive) return;
      const el = find(e);
      const req = el && request(el);
      if (!req) return;
      if (nested) explain.navigate(req.id, req.ctx);
      else explain.show({ ...req, pinned: true });
    };

    root.addEventListener('pointerover', over);
    root.addEventListener('pointerout', out);
    root.addEventListener('click', click);
    return () => {
      root.removeEventListener('pointerover', over);
      root.removeEventListener('pointerout', out);
      root.removeEventListener('click', click);
      if (hovered && !nested) explain.hide();
    };
  };
</script>

<!-- Keep the markup on one line: whitespace inside would show up in the rendered Z. -->
<svelte:element this={block ? 'div' : 'span'} class="z-text ztext {klass}" class:block class:nested data-ztext {@attach listeners}>{#each pieces as p, i}{#if p.parts}<span class={p.cls} data-explain={interactive ? p.explain : undefined} data-i={p.explain ? i : undefined}>{#each p.parts as q}<span class={q.cls}>{q.text}</span>{/each}</span>{:else if p.cls}<span class={p.cls} data-explain={interactive ? p.explain : undefined} data-i={p.explain ? i : undefined} data-group={p.group}>{p.text}</span>{:else}{p.text}{/if}{/each}</svelte:element>

<style>
  .ztext {
    white-space: pre-wrap;
    /* very long names break instead of widening the page */
    overflow-wrap: anywhere;
    word-spacing: 0.06em;
  }
  .ztext.block {
    display: block;
  }
  .ztext :global(.z-value) {
    font-style: normal;
  }
  .ztext :global(.z-schema-ref),
  .ztext :global(.z-decorated) {
    white-space: nowrap;
  }
  .ztext :global([data-explain]) {
    border-radius: 3px;
    transition: background-color 0.12s;
  }
  .ztext :global([data-explain]:hover),
  .ztext:not(.nested) :global(.z-group-hover),
  .ztext :global(.z-explain-active) {
    background: var(--bg-hover);
  }
  .ztext:not(.nested) :global(.z-explain-active) {
    box-shadow: 0 0 0 2px var(--bg-hover);
  }
  .nested :global([data-explain]) {
    cursor: pointer;
  }
  .nested :global([data-explain]:hover),
  .nested :global(.z-group-hover) {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
    text-decoration-thickness: 1px;
  }
</style>
