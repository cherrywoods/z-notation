<!-- Step: Types (given sets). Contract: props { spec }; one <TutorialColumns>. -->
<script lang="ts">
  import type { SpecDoc } from '../../lib/spec/model';
  import TutorialColumns from '../shell/TutorialColumns.svelte';
  import TypesMain from '../views/TypesMain.svelte';
  import TypesPanel from '../panels/TypesPanel.svelte';

  let { spec }: { spec: SpecDoc } = $props();
</script>

<TutorialColumns>
  {#snippet main()}
    <TypesMain {spec} />
  {/snippet}
  {#snippet side()}
    <TypesPanel {spec} />
  {/snippet}
</TutorialColumns>
