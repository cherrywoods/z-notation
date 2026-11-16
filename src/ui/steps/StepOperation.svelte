<!--
  Step: one operation. Contract: props { spec, schemaId }; one <TutorialColumns>.
  Deleting: store.removeOperation(schemaId) — the shell then moves to a neighbouring step.
-->
<script lang="ts">
  import type { SpecDoc } from '../../lib/spec/model';
  import { store } from '../../lib/spec/store.svelte';
  import TutorialColumns from '../shell/TutorialColumns.svelte';
  import OperationMain from '../views/OperationMain.svelte';
  import SidePanels from '../panels/SidePanels.svelte';

  let { spec, schemaId }: { spec: SpecDoc; schemaId: string } = $props();
</script>

<TutorialColumns>
  {#snippet main()}
    {#key schemaId}
      <OperationMain {spec} {schemaId} onremove={() => store.removeOperation(schemaId)} />
    {/key}
  {/snippet}
  {#snippet side()}
    <SidePanels schemaId={schemaId} />
  {/snippet}
</TutorialColumns>
