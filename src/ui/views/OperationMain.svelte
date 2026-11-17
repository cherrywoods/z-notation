<script lang="ts">
  // Step 3…: one operation schema (ΔState / ΞState, inputs ?, outputs !).
  import SchemaBox from '../editor/SchemaBox.svelte';
  import SymbolLibrary from '../editor/SymbolLibrary.svelte';
  import Prompt from './Prompt.svelte';
  import GoalList from './GoalList.svelte';
  import ToolLayout from './ToolLayout.svelte';
  import { X } from '@lucide/svelte';
  import InlineConfirm from '../shell/InlineConfirm.svelte';
  import { givenNames, explainCtxOf, schemaNameError } from '../../lib/spec/helpers';
  import { live } from '../../lib/spec/live.svelte';
  import { store } from '../../lib/spec/store.svelte';
  import type { SpecDoc } from '../../lib/spec/model';

  interface Props {
    spec: SpecDoc;
    schemaId: string;
    /** Remove this operation (the caller navigates away). */
    onremove?: () => void;
  }
  let { spec, schemaId, onremove }: Props = $props();

  // edits go to the store's state (not through the prop)
  const doc = $derived(store.current ?? spec);
  const op = $derived(doc.operations.find((o) => o.id === schemaId));
  const given = $derived(givenNames(doc.given));
  const ctx = $derived(explainCtxOf(doc));
</script>

{#if op}
  <ToolLayout>
    {#snippet bar()}
      <SymbolLibrary vertical stateName={doc.state.name} explainCtx={ctx} />
    {/snippet}
    <Prompt large text={op.opKind === 'query' ? 'Define an operation that reads the state.' : 'Define an operation that changes the state.'} />
    <GoalList goals={live.goalsFor(op.id)} />
    <SchemaBox
      bind:name={op.name}
      bind:decls={op.decls}
      bind:preds={op.preds}
      nameError={schemaNameError(doc, op.id, op.name)}
      givenSets={given}
      explainCtx={ctx}
      declDiagnostics={live.diagnosticsFor(op.id, 'decls')}
      predDiagnostics={live.diagnosticsFor(op.id, 'preds')}
      declPlaceholder={'Import the state\nAdd inputs and outputs'}
      predPlaceholder={'Add preconditions\nAdd postconditions'}
    />
    {#if onremove && doc.operations.length > 1}
      <div class="remove">
        <InlineConfirm label="Remove this operation" question="Remove?" action="Remove" onconfirm={onremove}>
          {#snippet icon()}<X size={16} />{/snippet}
        </InlineConfirm>
      </div>
    {/if}
  </ToolLayout>
{/if}

<style>
  .remove {
    justify-self: end;
  }
</style>
