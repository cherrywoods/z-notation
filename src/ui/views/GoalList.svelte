<!--
  The step's goals under its top prompt: one line each, a status dot and the goal.
  Achieved: a green dot with a check (the check carries the meaning without colour),
  text a little darker. Open: a grey ring. A goal that becomes achieved pops once.
-->
<script lang="ts">
  import type { GoalStatus } from '../../lib/spec/live.svelte';

  let { goals }: { goals: GoalStatus[] } = $props();

  // Remember what was shown, so only a change to "achieved" animates (not the first view).
  const shown = new Map<string, boolean>();
  const items = $derived(goals.map((g) => ({ ...g, pop: g.achieved && shown.get(g.text) === false })));
  $effect(() => {
    for (const g of goals) shown.set(g.text, g.achieved);
  });
</script>

{#if goals.length}
  <ul class="goals" aria-label="Goals">
    {#each items as g (g.text)}
      <li class:done={g.achieved}>
        <span class="dot" class:pop={g.pop} role="img" aria-label={g.achieved ? 'achieved' : 'open'}>
          {#if g.achieved}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 6.2 5.1 8.3 9 4" /></svg>{/if}
        </span>
        <span class="text">{g.text}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .goals {
    --goal-done: #1a7f37; /* green, 5.1:1 on white */
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
    display: flex;
    align-items: baseline;
    gap: 9px;
    min-width: 0;
  }
  .text {
    min-width: 0;
    overflow-wrap: anywhere;
    transition: color 0.3s;
  }
  .done .text {
    color: var(--ui-fg-strong);
  }
  .dot {
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
  .done .dot {
    background: var(--goal-done);
    border-color: var(--goal-done);
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
</style>
