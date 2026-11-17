<script lang="ts">
  // Palette of Z symbols. Hover shows the explainer, click inserts the symbol as a
  // snippet into the editor that had focus last (fields to fill in are highlighted).
  import { SYMBOLS, type ZSymbol } from '../../lib/z/symbols';
  import { insertIntoActive } from '../../lib/editor/active';
  import { explain, type ExplainerContext } from '../explain/explain.svelte';
  import { scrollFade } from '../scrollFade';

  interface Props {
    /** State schema name, used for the Δ / Ξ snippets. */
    stateName?: string;
    explainCtx?: ExplainerContext;
    /** Compact single row (phones) — scrolls horizontally. */
    compact?: boolean;
    /** A vertical bar (left side bar); becomes a row on phones. */
    vertical?: boolean;
    /** Symbol ids not offered here (e.g. Δ Ξ ′ ? ! on the State step). */
    exclude?: string[];
  }
  let { stateName = 'State', explainCtx, compact = false, vertical = false, exclude = [] }: Props = $props();

  let showMore = $state(false);

  // Grouped by what students do with the symbols, most common first in each group
  // (colours still follow the symbol categories).
  const MAIN: { id: string; items: string[] }[] = [
    { id: 'operation', items: ['delta', 'xi', 'prime', 'input', 'output'] }, // operations only
    { id: 'declare', items: ['pfun', 'tfun', 'rel', 'power'] }, // types of state variables
    { id: 'relation', items: ['dom', 'ran'] },
    { id: 'build', items: ['maplet', 'emptyset', 'setdisplay', 'setcomp'] }, // pairs and sets of elements
    { id: 'member', items: ['in', 'notin', 'subseteq'] },
    { id: 'setops', items: ['cup', 'setminus', 'cap', 'card'] },
    { id: 'logic', items: ['and', 'or', 'not', 'implies', 'forall', 'exists'] },
  ];
  const MORE: { id: string; items: string[] }[] = [
    { id: 'numbers', items: ['nat', 'nat1', 'int', 'real'] },
    { id: 'compare', items: ['neq', 'leq', 'geq', 'subset'] },
    { id: 'other', items: ['apply', 'cross', 'iff'] },
  ];
  const byId = new Map(SYMBOLS.map((s) => [s.id, s]));

  const merged = $derived(
    [...MAIN, ...(showMore ? MORE : [])]
      .map((g) => ({
        cat: g.id,
        items: g.items.filter((id) => !exclude.includes(id)).map((id) => byId.get(id)).filter((s): s is ZSymbol => !!s),
      }))
      .filter((g) => g.items.length > 0),
  );

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

<div class="library" class:compact class:vertical {@attach scrollFade()} role="toolbar" aria-orientation={vertical ? 'vertical' : 'horizontal'} aria-label="Z symbols">
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
  /* ── vertical side bar (the bar frame comes from ToolLayout) ─────────── */
  .library.vertical {
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: stretch;
    gap: 0;
    padding: 0;
    background: none;
    border: none;
  }
  .vertical .group {
    display: grid;
    grid-template-columns: repeat(2, 38px);
    gap: 2px;
    justify-content: center;
  }
  .vertical .sep {
    width: auto;
    height: 1px;
    margin: 6px 6px;
  }
  .vertical .sym {
    width: 38px;
    min-width: 0;
    height: 36px;
    padding: 0;
  }
  .vertical .sym.wide {
    font-size: 0.95rem;
  }
  .vertical .more {
    align-self: center;
  }
  @media (max-width: 640px) {
    .library.vertical {
      flex-direction: row;
      overflow-x: auto;
      align-items: center;
    }
    .vertical .group {
      display: flex;
    }
    .vertical .sep {
      width: 1px;
      height: auto;
      align-self: stretch;
      margin: 3px 5px;
    }
  }
</style>
