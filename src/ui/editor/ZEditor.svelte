<script lang="ts">
  import { onMount } from 'svelte';
  import type { EditorView } from '@codemirror/view';
  import {
    createZEditor,
    setEditorContext,
    setEditorDiagnostics,
    setEditorText,
  } from '../../lib/editor/zEditor';
  import { setActiveEditor, forgetEditor } from '../../lib/editor/active';
  import type { ZDiagnostic } from '../../lib/spec/model';
  import type { ExplainerContext } from '../explain/explain.svelte';

  interface Props {
    value: string;
    placeholder?: string;
    givenSets?: string[];
    explainCtx?: ExplainerContext;
    diagnostics?: ZDiagnostic[];
    ariaLabel?: string;
    /** Called on every edit with the new text. */
    onchange?: (text: string) => void;
    /** ArrowDown on the last line / ArrowUp on the first line. Return true if handled. */
    onedge?: (dir: 'next' | 'prev') => boolean;
    /** Receives the CodeMirror view (e.g. to move focus between editors). */
    onview?: (view: EditorView | null) => void;
  }

  let {
    value = $bindable(''),
    placeholder = '',
    givenSets = [],
    explainCtx,
    diagnostics = [],
    ariaLabel,
    onchange,
    onedge,
    onview,
  }: Props = $props();

  let host: HTMLDivElement;
  let view = $state<EditorView | undefined>();

  onMount(() => {
    const v = createZEditor({
      parent: host,
      doc: value,
      placeholder,
      ariaLabel,
      context: { givenSets, explainCtx },
      onChange: (text) => {
        value = text;
        onchange?.(text);
      },
      onFocus: (ev) => setActiveEditor(ev),
      onEdge: (dir) => onedge?.(dir) ?? false,
    });
    view = v;
    onview?.(v);
    return () => {
      forgetEditor(v);
      onview?.(null);
      v.destroy();
    };
  });

  // external text changes (reset, template switch)
  $effect(() => {
    const text = value;
    if (view) setEditorText(view, text);
  });

  $effect(() => {
    const ctx = { givenSets: [...givenSets], explainCtx };
    if (view) setEditorContext(view, ctx);
  });

  $effect(() => {
    const d = diagnostics;
    if (view) setEditorDiagnostics(view, d);
  });
</script>

<div class="z-editor" bind:this={host}></div>

<style>
  .z-editor {
    min-height: 1.9em;
  }
  .z-editor :global(.cm-editor) {
    min-height: 1.9em;
  }
</style>
