<script lang="ts">
  // A Z schema box as on the lecture slides: the name sits in the top rule, the
  // declaration part is above the short middle line, the predicate part below it,
  // a vertical rule on the left and a rule at the bottom. Both parts are editors.
  import type { EditorView } from '@codemirror/view';
  import ZEditor from './ZEditor.svelte';
  import type { ZDiagnostic } from '../../lib/spec/model';
  import type { ExplainerContext } from '../explain/explain.svelte';
  import { explain } from '../explain/explain.svelte';

  interface Props {
    name: string;
    decls: string;
    preds: string;
    nameEditable?: boolean;
    givenSets?: string[];
    explainCtx?: ExplainerContext;
    declDiagnostics?: ZDiagnostic[];
    predDiagnostics?: ZDiagnostic[];
    declPlaceholder?: string;
    predPlaceholder?: string;
    /** Highlight the frame (e.g. when the example panel refers to this schema). */
    active?: boolean;
    onchange?: (patch: { name?: string; decls?: string; preds?: string }) => void;
  }

  let {
    name = $bindable(''),
    decls = $bindable(''),
    preds = $bindable(''),
    nameEditable = true,
    givenSets = [],
    explainCtx,
    declDiagnostics = [],
    predDiagnostics = [],
    declPlaceholder = '',
    predPlaceholder = '',
    active = false,
    onchange,
  }: Props = $props();

  let declView: EditorView | null = null;
  let predView: EditorView | null = null;

  function focusEnd(v: EditorView | null, atStart = false) {
    if (!v) return false;
    v.focus();
    const pos = atStart ? 0 : v.state.doc.length;
    v.dispatch({ selection: { anchor: pos } });
    return true;
  }

  function hoverPart(e: MouseEvent, id: string) {
    explain.show({ id, anchor: (e.currentTarget as HTMLElement).getBoundingClientRect(), ctx: explainCtx });
  }
</script>

<div class="schema" class:active>
  <div class="top">
    <span class="rule lead"></span>
    {#if nameEditable}
      <input
        class="name"
        type="text"
        spellcheck="false"
        autocomplete="off"
        aria-label="Schema name"
        bind:value={name}
        size={Math.max(4, name.length + 1)}
        oninput={() => onchange?.({ name })}
      />
    {:else}
      <span class="name static">{name}</span>
    {/if}
    <span class="rule fill"></span>
  </div>

  <div class="part decls">
    <ZEditor
      bind:value={decls}
      placeholder={declPlaceholder}
      {givenSets}
      {explainCtx}
      diagnostics={declDiagnostics}
      ariaLabel={`${name} declarations`}
      onchange={(t) => onchange?.({ decls: t })}
      onview={(v) => (declView = v)}
      onedge={(dir) => (dir === 'next' ? focusEnd(predView, true) : false)}
    />
  </div>

  <!-- the short middle line separating declarations from predicates -->
  <div
    class="divider"
    role="separator"
    data-explain="schema"
    onmouseenter={(e) => hoverPart(e, 'schema')}
    onmouseleave={() => explain.hide()}
  ></div>

  <div class="part preds">
    <ZEditor
      bind:value={preds}
      placeholder={predPlaceholder}
      {givenSets}
      {explainCtx}
      diagnostics={predDiagnostics}
      ariaLabel={`${name} predicates`}
      onchange={(t) => onchange?.({ preds: t })}
      onview={(v) => (predView = v)}
      onedge={(dir) => (dir === 'prev' ? focusEnd(declView) : false)}
    />
  </div>
</div>

<style>
  .schema {
    --rule: 1.5px solid var(--fg);
    position: relative;
    margin-top: 1em;
    padding: 0.95em 0 0.55em 14px;
    border-left: var(--rule);
    border-bottom: var(--rule);
    transition: border-color 0.2s;
  }
  .schema.active {
    --rule: 2px solid var(--fg);
  }
  .top {
    position: absolute;
    top: -0.9em;
    left: -1.5px;
    right: 0;
    height: 1.8em;
    display: flex;
    align-items: center;
    font-family: var(--font-z);
    font-size: 1.15rem;
  }
  .rule {
    border-top: var(--rule);
    height: 0;
  }
  .rule.lead {
    width: 14px;
    flex: none;
  }
  .rule.fill {
    flex: 1;
  }
  .name {
    font-family: var(--font-z);
    font-style: normal;
    font-size: 1.15rem;
    border: none;
    background: transparent;
    padding: 0 6px;
    margin: 0;
    color: var(--fg);
    min-width: 3ch;
    border-radius: 4px;
    field-sizing: content;
  }
  input.name:hover {
    background: var(--bg-hover);
  }
  input.name:focus {
    outline: none;
    background: var(--bg-subtle);
    box-shadow: inset 0 -1.5px 0 var(--focus);
  }
  .part {
    min-height: 1.9em;
  }
  .divider {
    margin: 0.3em 0 0.35em -14px;
    width: min(45%, 300px);
    border-top: var(--rule);
    height: 0;
    position: relative;
  }
  /* bigger hover target for the separator */
  .divider::after {
    content: '';
    position: absolute;
    inset: -6px 0;
  }
</style>
