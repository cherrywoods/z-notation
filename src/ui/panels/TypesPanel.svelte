<script lang="ts">
  // Side panel of the Types step: what the types contain. Given sets list their
  // (editable) example values; the number types are always available.
  import PoolEditor from '../views/PoolEditor.svelte';
  import ZText from '../z/ZText.svelte';
  import { givenNames } from '../../lib/spec/helpers';
  import type { SpecDoc } from '../../lib/spec/model';

  let { spec }: { spec: SpecDoc } = $props();

  const names = $derived(givenNames(spec.given));

  /** Example values of a given set: its pool, or name1, name2, … */
  const poolOf = (name: string) => spec.pools[name] ?? [1, 2, 3, 4, 5].map((i) => `${name.toLowerCase()}${i}`);
  const isInfinite = (name: string) => (spec.infinite ?? []).includes(name);

  function update(name: string, values: string[], infinite: boolean) {
    spec.pools[name] = values;
    const rest = (spec.infinite ?? []).filter((n) => n !== name);
    spec.infinite = infinite ? [...rest, name] : rest;
  }

  const BUILTIN = [
    { text: 'ℕ = {0, 1, 2, …}', ascii: 'NN' },
    { text: 'ℕ₁ = {1, 2, 3, …}', ascii: 'NN1' },
    { text: 'ℤ = {…, -1, 0, 1, …}', ascii: 'ZZ' },
    { text: 'ℝ = {…, -1.5, 0, 0.25, 1, …}', ascii: 'RR' },
  ];
</script>

<section class="panel" aria-label="Types">
  <h2>Example</h2>
  {#if names.length}
    <div class="rows">
      {#each names as n (n)}
        <PoolEditor name={n} values={poolOf(n)} infinite={isInfinite(n)} onchange={(v, inf) => update(n, v, inf)} />
      {/each}
    </div>
  {/if}
  <ul class="builtin" aria-label="Always available">
    {#each BUILTIN as b (b.ascii)}
      <li><ZText text={b.text} /><kbd>{b.ascii}</kbd></li>
    {/each}
  </ul>
</section>

<style>
  .panel {
    background: var(--ui-bg);
    border: 1px solid var(--ui-border);
    border-radius: var(--radius);
    padding: 12px 18px 16px;
    position: sticky;
    top: calc(var(--header-h) + 16px);
  }
  h2 {
    margin: 0 0 6px;
    min-height: 32px;
    display: flex;
    align-items: center;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ui-fg);
  }
  .rows {
    display: grid;
    grid-template-columns: max-content max-content minmax(0, 1fr);
    column-gap: 8px;
    align-items: baseline;
  }
  .builtin {
    list-style: none;
    margin: 12px 0 0;
    padding: 10px 0 0;
    border-top: 1px solid var(--ui-border);
    display: grid;
    gap: 2px;
  }
  .builtin li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .builtin :global(.z-text) {
    font-size: 1.05rem;
  }
  kbd {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    color: var(--ui-fg);
    padding: 1px 6px;
    border: 1px solid var(--ui-border);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: var(--bg);
  }
  @media (max-width: 899px) {
    .panel {
      position: static;
    }
  }
</style>
