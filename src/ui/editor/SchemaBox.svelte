<script lang="ts">
  // A Z schema box as on the lecture slides: the name sits in the top rule, the
  // declaration part is above the short middle line, the predicate part below it,
  // a vertical rule on the left and a rule at the bottom. Both parts are editors.
  import type { EditorView } from '@codemirror/view';
  import ZEditor from './ZEditor.svelte';
  import type { ZDiagnostic } from '../../lib/spec/model';
  import type { ExplainerContext } from '../explain/explain.svelte';
  import { schemaFrame } from '../explain/frame';

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
    /** Why the name is not usable (one short line), shown next to it. */
    nameError?: string | null;
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
    nameError = null,
    onchange,
  }: Props = $props();

  const errorId = `name-error-${Math.random().toString(36).slice(2, 8)}`;

  let declView: EditorView | null = null;
  let predView: EditorView | null = null;

  function focusEnd(v: EditorView | null, atStart = false) {
    if (!v) return false;
    v.focus();
    const pos = atStart ? 0 : v.state.doc.length;
    v.dispatch({ selection: { anchor: pos } });
    return true;
  }

  /** Hovering any rule of the box explains what a schema is. */
  const frame = schemaFrame(() => explainCtx);
</script>

<div class="schema" class:active>
  <span class="strip left" data-explain="schema" aria-hidden="true" {@attach frame}></span>
  <span class="strip bottom" data-explain="schema" aria-hidden="true" {@attach frame}></span>
  <div class="top">
    <span class="rule lead" data-explain="schema" aria-hidden="true" {@attach frame}></span>
    {#if nameEditable}
      <input
        class="name"
        class:invalid={!!nameError}
        type="text"
        spellcheck="false"
        autocomplete="off"
        aria-label="Schema name"
        aria-invalid={nameError ? 'true' : undefined}
        aria-describedby={nameError ? errorId : undefined}
        bind:value={name}
        size={Math.max(4, Math.min(name.length + 1, 40))}
        oninput={() => onchange?.({ name })}
      />
    {:else}
      <span class="name static" title={name}>{name}</span>
    {/if}
    {#if nameError}
      <span class="name-error" id={errorId} title={nameError}>{nameError}</span>
    {/if}
    <span class="rule fill" data-explain="schema" aria-hidden="true" {@attach frame}></span>
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
  <div class="divider" role="separator" data-explain="schema" {@attach frame}></div>

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
    font-size: calc(1.15rem * var(--z-scale, 1));
  }
  .rule {
    border-top: var(--rule);
    height: 0;
    position: relative;
  }
  /* thin invisible hover strips on the rules (the 'schema' explainer) */
  .rule::after {
    content: '';
    position: absolute;
    inset: -6px 0 -5px;
  }
  .strip {
    position: absolute;
    z-index: 1;
  }
  .strip.left {
    left: -7px;
    width: 12px;
    top: 0;
    bottom: -2px;
  }
  .strip.bottom {
    left: -7px;
    right: 0;
    bottom: -7px;
    height: 12px;
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
    font-size: calc(1.15rem * var(--z-scale, 1));
    border: none;
    background: transparent;
    padding: 0 6px;
    margin: 0;
    color: var(--fg);
    min-width: 3ch;
    /* very long names scroll inside the field instead of widening the page */
    flex: 0 1 auto;
    max-width: 75%;
    border-radius: 4px;
    field-sizing: content;
  }
  .name.static {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  input.name.invalid {
    box-shadow: inset 0 -2px 0 var(--error);
  }
  .name-error {
    flex: 0 1 auto;
    min-width: 0;
    padding: 0 6px;
    font-family: var(--font-ui);
    font-size: 0.8rem;
    color: var(--error);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  input.name:hover {
    background: var(--bg-hover);
  }
  input.name:focus {
    outline: none;
    background: var(--bg-subtle);
    box-shadow: inset 0 -1.5px 0 var(--focus);
  }
  input.name.invalid:focus {
    box-shadow: inset 0 -2px 0 var(--error);
  }
  .part {
    min-height: 1.9em;
  }
  /* presenter mode scales the Z text (--z-scale, set on <html>) */
  .part :global(.cm-editor) {
    font-size: calc(1.15rem * var(--z-scale, 1));
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
