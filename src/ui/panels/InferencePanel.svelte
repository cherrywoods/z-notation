<script lang="ts">
  // Facts that follow from the spec, with the derivation steps shown (in the style of
  // the lecture slides), plus lines that restate something already implied.
  import { slide } from 'svelte/transition';
  import { live } from '../../lib/spec/live.svelte';
  import { explainCtxOf, givenNames } from '../../lib/spec/helpers';
  import type { Derivation } from '../../lib/spec/model';
  import ZText from '../z/ZText.svelte';
  import DerivationView from './DerivationView.svelte';

  let { schemaId }: { schemaId: string } = $props();

  const given = $derived(live.spec ? givenNames(live.spec.given) : []);
  const ctx = $derived(live.spec ? explainCtxOf(live.spec) : undefined);

  type Item = { key: string; text: string; tag: string; note: string; reason?: string; derivation?: Derivation };

  /** `x ∈ dom f` → `f(x)` (for "defined" facts). */
  function application(text: string): string | null {
    const m = /^(.+) ∈ dom (.+)$/.exec(text);
    if (!m) return null;
    const f = /^[\p{L}_][\p{L}\p{N}_′?!]*$/u.test(m[2]) ? m[2] : `(${m[2]})`;
    return `${f}(${m[1]})`;
  }

  const items = $derived.by((): Item[] => {
    const inf = live.inferred;
    if (!inf) return [];
    // most telling first: what the invariant guarantees, then effects and consequences
    const ORDER: Record<string, number> = { guaranteed: 0, effect: 1, implied: 2, initial: 3, defined: 4 };
    const mine = inf.facts.filter((f) => f.schemaId === schemaId).sort(
      (a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9),
    );
    const facts: Item[] = [];
    // Ξ: all "v′ = v" facts in one line
    // "v′ = v" facts (from Ξ, or for variables an operation does not mention) are not
    // shown: they only restate the import and add noise (lecturer's decision).
    for (const f of mine) {
      if (f.kind === 'unchanged') continue;
      const d = f.derivation;
      // "x ∈ dom f [precondition] ⊢ x ∈ dom f" says nothing new
      if (d.kind === 'facts' && d.premises.length === 1 && d.premises[0].text === d.conclusion) continue;
      const app = f.kind === 'defined' ? application(f.text) : null;
      const tag = app
        ? 'defined'
        : f.kind === 'guaranteed'
          ? 'guaranteed by the invariant'
          : ((f as { note?: string }).note ?? '');
      facts.push({ key: `f:${f.text}`, text: app ?? f.text, tag, note: '', derivation: d });
    }
    const redundant = inf.redundant
      .filter((d) => d.section.schemaId === schemaId && d.derivation)
      .map((d) => ({ key: `r:${d.from}:${d.message}`, text: '', tag: '', note: d.message, derivation: d.derivation! }));
    return [...facts, ...redundant];
  });

  let collapsed = $state<Record<string, boolean>>({});
</script>

{#if items.length}
  <section class="panel" aria-label="Inference">
    <header><h2>Inference</h2></header>
    <ul>
      {#each items as it (it.key)}
        <li>
          {#if !it.derivation}
            <div class="fact plain">
              <span class="chev" aria-hidden="true"></span>
              <ZText text={it.text} givenSets={given} {ctx} interactive={false} />
              <span class="why">[{it.reason}]</span>
            </div>
          {:else}
          <button
            type="button"
            class="fact"
            aria-expanded={!collapsed[it.key]}
            onclick={() => (collapsed[it.key] = !collapsed[it.key])}
          >
            <span class="chev" class:closed={collapsed[it.key]} aria-hidden="true">›</span>
            {#if it.text}
              <ZText text={it.text} givenSets={given} {ctx} interactive={false} />
              {#if it.tag}<span class="tag">{it.tag}</span>{/if}
            {:else}
              <span class="note">{it.note}</span>
            {/if}
          </button>
          {#if !collapsed[it.key]}
            <div class="steps" transition:slide={{ duration: 180 }}>
              <DerivationView d={it.derivation} {given} {ctx} />
            </div>
          {/if}
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}


<style>
  .panel {
    background: var(--bg-sunken);
    border: 1px solid var(--edge-sunken);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sunken);
    padding: 12px 18px 14px;
  }
  header {
    min-height: 32px;
    display: flex;
    align-items: center;
  }
  h2 {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ui-fg);
  }
  ul {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .fact {
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    padding: 2px 0;
    border: none;
    background: none;
    text-align: left;
    cursor: pointer;
    color: var(--fg);
  }
  .fact :global(.z-text) {
    font-size: calc(1.05rem * var(--z-scale, 1));
  }
  .fact.plain {
    cursor: default;
  }
  .fact.plain .why {
    margin-left: auto;
  }
  .chev {
    display: inline-block;
    width: 0.9em;
    color: var(--ui-fg);
    transform: rotate(90deg);
    transition: transform 0.18s var(--ease-out);
  }
  .chev.closed {
    transform: none;
  }
  .tag {
    font-size: 0.78rem;
    color: var(--ui-fg);
  }
  .note {
    font-size: 0.9rem;
    color: var(--ui-fg-strong);
  }
  .steps {
    padding: 4px 0 0 1.25em;
  }
  .why {
    justify-self: end;
    font-size: 0.78rem;
    color: var(--ui-fg);
    white-space: nowrap;
  }
</style>
