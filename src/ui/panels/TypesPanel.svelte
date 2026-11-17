<script lang="ts">
  // Side panel of the Types step: what the types contain. Given sets list their
  // (editable) example values; the number types are always available.
  import PoolEditor from '../views/PoolEditor.svelte';
  import ZText from '../z/ZText.svelte';
  import { givenNames } from '../../lib/spec/helpers';
  import { store } from '../../lib/spec/store.svelte';
  import type { SpecDoc } from '../../lib/spec/model';

  let { spec }: { spec: SpecDoc } = $props();
  // edits go to the store's state (not through the prop)
  const doc = $derived(store.current ?? spec);

  const names = $derived(givenNames(doc.given));

  /** Example values of a given set: its pool, or name1, name2, … */
  const poolOf = (name: string) => doc.pools[name] ?? [1, 2, 3, 4, 5].map((i) => `${name.toLowerCase()}${i}`);
  const isInfinite = (name: string) => (doc.infinite ?? []).includes(name);

  function update(name: string, values: string[], infinite: boolean) {
    doc.pools[name] = values;
    const rest = (doc.infinite ?? []).filter((n) => n !== name);
    doc.infinite = infinite ? [...rest, name] : rest;
  }

  const BUILTIN = [{ text: 'ℕ = {0, 1, 2, …}' }, { text: 'ℕ₁ = {1, 2, 3, …}' }, { text: 'ℤ = {…, -1, 0, 1, …}' }];
</script>

<section class="panel" aria-label="Types">
  <h2>Types</h2>
  {#if names.length}
    <div class="rows">
      {#each names as n (n)}
        <PoolEditor name={n} values={poolOf(n)} infinite={isInfinite(n)} onchange={(v, inf) => update(n, v, inf)} />
      {/each}
    </div>
  {/if}
  <div class="builtin" class:first={!names.length}>
    <h3>Always available</h3>
    <ul>
      {#each BUILTIN as b (b.text)}
        <li><ZText text={b.text} /></li>
      {/each}
    </ul>
  </div>
</section>

<style>
  .panel {
    min-width: 0;
    background: var(--bg-sunken);
    border: 1px solid var(--edge-sunken);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sunken);
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
    /* a very long set name may take at most 40% and wraps */
    grid-template-columns: fit-content(40%) max-content minmax(0, 1fr);
    column-gap: 8px;
    align-items: baseline;
  }
  .builtin {
    margin: 12px 0 0;
    padding: 10px 0 0;
    border-top: 1px solid var(--ui-border);
  }
  .builtin.first {
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }
  h3 {
    margin: 0 0 4px;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--ui-fg);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .builtin :global(.z-text) {
    font-size: calc(1.05rem * var(--z-scale, 1));
  }
  @media (max-width: 899px) {
    .panel {
      position: static;
    }
  }
</style>
