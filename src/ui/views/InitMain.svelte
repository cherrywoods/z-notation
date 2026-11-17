<script lang="ts">
  // The Init schema (initial state), in its own step after the operations.
  // Like the state schema, it needs no Δ Ξ ′ ? !.
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

  let { spec }: { spec: SpecDoc } = $props();
  // edits go to the store's state (not through the prop)
  const doc = $derived(store.current ?? spec);

  const given = $derived(givenNames(doc.given));
  const ctx = $derived(explainCtxOf(doc));
</script>

{#if doc.init}
  <ToolLayout>
    {#snippet bar()}
      <SymbolLibrary vertical stateName={doc.state.name} explainCtx={ctx} exclude={['delta', 'xi', 'prime', 'input', 'output']} />
    {/snippet}
    <Prompt large text="Define the initial state." />
    <GoalList goals={live.goalsFor('init')} />
    <SchemaBox
      bind:name={doc.init.name}
      bind:decls={doc.init.decls}
      bind:preds={doc.init.preds}
      nameError={schemaNameError(doc, 'init', doc.init.name)}
      givenSets={given}
      explainCtx={ctx}
      declDiagnostics={live.diagnosticsFor('init', 'decls')}
      predDiagnostics={live.diagnosticsFor('init', 'preds')}
      declPlaceholder="Import the state"
      predPlaceholder="Add initial values"
    />
    <div class="remove">
      <InlineConfirm label="Remove the Init schema" question="Remove?" action="Remove" onconfirm={() => store.removeInit()}>
        {#snippet icon()}<X size={16} />{/snippet}
      </InlineConfirm>
    </div>
  </ToolLayout>
{/if}

<style>
  .remove {
    justify-self: end;
  }
</style>
