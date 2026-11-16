<script lang="ts">
  // The Init schema (initial state), in its own step after the operations.
  import SchemaBox from '../editor/SchemaBox.svelte';
  import SymbolLibrary from '../editor/SymbolLibrary.svelte';
  import Prompt from './Prompt.svelte';
  import { givenNames, explainCtxOf } from '../../lib/spec/helpers';
  import { live } from '../../lib/spec/live.svelte';
  import { store } from '../../lib/spec/store.svelte';
  import type { SpecDoc } from '../../lib/spec/model';

  let { spec }: { spec: SpecDoc } = $props();

  const given = $derived(givenNames(spec.given));
  const ctx = $derived(explainCtxOf(spec));
</script>

{#if spec.init}
  <div class="step">
    <Prompt text={spec.init.prompt} />
    <div class="library"><SymbolLibrary stateName={spec.state.name} explainCtx={ctx} /></div>
    <SchemaBox
      bind:name={spec.init.name}
      bind:decls={spec.init.decls}
      bind:preds={spec.init.preds}
      givenSets={given}
      explainCtx={ctx}
      declDiagnostics={live.diagnosticsFor('init', 'decls')}
      predDiagnostics={live.diagnosticsFor('init', 'preds')}
      declPlaceholder={spec.state.name}
      predPlaceholder="onLoan = ∅"
    />
    <button type="button" class="ghost" onclick={() => store.removeInit()} aria-label="Remove the Init schema" title="Remove">✕</button>
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
    color: var(--ui-fg-strong);
    background: var(--ui-bg);
  }
</style>
