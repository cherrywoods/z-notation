<!--
  The step's goals under its top prompt: one line each, a status mark and the goal.
    green check  — the spec says it (its own lines)
    blue check   — not written here, but it follows (from the invariant or the frame)
    hollow check — held in every example tried, but not proven
    grey ring    — not yet
  The check carries the meaning without colour; the hover card (or a click) explains it:
  the derivation, the examples note, or a counterexample. Open goals always get a card
  that says the recognition may be wrong (lecturer's wording). A goal that becomes achieved
  pops once.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { live, type GoalStatus } from '../../lib/spec/live.svelte';
  import { explainCtxOf, givenNames } from '../../lib/spec/helpers';
  import { HOVER_DELAY } from '../explain/explain.svelte';
  import DerivationView from '../panels/DerivationView.svelte';
  import ValueView from '../panels/ValueView.svelte';
  import ZText from '../z/ZText.svelte';

  let { goals }: { goals: GoalStatus[] } = $props();

  const given = $derived(live.spec ? givenNames(live.spec.given) : []);
  const ctx = $derived(live.spec ? explainCtxOf(live.spec) : undefined);

  type Look = 'stated' | 'inferred' | 'probably' | 'open';
  const lookOf = (g: GoalStatus): Look =>
    !g.achieved ? 'open' : g.evidence?.kind === 'examples' ? 'probably' : g.via === 'inferred' ? 'inferred' : 'stated';
  const LABEL: Record<Look, string> = {
    stated: 'achieved',
    inferred: 'achieved, follows from the rest of the spec',
    probably: 'probably achieved, not proven',
    open: 'not yet',
  };
  /** Whether hovering the goal shows a card (open goals always: the checker can be wrong). */
  const explained = (g: GoalStatus) => !g.achieved || !!g.evidence || g.via === 'inferred';

  // Remember what was shown, so only a change to "achieved" animates (not the first view).
  const shown = new Map<string, boolean>();
  const items = $derived(goals.map((g) => ({ ...g, look: lookOf(g), pop: g.achieved && shown.get(g.text) === false })));
  $effect(() => {
    for (const g of goals) shown.set(g.text, g.achieved);
  });

  // ── hover card (after the help delay) / pinned card (click) ──
  let open = $state<{ text: string; pinned: boolean } | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => clearTimeout(timer);
  onDestroy(clear);

  function enter(text: string) {
    clear();
    if (open?.pinned) return;
    timer = setTimeout(() => (open = { text, pinned: false }), open ? 0 : HOVER_DELAY);
  }
  function leave() {
    clear();
    if (open && !open.pinned) timer = setTimeout(() => (open = null), 150);
  }
  function toggle(text: string) {
    clear();
    open = open?.pinned && open.text === text ? null : { text, pinned: true };
  }
  // a pinned card closes on a click elsewhere or Escape
  $effect(() => {
    if (!open?.pinned) return;
    const down = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.('.goals li.has-card')) open = null;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open = null;
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  });
  // a goal that disappears or changes its status closes its card
  $effect(() => {
    if (open && !items.some((g) => g.text === open!.text && explained(g))) open = null;
  });
</script>

{#if goals.length}
  <ul class="goals" aria-label="Goals">
    {#each items as g (g.text)}
      <li
        class={g.look}
        class:has-card={explained(g)}
        onpointerenter={explained(g) ? () => enter(g.text) : undefined}
        onpointerleave={explained(g) ? leave : undefined}
      >
        {#if explained(g)}
          <button
            type="button"
            class="line"
            aria-expanded={open?.text === g.text}
            onclick={() => toggle(g.text)}
          >
            {@render mark(g.look, g.pop)}
            <span class="text">{g.text}</span>
          </button>
        {:else}
          <span class="line">
            {@render mark(g.look, g.pop)}
            <span class="text">{g.text}</span>
          </span>
        {/if}
        {#if open?.text === g.text}
          <div class="card" class:pinned={open.pinned} role="note">
            {@render card(g)}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

{#snippet mark(look: Look, pop: boolean)}
  <span class="dot" class:pop role="img" aria-label={LABEL[look]}>
    {#if look !== 'open'}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 6.2 5.1 8.3 9 4" /></svg>{/if}
  </span>
{/snippet}

{#snippet card(g: GoalStatus)}
  {@const ev = g.evidence}
  {#if !g.achieved}
    {#if ev?.kind === 'counterexample'}
      <p>Not yet. Your spec allows this case:</p>
      <div class="vars">
        {#each ev.vars as v (v.name)}
          <span class="name"><ZText text={v.name} givenSets={given} {ctx} interactive={false} /></span>
          <span class="eq">=</span>
          <span class="val z-text"><ValueView value={v.value} /></span>
        {/each}
      </div>
    {/if}
    <p class="caveat">This goal recognition is not perfect :) Your solution might be just fine.</p>
  {:else if ev?.kind === 'examples'}
    <p>It held in every example tried, but that doesn't prove it.</p>
  {:else if ev?.kind === 'proof'}
    <p>{g.via === 'inferred' ? "You didn't write this here, but it follows:" : 'Your spec says this:'}</p>
    <DerivationView d={ev.derivation} {given} {ctx} />
  {:else}
    <p>You didn't write this here, but it follows from the rest of the spec.</p>
  {/if}
{/snippet}

<style>
  .goals {
    --goal-stated: #1a7f37; /* green, 5.1:1 on white */
    --goal-inferred: #0969da; /* blue, 5.2:1 on white */
    list-style: none;
    margin: -8px 0 0;
    /* aligned with the prompt text (indented under the stylus) */
    padding: 0 0 0 27px;
    display: grid;
    gap: 3px;
    max-width: 62ch;
    font-size: 0.95rem;
    line-height: 1.45;
    color: var(--ui-fg);
  }
  li {
    position: relative;
    min-width: 0;
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 9px;
    min-width: 0;
    /* reset for the button variant */
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
    text-align: left;
  }
  button.line {
    cursor: help;
  }
  button.line:focus-visible {
    outline: 2px solid var(--goal-inferred);
    outline-offset: 2px;
    border-radius: 3px;
  }
  .text {
    min-width: 0;
    overflow-wrap: anywhere;
    transition: color 0.3s;
  }
  li:not(.open) .text {
    color: var(--ui-fg-strong);
  }
  .dot {
    --c: var(--goal-stated);
    flex: none;
    position: relative;
    top: 2px;
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid var(--ui-fg-faint);
    transition:
      background-color 0.3s,
      border-color 0.3s;
  }
  .inferred .dot {
    --c: var(--goal-inferred);
  }
  .stated .dot,
  .inferred .dot {
    background: var(--c);
    border-color: var(--c);
  }
  /* hollow: coloured ring and check on white */
  .probably .dot {
    border-color: var(--goal-stated);
  }
  .dot svg {
    width: 11px;
    height: 11px;
    fill: none;
    stroke: #fff;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .probably .dot svg {
    stroke: var(--goal-stated);
  }
  .dot.pop {
    animation: pop 0.45s var(--ease-spring);
  }
  @keyframes pop {
    0% {
      transform: scale(0.6);
    }
    60% {
      transform: scale(1.25);
    }
    100% {
      transform: scale(1);
    }
  }

  .card {
    position: absolute;
    z-index: 30;
    top: calc(100% + 4px);
    left: 23px;
    width: max-content;
    max-width: min(440px, calc(100vw - 48px));
    background: var(--bg);
    color: var(--ui-fg-strong);
    border: 1px solid var(--ui-border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    padding: 10px 14px 12px;
    font-size: 14px;
    line-height: 1.45;
    cursor: auto;
    /* a hover card may cover the schema below: let the pointer through, so it closes
       when the pointer moves on (a click pins it and makes it interactive) */
    pointer-events: none;
  }
  .card.pinned {
    pointer-events: auto;
  }
  .card p {
    margin: 0 0 6px;
  }
  .card p:last-child {
    margin-bottom: 0;
  }
  .vars + .caveat {
    margin-top: 8px;
  }
  .caveat {
    color: var(--ui-fg);
  }
  .vars {
    display: grid;
    grid-template-columns: fit-content(40%) max-content minmax(0, 1fr);
    column-gap: 8px;
    row-gap: 2px;
    align-items: baseline;
  }
  .name,
  .eq,
  .val {
    font-family: var(--font-z);
    font-size: calc(1rem * var(--z-scale, 1));
    color: var(--fg);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .name :global(.z-text) {
    font-size: calc(1rem * var(--z-scale, 1));
  }
</style>
