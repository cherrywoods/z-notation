<script lang="ts">
  // Read-only Z schema box (same geometry as the editable SchemaBox), for the
  // specification view and the printout.
  import ZText from '../z/ZText.svelte';
  import type { ExplainerContext } from '../../lib/content/explainers';

  interface Props {
    name: string;
    decls: string;
    preds: string;
    givenSets?: string[];
    ctx?: ExplainerContext;
  }
  let { name, decls, preds, givenSets, ctx }: Props = $props();
</script>

<div class="schema">
  <div class="top">
    <span class="rule lead"></span>
    <span class="name">{name}</span>
    <span class="rule fill"></span>
  </div>
  <div class="part"><ZText text={decls} {givenSets} {ctx} block /></div>
  {#if preds.trim()}
    <div class="divider"></div>
    <div class="part"><ZText text={preds} {givenSets} {ctx} block /></div>
  {/if}
</div>

<style>
  .schema {
    --rule: 1.5px solid var(--fg);
    position: relative;
    margin-top: 1em;
    padding: 0.95em 0 0.55em 14px;
    border-left: var(--rule);
    border-bottom: var(--rule);
    break-inside: avoid;
    font-size: 1.1rem;
  }
  .top {
    position: absolute;
    top: -0.9em;
    left: -1.5px;
    right: 0;
    height: 1.8em;
    display: flex;
    align-items: center;
  }
  .rule {
    border-top: var(--rule);
    height: 0;
  }
  .lead {
    width: 14px;
    flex: none;
  }
  .fill {
    flex: 1;
  }
  .name {
    font-family: var(--font-z);
    font-style: normal;
    padding: 0 6px;
  }
  .part {
    padding: 0 4px;
  }
  .part :global(.z-text) {
    font-size: 1.1rem;
  }
  .divider {
    margin: 0.3em 0 0.35em -14px;
    width: min(45%, 300px);
    border-top: var(--rule);
  }
</style>
