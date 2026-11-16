<script lang="ts">
  // Step 3…: one operation schema (ΔState / ΞState, inputs ?, outputs !).
  import SchemaBox from '../editor/SchemaBox.svelte';
  import SymbolLibrary from '../editor/SymbolLibrary.svelte';
  import Prompt from './Prompt.svelte';
  import { givenNames, explainCtxOf } from '../../lib/spec/helpers';
  import { live } from '../../lib/spec/live.svelte';
  import type { SpecDoc } from '../../lib/spec/model';

  interface Props {
    spec: SpecDoc;
    schemaId: string;
    /** Remove this operation (the caller navigates away). */
    onremove?: () => void;
  }
  let { spec, schemaId, onremove }: Props = $props();

  const op = $derived(spec.operations.find((o) => o.id === schemaId));
  const given = $derived(givenNames(spec.given));
  const ctx = $derived(explainCtxOf(spec));
</script>

{#if op}
  <div class="step">
    <Prompt text={op.prompt} />
    <div class="library"><SymbolLibrary stateName={spec.state.name} explainCtx={ctx} /></div>
    <SchemaBox
      bind:name={op.name}
      bind:decls={op.decls}
      bind:preds={op.preds}
      givenSets={given}
      explainCtx={ctx}
      declDiagnostics={live.diagnosticsFor(op.id, 'decls')}
      predDiagnostics={live.diagnosticsFor(op.id, 'preds')}
      declPlaceholder={op.opKind === 'query' ? `Ξ${spec.state.name}` : `Δ${spec.state.name}`}
      predPlaceholder="book? ∉ onLoan"
    />
    {#if onremove && spec.operations.length > 1}
      <button type="button" class="ghost" onclick={onremove} aria-label="Remove this operation" title="Remove">✕</button>
    {/if}
  </div>
{/if}

<style>
  .step {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
  }
  .library {
    position: sticky;
    top: calc(var(--header-h) + 8px);
    z-index: 5;
  }
  .ghost {
    justify-self: end;
    border: none;
    background: transparent;
    color: var(--ui-fg);
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .ghost:hover {
    color: var(--fg);
    background: var(--bg-hover);
  }
</style>
