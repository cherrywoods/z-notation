<!-- Step: Init schema (after the operations). Contract: props { spec }; one <TutorialColumns>. -->
<script lang="ts">
  import type { SpecDoc } from '../../lib/spec/model';
  import TutorialColumns from '../shell/TutorialColumns.svelte';
  import InitMain from '../views/InitMain.svelte';
  import SidePanels from '../panels/SidePanels.svelte';

  let { spec }: { spec: SpecDoc } = $props();
</script>

<TutorialColumns>
  {#snippet main()}
    <InitMain {spec} />
  {/snippet}
  {#snippet side()}
    <SidePanels schemaId={'init'} />
  {/snippet}
</TutorialColumns>
