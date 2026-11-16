<!--
  Big round arrow button, fixed in a bottom corner. `next` is solid black, `back` is white.
  With `href` it renders a link (in-app hash links go through the router).
-->
<script lang="ts">
  import { ArrowLeft, ArrowRight } from '@lucide/svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  interface Props {
    dir: 'next' | 'back';
    label: string;
    href?: string;
    onclick?: (e: MouseEvent) => void;
    visible?: boolean;
  }
  let { dir, label, href, onclick, visible = true }: Props = $props();

  const Icon = $derived(dir === 'next' ? ArrowRight : ArrowLeft);
  const dx = $derived(dir === 'next' ? 16 : -16);
</script>

{#if visible}
  <div class="corner {dir}" transition:fly={{ x: dx, duration: 260, easing: cubicOut }}>
    {#if href}
      <a class="arrow {dir}" {href} {onclick} aria-label={label} title={label}>
        <Icon size={26} strokeWidth={2} />
      </a>
    {:else}
      <button type="button" class="arrow {dir}" {onclick} aria-label={label} title={label}>
        <Icon size={26} strokeWidth={2} />
      </button>
    {/if}
  </div>
{/if}

<style>
  .corner {
    position: fixed;
    bottom: max(20px, calc(env(safe-area-inset-bottom) + 12px));
    z-index: 30;
  }
  .corner.next {
    right: max(var(--gutter), calc(env(safe-area-inset-right) + 12px));
  }
  .corner.back {
    left: max(var(--gutter), calc(env(safe-area-inset-left) + 12px));
  }

  .arrow {
    display: grid;
    place-items: center;
    width: var(--arrow-size, 64px);
    height: var(--arrow-size, 64px);
    border-radius: 50%;
    border: 1px solid var(--ui-fg-strong);
    cursor: pointer;
    text-decoration: none;
    padding: 0;
    -webkit-tap-highlight-color: transparent;
    transition:
      transform 0.35s var(--ease-spring),
      box-shadow 0.25s var(--ease-out),
      background-color 0.2s;
  }
  .arrow.next {
    background: var(--ui-fg-strong);
    color: var(--bg);
    box-shadow: var(--shadow-md);
  }
  .arrow.back {
    background: var(--bg);
    color: var(--ui-fg);
    border-color: var(--ui-border);
    box-shadow: var(--shadow-sm);
  }
  .arrow :global(svg) {
    transition: transform 0.35s var(--ease-spring);
  }
  @media (hover: hover) {
    .arrow:hover {
      transform: scale(1.08);
      box-shadow: var(--shadow-lg);
    }
    .arrow.back:hover {
      color: var(--ui-fg-strong);
      border-color: var(--ui-fg);
    }
    .arrow.next:hover :global(svg) {
      transform: translateX(3px);
    }
    .arrow.back:hover :global(svg) {
      transform: translateX(-3px);
    }
  }
  .arrow:active {
    transform: scale(0.96);
  }

  @media (max-width: 600px) {
    .arrow {
      --arrow-size: 56px;
    }
  }
  @media print {
    .corner {
      display: none;
    }
  }
</style>
