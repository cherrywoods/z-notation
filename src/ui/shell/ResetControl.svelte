<!-- Small reset control with an inline confirmation (no window.confirm). -->
<script lang="ts">
  import { RotateCcw, X } from '@lucide/svelte';
  import { fade, fly } from 'svelte/transition';

  interface Props {
    onreset: () => void;
  }
  let { onreset }: Props = $props();

  let confirming = $state(false);
  let box: HTMLElement | undefined = $state();
  let yes: HTMLButtonElement | undefined = $state();

  $effect(() => {
    if (!confirming) return;
    yes?.focus();
    const timer = setTimeout(() => (confirming = false), 6000);
    const outside = (e: PointerEvent) => {
      if (box && !box.contains(e.target as Node)) confirming = false;
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') confirming = false;
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc);
    };
  });

  function reset() {
    confirming = false;
    onreset();
  }
</script>

<div class="reset" bind:this={box}>
  {#if confirming}
    <div class="confirm" in:fly={{ x: 12, duration: 200 }}>
      <span class="q">Start over?</span>
      <button type="button" class="yes" bind:this={yes} onclick={reset}>Reset</button>
      <button type="button" class="icon" onclick={() => (confirming = false)} aria-label="Cancel" title="Cancel">
        <X size={16} />
      </button>
    </div>
  {:else}
    <button
      type="button"
      class="icon"
      onclick={() => (confirming = true)}
      aria-label="Reset this topic"
      title="Reset this topic"
      in:fade={{ duration: 150 }}
    >
      <RotateCcw size={16} />
    </button>
  {/if}
</div>

<style>
  .reset {
    display: flex;
    justify-content: flex-end;
  }
  .confirm {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .q {
    font-size: 0.85rem;
    color: var(--ui-fg);
    padding-right: 2px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: none;
    color: var(--ui-fg);
    cursor: pointer;
    transition:
      color 0.18s,
      background-color 0.18s;
  }
  .yes {
    height: 30px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--ui-fg-strong);
    background: var(--ui-fg-strong);
    color: var(--bg);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.25s var(--ease-spring);
  }
  @media (hover: hover) {
    .icon:hover {
      color: var(--ui-fg-strong);
      background: var(--ui-border);
    }
    .yes:hover {
      transform: scale(1.05);
    }
  }
  @media (max-width: 480px) {
    .q {
      display: none;
    }
  }
</style>
