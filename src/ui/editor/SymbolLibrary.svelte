<script lang="ts">
  // Palette of Z symbols. Hover shows the explainer, click inserts the symbol as a
  // snippet into the editor that had focus last (fields to fill in are highlighted).
  import { SYMBOLS, type SymbolCategory, type ZSymbol } from '../../lib/z/symbols';
  import { insertIntoActive } from '../../lib/editor/active';
  import { explain, type ExplainerContext } from '../explain/explain.svelte';

  interface Props {
    /** State schema name, used for the Δ / Ξ snippets. */
    stateName?: string;
    explainCtx?: ExplainerContext;
    /** Compact single row (phones) — scrolls horizontally. */
    compact?: boolean;
  }
  let { stateName = 'State', explainCtx, compact = false }: Props = $props();

  let showMore = $state(false);

  const ORDER: SymbolCategory[] = ['schema', 'decoration', 'type', 'relation', 'set', 'logic'];
  const groups = $derived(
    ORDER.map((cat) => ({
      cat,
      items: SYMBOLS.filter((s) => s.category === cat && (s.library === 'main' || (showMore && s.library === 'more'))),
    })).filter((g) => g.items.length > 0),
  );
  // Δ/Ξ/′/?/! form one visual group
  const merged = $derived.by(() => {
    const out: { cat: SymbolCategory; items: ZSymbol[] }[] = [];
    for (const g of groups) {
      if (g.cat === 'decoration' && out.length && out[out.length - 1].cat === 'schema') out[out.length - 1].items.push(...g.items);
      else out.push({ cat: g.cat, items: [...g.items] });
    }
    return out;
  });

  function label(s: ZSymbol): string {
    if (s.id === 'delta') return 'Δ';
    if (s.id === 'xi') return 'Ξ';
    return s.text;
  }

  function insert(s: ZSymbol) {
    let tpl = s.snippet ?? s.text;
    tpl = tpl.replace('${State}', stateName || 'State');
    insertIntoActive(tpl);
    explain.close();
  }

  let pointerType = '';
</script>

<div class="library" class:compact role="toolbar" aria-label="Z symbols">
  {#each merged as g, gi (g.cat)}
    {#if gi > 0}<span class="sep" aria-hidden="true"></span>{/if}
    <div class="group">
      {#each g.items as s (s.id)}
        <button
          type="button"
          class="sym cat-{s.category}"
          class:word={s.keyword}
          class:wide={s.text.length > 2}
          data-explain={s.id}
          aria-label={s.name}
          onpointerdown={(e) => {
            pointerType = e.pointerType;
            e.preventDefault(); // keep focus + selection in the editor
          }}
          onclick={() => insert(s)}
          onmouseenter={(e) => {
            if (pointerType !== 'touch')
              explain.show({ id: s.id, anchor: (e.currentTarget as HTMLElement).getBoundingClientRect(), ctx: explainCtx });
          }}
          onmouseleave={() => explain.hide()}
        >
          {label(s)}
        </button>
      {/each}
    </div>
  {/each}
  <span class="sep" aria-hidden="true"></span>
  <button
    type="button"
    class="more"
    aria-expanded={showMore}
    onpointerdown={(e) => e.preventDefault()}
    onclick={() => (showMore = !showMore)}
  >
    {showMore ? 'less' : 'more'}
  </button>
</div>

<style>
  .library {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 2px;
    padding: 6px 8px;
    background: var(--ui-bg);
    border: 1px solid var(--ui-border);
    border-radius: var(--radius);
  }
  .library.compact {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .library.compact::-webkit-scrollbar {
    display: none;
  }
  /* phones: one row that scrolls sideways */
  @media (max-width: 640px) {
    .library {
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior-x: contain;
    }
    .library::-webkit-scrollbar {
      display: none;
    }
  }
  .group {
    display: flex;
    flex-wrap: nowrap;
    gap: 2px;
  }
  .sep {
    width: 1px;
    align-self: stretch;
    background: var(--ui-border);
    margin: 3px 5px;
    flex: none;
  }
  .sym {
    flex: none;
    min-width: 34px;
    height: 34px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    font-family: var(--font-z-symbols);
    font-size: 1.2rem;
    line-height: 1;
    cursor: help;
    transition:
      transform 0.15s var(--ease-spring),
      background 0.15s,
      border-color 0.15s;
  }
  .sym.word {
    font-family: var(--font-z);
    font-size: 1.05rem;
  }
  .sym.wide {
    font-size: 1rem;
  }
  .sym {
    color: var(--ui-fg);
  }
  .sym:hover {
    background: var(--bg);
    border-color: var(--ui-border);
    transform: scale(1.15);
    box-shadow: var(--shadow-sm);
  }
  .sym.cat-type:hover {
    color: var(--z-type);
  }
  .sym.cat-relation:hover {
    color: var(--z-relation);
  }
  .sym.cat-set:hover {
    color: var(--z-set);
  }
  .sym.cat-logic:hover {
    color: var(--fg);
  }
  .sym.cat-schema:hover {
    color: var(--z-schema);
  }
  .sym.cat-decoration:hover {
    color: var(--z-decoration);
  }
  .sym:active {
    transform: scale(0.95);
  }
  .more {
    flex: none;
    height: 30px;
    padding: 0 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--ui-fg);
    font-size: 0.82rem;
    cursor: pointer;
  }
  .more:hover {
    background: var(--bg);
    color: var(--ui-fg-strong);
  }
</style>
