<!--
  Step row: Types · State · <Op> Ξ · <Op> Δ · + · Init · Spec.
  `+` adds an operation; while there is no Init it first asks: Operation or Init.
  Narrow screens: scrolls horizontally, the current step is kept in view.
-->
<script lang="ts">
  import { Plus } from '@lucide/svelte';
  import { fly } from 'svelte/transition';
  import { stepHref } from '../../lib/router.svelte';
  import { opBadge, type StepInfo } from './steps';

  interface Props {
    topicId: string;
    steps: StepInfo[];
    current: string;
    /** Offer "Init" next to "Operation" (only while the spec has no Init). */
    canAddInit: boolean;
    onadd: (what: 'operation' | 'init') => void;
  }
  let { topicId, steps, current, canAddInit, onadd }: Props = $props();

  type Entry = { kind: 'step'; step: StepInfo } | { kind: 'add' };
  const entries = $derived.by(() => {
    const out: Entry[] = [];
    for (const step of steps) {
      // new operations appear where the `+` is: after the last operation
      if ((step.id === 'init' || step.id === 'spec') && !out.some((e) => e.kind === 'add')) out.push({ kind: 'add' });
      out.push({ kind: 'step', step });
    }
    return out;
  });

  // ── the small Operation / Init choice ───────────────────────────────────────
  let menu = $state<{ x: number; y: number } | null>(null);
  let menuEl: HTMLElement | undefined = $state();
  let addBtn: HTMLButtonElement | undefined = $state();

  function plus() {
    if (!canAddInit) return onadd('operation');
    if (menu) return (menu = null);
    const r = addBtn!.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 80), window.innerWidth - 80);
    menu = { x, y: r.bottom + 8 };
  }
  function choose(what: 'operation' | 'init') {
    menu = null;
    onadd(what);
  }

  $effect(() => {
    if (!menu) return;
    menuEl?.querySelector('button')?.focus({ preventScroll: true });
    const close = () => (menu = null);
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuEl?.contains(t) && !addBtn?.contains(t)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        addBtn?.focus();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  });

  let scroller: HTMLElement | undefined = $state();

  // keep the current step visible when the row scrolls
  $effect(() => {
    void current;
    void steps.length;
    const el = scroller?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!scroller || !el || scroller.scrollWidth <= scroller.clientWidth) return;
    const left = el.offsetLeft - (scroller.clientWidth - el.offsetWidth) / 2;
    scroller.scrollTo({ left, behavior: 'smooth' });
  });
</script>

<nav class="row" aria-label="Steps" bind:this={scroller}>
  <ol>
    {#each entries as e, i (e.kind === 'add' ? '+' : e.step.id)}
      {#if i > 0}<li class="sep" aria-hidden="true">·</li>{/if}
      {#if e.kind === 'add'}
        <li>
          <button
            type="button"
            class="add"
            class:open={!!menu}
            bind:this={addBtn}
            onclick={plus}
            title={canAddInit ? 'Add' : 'Add operation'}
            aria-label={canAddInit ? 'Add' : 'Add operation'}
            aria-haspopup={canAddInit ? 'menu' : undefined}
            aria-expanded={canAddInit ? !!menu : undefined}
          >
            <Plus size={15} strokeWidth={2.2} />
          </button>
        </li>
      {:else}
        <li>
          <a
            class="step"
            href={stepHref(topicId, e.step.id)}
            aria-current={e.step.id === current ? 'step' : undefined}
          >
            {e.step.label}{#if e.step.opKind}<span
                class="badge"
                title={e.step.opKind === 'query' ? 'query (Ξ: state unchanged)' : 'update (Δ: state changes)'}
                >{opBadge(e.step.opKind)}</span
              >{/if}
          </a>
        </li>
      {/if}
    {/each}
  </ol>
</nav>

{#if menu}
  <div
    class="menu"
    role="menu"
    bind:this={menuEl}
    style:left="{menu.x}px"
    style:top="{menu.y}px"
    transition:fly={{ y: -4, duration: 160 }}
  >
    <button type="button" role="menuitem" onclick={() => choose('operation')}>Operation</button>
    <button type="button" role="menuitem" onclick={() => choose('init')}>Init</button>
  </div>
{/if}

<style>
  .row {
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    mask-image: linear-gradient(to right, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%);
  }
  .row::-webkit-scrollbar {
    display: none;
  }
  ol {
    display: flex;
    align-items: center;
    gap: 2px;
    list-style: none;
    margin: 0 auto;
    padding: 0 12px;
    width: max-content;
    font-size: 0.875rem;
    white-space: nowrap;
  }
  .sep {
    color: var(--ui-fg-faint);
    padding: 0 1px;
    user-select: none;
    transition: color 0.2s;
  }
  .step,
  .add {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 30px;
    padding: 0 10px;
    border-radius: 999px;
    color: var(--ui-fg);
    text-decoration: none;
    transition:
      color 0.18s,
      background-color 0.18s;
  }
  .add {
    width: 30px;
    padding: 0;
    justify-content: center;
    border: 1px dashed var(--ui-fg-faint);
    background: none;
    cursor: pointer;
    transition:
      color 0.18s,
      background-color 0.18s,
      border-color 0.18s,
      transform 0.3s var(--ease-spring);
  }
  .badge {
    font-family: var(--font-z-symbols);
    font-size: 0.95em;
  }
  .step[aria-current='step'] {
    color: var(--ui-fg-strong);
    font-weight: 600;
  }

  /* hovering the row reveals it */
  @media (hover: hover) {
    .step:hover {
      color: var(--fg);
      background: var(--ui-border);
    }
    .add:hover {
      color: var(--fg);
      border-color: var(--ui-fg);
      border-style: solid;
      background: var(--ui-border);
      transform: scale(1.1);
    }
  }
  .step:focus-visible,
  .add:focus-visible {
    color: var(--fg);
  }
  .add.open {
    color: var(--fg);
    border-style: solid;
    border-color: var(--ui-fg);
  }

  .menu {
    position: fixed;
    z-index: 40;
    transform: translateX(-50%);
    display: flex;
    gap: 2px;
    padding: 4px;
    background: var(--bg);
    border: 1px solid var(--ui-border);
    border-radius: 999px;
    box-shadow: var(--shadow-md);
  }
  .menu button {
    height: 30px;
    padding: 0 14px;
    border: none;
    border-radius: 999px;
    background: none;
    color: var(--ui-fg);
    font-size: 0.875rem;
    cursor: pointer;
    transition:
      color 0.18s,
      background-color 0.18s;
  }
  .menu button:hover,
  .menu button:focus-visible {
    color: var(--fg);
    background: var(--ui-bg);
  }
  .menu button:focus-visible {
    outline-offset: -2px;
  }
</style>
