<!--
  Phone topic picker: circular horizontal scroll-snap carousel. The centred bubble is
  large and is the selection; neighbours peek in from both sides, scaled/faded
  continuously from the scroll position (rAF, no re-render per frame). Tap a neighbour
  to centre it; tap the centred bubble to start (own topic: edit its name). Mouse wheel
  steps one bubble.

  Circularity: the items are rendered three times; scrolling stays native. Once the
  scroll has settled outside the middle copy, the position jumps by one copy width.
  All copies look identical, so the jump is invisible.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { CUSTOM_ID, type TopicInfo } from '../../lib/spec/topics';
  import Bubble from './Bubble.svelte';

  interface Props {
    items: TopicInfo[];
    selected: string | null;
    customText: string;
    editing: boolean;
    /** Available height (px). */
    height: number;
    /** The centred bubble changed. */
    onselect: (id: string) => void;
    /** Tap on the centred bubble. */
    onpick: (id: string) => void;
    oncustominput: (text: string) => void;
    oncustomsubmit: () => void;
    oncustomblur: () => void;
  }
  let {
    items,
    selected,
    customText,
    editing,
    height,
    onselect,
    onpick,
    oncustominput,
    oncustomsubmit,
    oncustomblur,
  }: Props = $props();

  const COPIES = 3;
  const PEEK_SCALE = 0.62;
  const PEEK_OPACITY = 0.42;

  const n = $derived(items.length);
  const cells = $derived(Array.from({ length: n * COPIES }, (_, j) => items[j % n]));

  let scroller: HTMLDivElement | undefined = $state();
  let width = $state(0);
  const cell = $derived(width ? Math.round(Math.max(140, Math.min(width * 0.5, 260))) : 0);
  const size = $derived(Math.round(Math.max(96, Math.min(cell * 1.12, 250, height - 90))));
  const spacer = $derived(Math.max(0, (width - cell) / 2));

  const mod = (i: number) => ((i % n) + n) % n;
  const logicalOf = (id: string | null) => Math.max(0, items.findIndex((t) => t.id === id));

  /** Absolute index (0 … 3n-1) of the centred cell; starts in the middle copy. */
  let abs = $state(untrack(() => items.length + logicalOf(selected)));
  const centred = $derived(mod(abs));
  /** Last id passed to onselect (to tell our own reports from outside changes). */
  let reported: string | null = untrack(() => selected);

  // ── per-frame scale/opacity ────────────────────────────────────────────────
  let raf = 0;
  function update() {
    raf = 0;
    if (!scroller || !cell) return;
    const x = scroller.scrollLeft / cell;
    const scalers = scroller.querySelectorAll<HTMLElement>('.scaler');
    for (let j = 0; j < scalers.length; j++) {
      const d = Math.abs(j - x);
      const near = Math.min(d, 1);
      const far = Math.min(Math.max(d - 1, 0), 1);
      const el = scalers[j];
      el.style.transform = `scale(${(1 - (1 - PEEK_SCALE) * near - 0.12 * far).toFixed(4)})`;
      el.style.opacity = (1 - (1 - PEEK_OPACITY) * near - 0.3 * far).toFixed(3);
      el.style.zIndex = d < 0.5 ? '2' : '1';
    }
    const idx = Math.min(n * COPIES - 1, Math.max(0, Math.round(x)));
    if (idx !== abs) {
      abs = idx;
      const id = items[mod(idx)].id;
      if (id !== reported) {
        reported = id;
        onselect(id);
      }
    }
  }

  // ── silent wrap-around once the scroll has settled ──────────────────────────
  let touching = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  function recentre() {
    if (!scroller || !cell || touching) return;
    const active = document.activeElement;
    if (active?.tagName === 'INPUT' && scroller.contains(active)) return; // editing the own topic
    const idx = Math.round(scroller.scrollLeft / cell);
    if (idx >= n && idx < 2 * n) return;
    scroller.scrollLeft += (idx < n ? n : -n) * cell;
    update();
  }
  function settleLater() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(recentre, 160); // fallback where 'scrollend' is missing
  }
  function onscroll() {
    if (!raf) raf = requestAnimationFrame(update);
    settleLater();
  }

  function scrollToAbs(j: number, smooth = true) {
    if (!scroller) return;
    const k = Math.min(n * COPIES - 1, Math.max(0, j));
    scroller.scrollTo({ left: k * cell, behavior: smooth ? 'smooth' : 'instant' });
  }
  /** Scroll to the nearest copy of logical item i (shortest way round). */
  function scrollToLogical(i: number, smooth = true) {
    if (!scroller || !cell) return;
    const cur = scroller.scrollLeft / cell;
    let best = i;
    for (let k = 1; k < COPIES; k++) if (Math.abs(i + k * n - cur) < Math.abs(best - cur)) best = i + k * n;
    scrollToAbs(best, smooth);
  }

  // initial position, and keep the centred item on resize/rotation
  $effect(() => {
    if (!scroller || !cell) return;
    void spacer;
    untrack(() => {
      scroller!.scrollTo({ left: abs * cell, behavior: 'instant' });
      update();
    });
  });

  // selection changed from outside (keyboard)
  $effect(() => {
    const id = selected;
    if (id === reported) return;
    reported = id;
    untrack(() => scrollToLogical(logicalOf(id)));
  });

  // the wrap is postponed while the own topic's name is edited
  $effect(() => {
    if (!editing) untrack(settleLater);
  });

  $effect(() => {
    const el = scroller;
    if (!el) return;
    // vertical mouse wheel → one bubble per notch (trackpads scroll horizontally natively)
    let acc = 0;
    let lock = 0;
    const onwheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      const now = performance.now();
      if (now < lock) return;
      acc += e.deltaY;
      if (Math.abs(acc) >= 30) {
        scrollToAbs(abs + Math.sign(acc));
        acc = 0;
        lock = now + 320;
      }
    };
    const down = () => (touching = true);
    const up = () => {
      touching = false;
      settleLater();
    };
    const end = () => {
      clearTimeout(settleTimer);
      recentre();
    };
    el.addEventListener('wheel', onwheel, { passive: false });
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchend', up, { passive: true });
    el.addEventListener('touchcancel', up, { passive: true });
    el.addEventListener('scrollend', end);
    return () => {
      clearTimeout(settleTimer);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      el.removeEventListener('wheel', onwheel);
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
      el.removeEventListener('scrollend', end);
    };
  });

  function tap(j: number) {
    if (j === abs) onpick(items[mod(j)].id);
    else scrollToAbs(j);
  }
</script>

<div class="carousel" style:--cell="{cell}px" style:--size="{size}px">
  <div
    class="scroller"
    bind:this={scroller}
    bind:clientWidth={width}
    {onscroll}
    role="listbox"
    aria-label="Topics"
    aria-orientation="horizontal"
  >
    <div class="spacer" style:width="{spacer}px"></div>
    {#each cells as topic, j (j)}
      {@const clone = j < n || j >= 2 * n}
      <div class="cell" role={clone ? 'presentation' : 'option'} aria-selected={clone ? undefined : j % n === centred}>
        <div class="scaler">
          <Bubble
            {topic}
            {size}
            {clone}
            selected={j === abs}
            custom={topic.id === CUSTOM_ID}
            editing={topic.id === CUSTOM_ID && editing && j === abs}
            text={topic.id === CUSTOM_ID ? customText : ''}
            onclick={() => tap(j)}
            oninput={oncustominput}
            onsubmit={oncustomsubmit}
            onblur={oncustomblur}
          />
        </div>
      </div>
    {/each}
    <div class="spacer" style:width="{spacer}px"></div>
  </div>

  <div class="dots" role="tablist" aria-label="Topic">
    {#each items as topic, i (topic.id)}
      <button
        type="button"
        role="tab"
        aria-selected={i === centred}
        aria-label={topic.short}
        class:active={i === centred}
        onclick={() => scrollToLogical(i)}
      >
        <span></span>
      </button>
    {/each}
  </div>
</div>

<style>
  .carousel {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .scroller {
    width: 100%;
    display: flex;
    align-items: center;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    /* room for the selected ring and its all-around shadow (not clipped by the scroller) */
    padding: 72px 0;
    margin: -56px 0;
  }
  .scroller::-webkit-scrollbar {
    display: none;
  }
  .spacer {
    flex: none;
    height: 1px;
  }
  .cell {
    flex: none;
    width: var(--cell);
    height: var(--size);
    display: grid;
    place-items: center;
    scroll-snap-align: center;
    scroll-snap-stop: always;
    position: relative;
  }
  .scaler {
    position: relative;
    will-change: transform, opacity;
    transform-origin: center;
    /* until the first frame sets the real values */
    transform: scale(0.5);
    opacity: 0;
  }

  .dots {
    display: flex;
    gap: 2px;
    margin-top: 10px;
  }
  .dots button {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .dots span {
    display: block;
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: var(--ui-border);
    transition:
      width 0.3s var(--ease-out),
      background-color 0.3s;
  }
  .dots .active span {
    width: 18px;
    background: var(--ui-fg);
  }
</style>
