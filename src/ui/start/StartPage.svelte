<!--
  Start page: title, topic ring (or carousel when the ring does not fit), start arrow,
  faint presentation-mode trigger (bottom left; also key `p`).
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { QrCode } from '@lucide/svelte';
  import { router, stepHref } from '../../lib/router.svelte';
  import { store } from '../../lib/spec/store.svelte';
  import { CUSTOM_ID, CUSTOM_TOPIC, TOPICS } from '../../lib/spec/topics';
  import ArrowButton from '../shell/ArrowButton.svelte';
  import { ringLayout } from './ring';
  import { presenter } from '../present/presenter.svelte';
  import TopicRing from './TopicRing.svelte';
  import TopicCarousel from './TopicCarousel.svelte';

  interface Props {
    /** Ignore keyboard input (e.g. while the presentation overlay is open). */
    inert?: boolean;
  }
  let { inert = false }: Props = $props();

  const items = [...TOPICS, CUSTOM_TOPIC];

  // pre-select the topic the student came from
  const lastId = store.current?.topicId;
  let selected = $state<string | null>(lastId && items.some((t) => t.id === lastId) ? lastId : null);
  let customText = $state(store.savedCustomTitle() ?? '');
  let editing = $state(false);

  let stageW = $state(0);
  let stageH = $state(0);
  const layout = $derived(stageW && stageH ? ringLayout(stageW, stageH, items.length) : null);
  const mode = $derived(!stageW || !stageH ? 'none' : layout ? 'ring' : 'carousel');

  const canStart = $derived(!!selected && (selected !== CUSTOM_ID || customText.trim() !== ''));

  function start(id = selected) {
    if (!id) return;
    if (id === CUSTOM_ID) {
      const title = customText.trim();
      if (!title) {
        selected = CUSTOM_ID;
        editing = true;
        return;
      }
      store.openTopic(CUSTOM_ID, title);
    } else {
      store.openTopic(id);
    }
    router.go(stepHref(id, 'about'));
  }

  /** Click on a ring bubble / tap on the centred carousel bubble. */
  function pick(id: string) {
    if (id === CUSTOM_ID) {
      selected = CUSTOM_ID;
      editing = true;
    } else if (selected === id) {
      start(id);
    } else {
      selected = id;
    }
  }

  function customInput(text: string) {
    customText = text;
    if (text.trim()) selected = CUSTOM_ID;
  }
  function customBlur() {
    editing = false;
    if (!customText.trim() && selected === CUSTOM_ID && mode === 'ring') selected = null;
  }

  function move(delta: number) {
    const i = items.findIndex((t) => t.id === selected);
    const n = items.length;
    const next = i < 0 ? (delta > 0 ? 0 : n - 1) : (i + delta + n) % n;
    selected = items[next].id;
    // ring: focus moves with the selection (roving tab stop)
    if (mode === 'ring') {
      const id = selected;
      tick().then(() => document.querySelector<HTMLElement>(`.ring .bubble[data-topic="${id}"] button`)?.focus());
    }
  }

  function typing(t: EventTarget | null) {
    const el = t as HTMLElement | null;
    return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  function onkeydown(e: KeyboardEvent) {
    if (inert || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Enter':
        // a focused bubble handles Enter itself (click: select / start)
        if ((e.target as HTMLElement | null)?.closest?.('button, a')) return;
        if (selected) {
          e.preventDefault();
          start();
        }
        break;
      case 'Escape':
        if (mode === 'ring') selected = null;
        break;
    }
  }
</script>

<svelte:window {onkeydown} />

<main class="start" class:carousel-mode={mode === 'carousel'}>
  <h1>Z Specification Language</h1>
  {#if mode === 'carousel'}
    <p class="pick">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5h3l7.4-7.4a1.4 1.4 0 0 0 0-2l-1-1a1.4 1.4 0 0 0-2 0L2.5 10.5v3Z" /></svg>
      Pick a system
    </p>
  {/if}

  <div class="stage" bind:clientWidth={stageW} bind:clientHeight={stageH}>
    {#if mode === 'ring' && layout}
      <TopicRing
        {items}
        {layout}
        {selected}
        {customText}
        {editing}
        onpick={pick}
        oncustominput={customInput}
        oncustomsubmit={() => start(CUSTOM_ID)}
        oncustomblur={customBlur}
      />
    {:else if mode === 'carousel'}
      <div class="carousel-wrap">
        <TopicCarousel
          {items}
          {selected}
          {customText}
          {editing}
          height={stageH}
          onselect={(id) => {
            selected = id;
            if (id !== CUSTOM_ID) editing = false;
          }}
          onpick={pick}
          oncustominput={customInput}
          oncustomsubmit={() => start(CUSTOM_ID)}
          oncustomblur={customBlur}
        />
      </div>
    {/if}
  </div>

  <button
    type="button"
    class="present"
    class:on={presenter.on}
    aria-pressed={presenter.on}
    aria-label="Presenter mode"
    title="Presenter mode (P)"
    onclick={() => presenter.toggle()}
  >
    <QrCode size={18} strokeWidth={1.6} />
  </button>
</main>

<ArrowButton
  dir="next"
  label="Start"
  visible={mode === 'carousel' || canStart}
  onclick={() => start(mode === 'carousel' ? (selected ?? items[0].id) : selected)}
/>

<style>
  .start {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
    padding: 0 var(--gutter);
    padding-top: max(env(safe-area-inset-top), 0px);
  }
  h1 {
    margin: 0;
    padding-top: clamp(28px, 7.5vh, 76px);
    font-family: var(--font-z);
    font-weight: 400;
    font-size: clamp(2.1rem, 2.4vw + 2.2vh, 3.9rem);
    line-height: 1.1;
    letter-spacing: -0.01em;
    text-align: center;
    text-wrap: balance;
    animation: rise 0.7s var(--ease-out) backwards;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    width: 100%;
    /* keep clear of the fixed start arrow and the corner trigger */
    margin-bottom: clamp(8px, 2vh, 24px);
  }
  .carousel-mode .stage {
    width: calc(100% + 2 * var(--gutter));
    margin-bottom: 88px;
  }
  /* landscape phones: compact title; the arrow sits beside the centred content */
  @media (max-height: 520px) {
    h1 {
      padding-top: 14px;
      font-size: clamp(1.6rem, 6vh, 2.2rem);
    }
    .carousel-mode .stage {
      margin-bottom: 8px;
    }
  }
  .pick {
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--ui-fg);
    font-size: 1.05rem;
  }
  .pick svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
  }
  .carousel-wrap {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .present {
    position: fixed;
    left: max(14px, env(safe-area-inset-left));
    bottom: max(14px, env(safe-area-inset-bottom));
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 8px;
    color: var(--ui-fg);
    opacity: 0.3;
    transition:
      opacity 0.2s,
      background-color 0.2s;
  }
  .present.on {
    opacity: 0.7;
  }
  /* presenting: the join footer sits at the bottom; keep the ring clear of it */
  :global(html.presenting) .start {
    padding-bottom: 96px;
  }
  @media (max-width: 699px) {
    :global(html.presenting) .start {
      padding-bottom: 0;
    }
  }
  .present:hover,
  .present:focus-visible {
    opacity: 1;
    background: var(--ui-bg);
  }
</style>
