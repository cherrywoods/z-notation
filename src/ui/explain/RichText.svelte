<script lang="ts">
  // Plain text with Z snippets between backticks: 'the set `ℙ X`'.
  import ZText from '../z/ZText.svelte';
  import type { ExplainerContext } from '../../lib/content/explainers';

  let { text, ctx }: { text: string; ctx?: ExplainerContext } = $props();
  const parts = $derived(text.split('`'));
</script>

{#each parts as part, i}{#if i % 2}<ZText text={part} {ctx} nested class="rich-z" />{:else}{part}{/if}{/each}

<style>
  :global(.rich-z.z-text) {
    font-size: 1.1em;
    line-height: 1.3;
  }
</style>
