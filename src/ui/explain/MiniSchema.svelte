<script lang="ts">
  // A small Z schema box (name in the top rule, declarations, line, predicates).
  import ZText from '../z/ZText.svelte';
  import type { ExplainerContext, SchemaSketch } from '../../lib/content/explainers';

  let { schema, ctx }: { schema: SchemaSketch; ctx?: ExplainerContext } = $props();
</script>

<div class="zbox">
  <div class="top">
    <span class="corner"></span>
    <ZText text={schema.name} {ctx} nested class="name" />
    <span class="rule"></span>
  </div>
  <div class="body">
    <ZText text={schema.decls} {ctx} nested block />
    {#if schema.preds}
      <div class="mid"></div>
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
  }
  .mid {
    border-top: var(--line);
    margin: 4px 0 3px -14px;
  }
</style>
