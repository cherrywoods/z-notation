<script lang="ts">
  // Main column of a step: an elevated tool bar on the left (symbols, common types)
  // next to the content. On phones the bar becomes a scrolling row above it.
  import type { Snippet } from 'svelte';

  let { bar, children }: { bar?: Snippet; children: Snippet } = $props();
</script>

<div class="tool-layout" class:with-bar={!!bar}>
  {#if bar}
    <aside class="bar">{@render bar()}</aside>
  {/if}
  <div class="content">{@render children()}</div>
</div>

<style>
  .tool-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
    align-items: start;
  }
  .tool-layout.with-bar {
    grid-template-columns: max-content minmax(0, 1fr);
    gap: clamp(20px, 3vw, 36px);
  }
  .content {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
    min-width: 0;
  }
  /* elevated: border, large radius, shadow below */
  .bar {
    position: sticky;
    top: calc(var(--header-h) + 16px);
    max-height: calc(100dvh - var(--header-h) - 130px);
    overflow-y: auto;
    scrollbar-width: none;
    padding: 10px 8px;
    background: var(--bg);
    border: 1.5px solid var(--edge-raised);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-raised);
  }
  .bar::-webkit-scrollbar {
    display: none;
  }
  @media (max-width: 640px) {
    .tool-layout.with-bar {
      grid-template-columns: minmax(0, 1fr);
    }
    .bar {
      position: sticky;
      top: calc(var(--header-h) + 6px);
      z-index: 5;
      max-height: none;
      overflow: hidden;
      padding: 6px 8px;
      border-radius: 18px;
    }
  }
</style>
