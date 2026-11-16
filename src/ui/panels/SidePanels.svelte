<script lang="ts">
  // The side column of a tutorial step: Example (top) and Inference (below).
  import ExamplePanel from './ExamplePanel.svelte';
  import InferencePanel from './InferencePanel.svelte';

  let { schemaId }: { schemaId: string } = $props();
</script>

<div class="side">
  {#key schemaId}
    <ExamplePanel {schemaId} />
    <InferencePanel {schemaId} />
  {/key}
</div>

<style>
  .side {
    display: grid;
    gap: 16px;
    position: sticky;
    top: calc(var(--header-h) + 16px);
    max-height: calc(100dvh - var(--header-h) - 120px);
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }
  @media (max-width: 899px) {
    .side {
      position: static;
      max-height: none;
      overflow: visible;
    }
  }
</style>
