<script lang="ts">
  // Step 1: the given sets `[PATIENT, DRUG]`. Common given sets (NAME, DATE, …) sit in a
  // raised bar on the left and are added with one click.
  import ZEditor from '../editor/ZEditor.svelte';
  import Prompt from './Prompt.svelte';
  import GoalList from './GoalList.svelte';
  import ToolLayout from './ToolLayout.svelte';
  import { givenNames, explainCtxOf } from '../../lib/spec/helpers';
  import { DEFAULT_SETS, type DefaultSet } from '../../lib/spec/defaults';
  import { typeOptionsOf } from '../../lib/spec/topics';
  import { live } from '../../lib/spec/live.svelte';
  import { store } from '../../lib/spec/store.svelte';
  import { explain } from '../explain/explain.svelte';
  import { scrollFade } from '../scrollFade';
  import type { SpecDoc } from '../../lib/spec/model';
  import type { EditorView } from '@codemirror/view';
  import { EditorState, StateEffect } from '@codemirror/state';

  let { spec }: { spec: SpecDoc } = $props();
  // edits go to the store's state (not through the prop)
  const doc = $derived(store.current ?? spec);

  const names = $derived(givenNames(doc.given));
  /** This system's sensible types (own topic: NAME, DATE, …), minus those already declared. */
  const options = $derived(typeOptionsOf(doc.topicId) ?? DEFAULT_SETS);
  const available = $derived(options.filter((d) => !names.includes(d.name)));

  // The Types line starts as large empty brackets `[]`; clicking into it puts the
  // caret between them.
  $effect(() => {
    if (!doc.given.trim()) doc.given = '[]';
  });
  function bracketCaret(view: EditorView | null) {
    if (!view) return;
    const empty = (doc: string) => /^\[\s*\]$/.test(doc);
    // any caret placement (click, keys) on the empty `[]` lands between the brackets
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorState.transactionFilter.of((tr) => {
          if (!tr.selection || !empty(tr.newDoc.toString())) return tr;
          const head = tr.newSelection.main.head;
          if (head > 0 && head < tr.newDoc.length) return tr;
          return [tr, { selection: { anchor: 1 }, sequential: true }];
        }),
      ),
    });
    view.contentDOM.addEventListener('focus', () => {
      const head = view.state.selection.main.head;
      if (empty(view.state.doc.toString()) && (head === 0 || head === view.state.doc.length))
        view.dispatch({ selection: { anchor: 1 } });
    });
  }

  function addDefault(d: DefaultSet) {
    doc.given = `[${[...names, d.name].join(', ')}]`;
    if (!doc.pools[d.name]) doc.pools[d.name] = [...d.values];
    if (d.infinite && !(doc.infinite ?? []).includes(d.name)) doc.infinite = [...(doc.infinite ?? []), d.name];
  }
</script>

<ToolLayout bar={available.length ? bar : undefined}>
  <Prompt large text="Define the types used in the system." />
  <GoalList goals={live.goalsFor('types')} />
  <div class="given">
    <ZEditor
      bind:value={doc.given}
      onview={bracketCaret}
      givenSets={names}
      explainCtx={explainCtxOf(doc)}
      diagnostics={live.diagnosticsFor('types', 'given')}
      ariaLabel="Given sets"
    />
  </div>
</ToolLayout>

{#snippet bar()}
  <nav class="types-bar" aria-label="Common given sets" {@attach scrollFade()}>
    {#each available as d (d.name)}
      <button
        type="button"
        class="add"
        onclick={() => addDefault(d)}
        onmouseenter={(e) =>
          explain.show({ id: 'given', anchor: (e.currentTarget as HTMLElement).getBoundingClientRect(), ctx: { subject: d.name } })}
        onmouseleave={() => explain.hide()}
      >
        <span class="plus" aria-hidden="true">+</span>{d.name}
      </button>
    {/each}
  </nav>
{/snippet}

<style>
  .types-bar {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .add {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 14px 6px 10px;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: var(--ui-fg);
    font-family: var(--font-z);
    font-size: 1rem;
    text-align: left;
    cursor: pointer;
    transition:
      transform 0.15s var(--ease-spring),
      background 0.15s,
      color 0.15s;
  }
  .add:hover {
    background: var(--ui-bg);
    color: var(--ui-fg-strong);
    transform: translateX(2px) scale(1.04);
  }
  .add:active {
    transform: scale(0.97);
  }
  .plus {
    font-family: var(--font-ui);
    color: var(--ui-fg-faint);
  }
  .given {
    padding: 6px 0;
  }
  .given :global(.cm-editor) {
    font-size: calc(1.7rem * var(--z-scale, 1));
  }
  @media (max-width: 640px) {
    .types-bar {
      flex-direction: row;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .add {
      flex: none;
    }
  }
</style>
