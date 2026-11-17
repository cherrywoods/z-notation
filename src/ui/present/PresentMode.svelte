<!--
  The big QR view: full-screen white overlay with a large QR code and the address
  students should open (see url.ts). Opened from the presenter footer's QR code;
  Esc / click / the close button return.
-->
<script lang="ts">
  import { X } from '@lucide/svelte';
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { presenter } from './presenter.svelte';
  import { qrSvg } from './qr';
  import { joinUrl } from './url';

  const url = joinUrl();
  const shown = url.replace(/^https?:\/\//, '').replace(/\/index\.html$/, '/').replace(/\/$/, '');
  // no quiet zone in the SVG: the white page around it is the quiet zone
  const qr = qrSvg(url, 0);

  let overlay: HTMLDivElement | undefined = $state();

  function close() {
    presenter.big = false;
  }

  $effect(() => {
    // focus the dialog (not the close button: no focus ring on the projector)
    overlay?.focus({ preventScroll: true });
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="present"
  role="dialog"
  aria-modal="true"
  aria-label="Join on your device"
  tabindex="-1"
  bind:this={overlay}
  onclick={close}
  transition:fade={{ duration: 220 }}
>
  <button type="button" class="close" aria-label="Close" title="Close (Esc)">
    <X size={22} />
  </button>

  <p class="title">Z Specification Language</p>
  <svg
    class="qr"
    viewBox="0 0 {qr.size} {qr.size}"
    shape-rendering="crispEdges"
    role="img"
    aria-label="QR code: {url}"
    in:scale={{ start: 0.94, duration: 380, easing: cubicOut }}
  >
    <rect width={qr.size} height={qr.size} fill="#fff" />
    <path d={qr.path} fill="#000" />
  </svg>
  <p class="url">{shown}</p>
</div>

<style>
  .present {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: #fff;
    color: #000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4vmin;
    padding: 3vmin;
    cursor: pointer;
    outline: none;
  }
  .title {
    margin: 0;
    font-family: var(--font-z);
    font-size: clamp(1rem, 3vmin, 2rem);
    color: var(--ui-fg);
  }
  .qr {
    width: 60vmin;
    height: 60vmin;
    display: block;
  }
  .url {
    margin: 0;
    max-width: 92vw;
    font-family: var(--font-ui);
    font-size: clamp(1.4rem, 5.2vmin, 4.2rem);
    font-weight: 600;
    letter-spacing: -0.01em;
    text-align: center;
    overflow-wrap: anywhere;
    line-height: 1.15;
  }
  .close {
    position: absolute;
    top: max(16px, env(safe-area-inset-top));
    right: max(16px, env(safe-area-inset-right));
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 1px solid var(--ui-border);
    background: #fff;
    color: var(--ui-fg);
    cursor: pointer;
    transition:
      color 0.2s,
      border-color 0.2s,
      transform 0.3s var(--ease-spring);
  }
  .close:hover {
    color: #000;
    border-color: #000;
    transform: scale(1.08);
  }
</style>
