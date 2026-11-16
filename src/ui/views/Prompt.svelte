<script lang="ts">
  // A short task prompt above an editor (very little text, muted).
  let { text }: { text?: string } = $props();
</script>

{#if text}
  <p class="prompt">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5h3l7.4-7.4a1.4 1.4 0 0 0 0-2l-1-1a1.4 1.4 0 0 0-2 0L2.5 10.5v3Z" /></svg>
    <span>{text}</span>
  </p>
{/if}

<style>
  .prompt {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 0;
    max-width: 62ch;
    color: var(--ui-fg);
    font-size: 0.95rem;
    line-height: 1.45;
  }
  svg {
    flex: none;
    width: 15px;
    height: 15px;
    margin-top: 3px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
  }
</style>
