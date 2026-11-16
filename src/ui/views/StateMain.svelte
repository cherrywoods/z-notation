<script lang="ts">
  // Step 2: the state schema.
  import SchemaBox from '../editor/SchemaBox.svelte';
  import SymbolLibrary from '../editor/SymbolLibrary.svelte';
  import Prompt from './Prompt.svelte';
  import { givenNames, explainCtxOf } from '../../lib/spec/helpers';
  import { live } from '../../lib/spec/live.svelte';
  import type { SpecDoc } from '../../lib/spec/model';

  let { spec }: { spec: SpecDoc } = $props();

  const given = $derived(givenNames(spec.given));
  const ctx = $derived(explainCtxOf(spec));
</script>

<div class="step">
  <Prompt text={spec.state.prompt} />
  <div class="library"><SymbolLibrary stateName={spec.state.name} explainCtx={ctx} /></div>
  <SchemaBox
    bind:name={spec.state.name}
    bind:decls={spec.state.decls}
    bind:preds={spec.state.preds}
    givenSets={given}
    explainCtx={ctx}
    declDiagnostics={live.diagnosticsFor('state', 'decls')}
    predDiagnostics={live.diagnosticsFor('state', 'preds')}
    declPlaceholder="onLoan : ℙ BOOK"
    predPlaceholder="onLoan = dom borrower"
  />
</div>

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
</style>
