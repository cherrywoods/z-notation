<script lang="ts">
  // Step 2: the state schema. Δ Ξ ′ ? ! belong to operations, so they are not offered here.
  import SchemaBox from '../editor/SchemaBox.svelte';
  import SymbolLibrary from '../editor/SymbolLibrary.svelte';
  import Prompt from './Prompt.svelte';
  import GoalList from './GoalList.svelte';
  import ToolLayout from './ToolLayout.svelte';
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

<ToolLayout>
  {#snippet bar()}
    <SymbolLibrary vertical stateName={doc.state.name} explainCtx={ctx} exclude={['delta', 'xi', 'prime', 'input', 'output']} />
  {/snippet}
  <Prompt large text="Define the system state." />
  <GoalList goals={live.goalsFor('state')} />
  <SchemaBox
    bind:name={doc.state.name}
    bind:decls={doc.state.decls}
    bind:preds={doc.state.preds}
    nameError={schemaNameError(doc, 'state', doc.state.name)}
    givenSets={given}
    explainCtx={ctx}
    declDiagnostics={live.diagnosticsFor('state', 'decls')}
    predDiagnostics={live.diagnosticsFor('state', 'preds')}
    declPlaceholder="Add state variables"
    predPlaceholder="Add invariants"
  />
</ToolLayout>
