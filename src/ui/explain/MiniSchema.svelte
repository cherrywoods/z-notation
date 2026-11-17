<script lang="ts">
  // A small Z schema box (name in the top rule, declarations, line, predicates).
  // Inside a card, a click on the box's rules opens the 'schema' explainer in the card.
  import type { Attachment } from 'svelte/attachments';
  import ZText from '../z/ZText.svelte';
  import { explain } from './explain.svelte';
  import type { ExplainerContext, SchemaSketch } from '../../lib/content/explainers';

  let { schema, ctx }: { schema: SchemaSketch; ctx?: ExplainerContext } = $props();

  const frame: Attachment<HTMLElement> = (el) => {
    const click = (e: MouseEvent) => {
      if (e.target !== el) return; // text inside the box has its own explainers
      explain.navigate('schema', ctx);
    };
    el.addEventListener('click', click);
    return () => el.removeEventListener('click', click);
  };
</script>

<div class="zbox">
  <div class="top">
    <span class="corner" data-explain="schema" {@attach frame}></span>
    <ZText text={schema.name} {ctx} nested class="name" />
    <span class="rule" data-explain="schema" {@attach frame}></span>
  </div>
  <div class="body" data-explain="schema" {@attach frame}>
    <ZText text={schema.decls} {ctx} nested block />
    {#if schema.preds}
      <div class="mid" data-explain="schema" {@attach frame}></div>
      <ZText text={schema.preds} {ctx} nested block />
    {/if}
  </div>
</div>

<style>
  .zbox {
    --line: 1.25px solid var(--fg);
    font-size: 15px;
    line-height: 1.55;
    max-width: 100%;
  }
  .zbox :global(.z-text) {
    font-size: inherit;
    line-height: inherit;
  }
  .top {
    display: flex;
    align-items: stretch;
    gap: 6px;
  }
  .corner {
    width: 8px;
    flex: none;
    margin-top: 0.8em;
    border-top: var(--line);
    border-left: var(--line);
  }
  .rule {
    flex: 1;
    min-width: 16px;
    align-self: flex-start;
    margin-top: 0.8em;
    border-top: var(--line);
  }
  .body {
    border-left: var(--line);
    border-bottom: var(--line);
    padding: 0 0 5px 14px;
    cursor: auto;
  }
  /* the rules: pointer as for other links inside a card */
  .corner,
  .rule,
  .mid {
    cursor: pointer;
    position: relative;
  }
  .corner::after,
  .rule::after,
  .mid::after {
    content: '';
    position: absolute;
    inset: -5px -2px -4px;
  }
  .mid {
    border-top: var(--line);
    margin: 4px 0 3px -14px;
  }
</style>
