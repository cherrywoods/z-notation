<!-- Step: State schema (+ optional Init). Contract: props { spec }; one <TutorialColumns>. -->
<script lang="ts">
  import type { SpecDoc } from '../../lib/spec/model';
  import TutorialColumns from '../shell/TutorialColumns.svelte';
  import StateMain from '../views/StateMain.svelte';
  import SidePanels from '../panels/SidePanels.svelte';

  let { spec }: { spec: SpecDoc } = $props();
</script>

<TutorialColumns>
  {#snippet main()}
    <StateMain {spec} />
  {/snippet}
  {#snippet side()}
    <SidePanels schemaId={'state'} />
  {/snippet}
</TutorialColumns>
