<!--
  A derivation in the style of the lecture slides: a chain (= ⊆ ∈ ⇔ ⇒ steps) or premises
  ⊢ conclusion, each step with its reason in brackets. Used by the inference panel and
  the goal list's hover card.
-->
<script lang="ts">
  import type { Derivation } from '../../lib/spec/model';
  import type { ExplainerContext } from '../explain/explain.svelte';
  import ZText from '../z/ZText.svelte';

  let { d, given, ctx }: { d: Derivation; given: string[]; ctx?: ExplainerContext } = $props();
</script>

<div class="grid">
  {#if d.kind === 'chain'}
    <span class="rel"></span><span class="expr"><ZText text={d.start} givenSets={given} {ctx} /></span><span class="why"></span>
    {#each d.steps as s, i (i)}
      <span class="rel">{s.rel}</span>
      <span class="expr"><ZText text={s.expr} givenSets={given} {ctx} /></span>
      <span class="why">[{s.reason}]</span>
    {/each}
  {:else}
    {#each d.premises as p, i (i)}
      <span class="rel"></span>
      <span class="expr"><ZText text={p.text} givenSets={given} {ctx} /></span>
      <span class="why">[{p.reason}]</span>
    {/each}
    <span class="rel">⊢</span>
    <span class="expr"><ZText text={d.conclusion} givenSets={given} {ctx} /></span>
    <span class="why"></span>
  {/if}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: 1.1em minmax(0, max-content) minmax(max-content, 1fr);
    column-gap: 8px;
    row-gap: 1px;
    align-items: baseline;
  }
  .rel {
    font-family: var(--font-z);
    color: var(--fg);
    text-align: center;
  }
  .expr :global(.z-text) {
    font-size: calc(1rem * var(--z-scale, 1));
  }
  .why {
    justify-self: end;
    font-size: 0.78rem;
    color: var(--ui-fg);
    white-space: nowrap;
  }
</style>
