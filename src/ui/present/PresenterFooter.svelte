<!--
  Presenter mode footer (projector): a raised bar at the bottom of every page with a
  small QR code and the address students should open. The QR code opens a large view;
  a ✕ (on hover) leaves presenter mode. Hidden on phones.
-->
<script lang="ts">
  import { X } from '@lucide/svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { presenter } from './presenter.svelte';
  import { qrSvg } from './qr';
  import { joinUrl } from './url';

  const url = joinUrl();
  const shown = url.replace(/^https?:\/\//, '').replace(/\/index\.html$/, '/').replace(/\/$/, '');
  const qr = qrSvg(url, 1);
</script>

<footer class="join" aria-label="Join on your device" transition:fly={{ y: 24, duration: 280, easing: cubicOut }}>
  <button type="button" class="qr" onclick={() => (presenter.big = true)} aria-label="Show a large QR code" title="Larger QR code">
    <svg viewBox="0 0 {qr.size} {qr.size}" shape-rendering="crispEdges" aria-hidden="true">
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#000" />
    </svg>
  </button>
  <span class="url" title={url}>{shown}</span>
  <button type="button" class="off" onclick={() => presenter.set(false)} aria-label="Leave presenter mode" title="Leave presenter mode (P)">
    <X size={14} strokeWidth={2} />
  </button>
</footer>

<style>
  .join {
    position: fixed;
    left: 50%;
    bottom: max(20px, calc(env(safe-area-inset-bottom) + 12px));
    z-index: 25;
    transform: translateX(-50%);
    width: min(clamp(560px, 46vw, 680px), calc(100vw - 2 * (var(--gutter) + 92px)));
    height: 64px;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 40px 0 6px;
    background: var(--bg);
    border: 1.5px solid var(--edge-raised);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-raised);
  }
  .qr {
    flex: none;
    width: 52px;
    height: 52px;
    padding: 0;
    border: none;
    border-radius: 12px;
    background: #fff;
    cursor: zoom-in;
    transition: transform 0.3s var(--ease-spring);
  }
  .qr:hover {
    transform: scale(1.06);
  }
  .qr svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    font-size: clamp(1.2rem, 1.9vw, 1.6rem);
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--fg);
  }
  /* leaving the mode: only on hover / keyboard focus */
  .off {
    position: absolute;
    right: 10px;
    top: 50%;
    translate: 0 -50%;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--ui-fg);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity 0.2s,
      background-color 0.2s;
  }
  .join:hover .off,
  .off:focus-visible {
    opacity: 1;
  }
  .off:hover {
    color: var(--ui-fg-strong);
    background: var(--ui-bg);
  }
  @media (max-width: 699px) {
    .join {
      display: none;
    }
  }
  @media print {
    .join {
      display: none;
    }
  }
</style>
