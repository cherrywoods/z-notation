<script lang="ts">
  // "Testing the spec": a concrete example of the current step (given-set values,
  // a state, the initial state, or one run of an operation), regenerated on demand.
  import { live } from '../../lib/spec/live.svelte';
  import { generator } from '../../lib/spec/engine';
  import { explainCtxOf, givenNames } from '../../lib/spec/helpers';
  import type { OpExample, PredCheck, ShownVar, StateExample, TypesExample } from '../../lib/z/results';
  import ValueView from './ValueView.svelte';
  import ZText from '../z/ZText.svelte';

  let { schemaId }: { schemaId: string } = $props();

  const newSeed = () => Math.floor(Math.random() * 2 ** 31);
  let seed = $state(newSeed());
  let mode = $state<'applicable' | 'blocked'>('applicable');
  let spin = $state(0);

  const isOp = $derived(schemaId.startsWith('op-'));
  const given = $derived(live.spec ? givenNames(live.spec.given) : []);
  const ctx = $derived(live.spec ? explainCtxOf(live.spec) : undefined);

  type Result = TypesExample | StateExample | OpExample;
  const result = $derived.by((): Result | null => {
    const an = live.analysis;
    const spec = live.spec;
    if (!an || !spec || !generator) return null;
    try {
      if (schemaId === 'types') return generator.exampleTypes(spec, an, seed);
      if (schemaId === 'state') return generator.exampleState(spec, an, seed);
      if (schemaId === 'init') return generator.exampleInit(spec, an, seed);
      return generator.exampleOperation(spec, an, schemaId, seed, mode);
    } catch (e) {
      console.error('[example]', e);
      return null;
    }
  });

  function regenerate() {
    seed = newSeed();
    spin++;
  }

  /** Predicates worth listing under an example (the step's own lines). */
  const ownChecks = (checks: PredCheck[]) => checks.filter((c) => c.origin === 'own');
  const beforeOf = (vars: ShownVar[], name: string) => vars.find((v) => v.name === name.replace('′', ''))?.value;
</script>

<section class="panel" aria-label="Example">
  <header>
    <h2>Example</h2>
    <div class="tools">
      {#if isOp}
        <button
          type="button"
          class="tool"
          class:on={mode === 'blocked'}
          aria-pressed={mode === 'blocked'}
          aria-label="Show a case where the operation is blocked"
          title="Blocked case"
          onclick={() => {
            mode = mode === 'blocked' ? 'applicable' : 'blocked';
            seed = newSeed();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></svg>
        </button>
      {/if}
      <button type="button" class="tool" aria-label="New example" title="New example" onclick={regenerate}>
        <svg viewBox="0 0 24 24" aria-hidden="true" style:transform={`rotate(${spin * 360}deg)`}
          ><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v4.5h-4.5" /></svg
        >
      </button>
    </div>
  </header>

  {#if !result}
    <p class="muted">…</p>
  {:else if result.kind === 'types'}
    <div class="vars">
      {#each result.carriers as c (c.name)}
        <span class="name">{c.name}</span><span class="eq">=</span>
        <span class="val z-text"><span class="z-set">{'{'}</span>{c.values.join(', ')}<span class="z-set">{'}'}</span></span>
      {/each}
    </div>
  {:else if result.kind === 'state'}
    {#if result.ok}
      {@render vars(result.vars)}
      {@render checks(result.checks.filter((c) => c.origin !== 'invariant′'))}
    {:else}
      <p class="muted">{result.message}</p>
      {#if result.best}
        {@render vars(result.best.vars)}
        {@render checks(result.best.failed)}
      {/if}
    {/if}
  {:else if result.ok}
    <div class="op">
      {#if result.before.length}<h3>before</h3>{@render vars(result.before)}{/if}
      {#if result.inputs.length}<h3>input</h3>{@render vars(result.inputs)}{/if}
      {#if result.status === 'blocked'}
        <h3>blocked by</h3>
        {@render checks(result.failed ?? [])}
      {:else}
        {#if result.after.length}<h3>after</h3>{@render vars(result.after, result.before)}{/if}
        {#if result.outputs.length}<h3>output</h3>{@render vars(result.outputs)}{/if}
        {@render checks(ownChecks(result.checks))}
      {/if}
    </div>
  {:else}
    <p class="muted">{result.message}</p>
    {#if result.before?.length}<h3>before</h3>{@render vars(result.before)}{/if}
    {#if result.inputs?.length}<h3>input</h3>{@render vars(result.inputs)}{/if}
    {#if result.failed?.length}{@render checks(result.failed)}{/if}
  {/if}
</section>

{#snippet vars(list: ShownVar[], before?: ShownVar[])}
  <div class="vars">
    {#each list as v (v.name)}
      <span class="name" class:same={v.status === 'unchanged'}><ZText text={v.name} givenSets={given} {ctx} /></span>
      <span class="eq" class:same={v.status === 'unchanged'}>=</span>
      <span class="val z-text" class:same={v.status === 'unchanged'}>
        <ValueView value={v.value} before={before ? beforeOf(before, v.name) : undefined} />
        {#if v.status === 'free'}
          <button type="button" class="free" aria-label={`Not determined by the spec. Also possible: ${v.alternative ?? ''}`}
            >?<span class="tip">Not fixed by the spec — also possible:<br /><span class="z-text">{v.alternative}</span></span></button
          >
        {/if}
      </span>
    {/each}
  </div>
{/snippet}

{#snippet checks(list: PredCheck[])}
  {#if list.length}
    <ul class="checks">
      {#each list as c, i (i)}
        <li class:bad={c.result !== true}>
          <span class="mark" aria-label={c.result === true ? 'holds' : 'fails'}>{c.result === true ? '✓' : '✗'}</span>
          <span class="pred"><ZText text={c.text} givenSets={given} {ctx} /></span>
          {#if c.message}<span class="msg">{c.message}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<style>
  .panel {
    background: var(--ui-bg);
    border: 1px solid var(--ui-border);
    border-radius: var(--radius);
    padding: 12px 18px 16px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 32px;
  }
  h2 {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ui-fg);
  }
  h3 {
    margin: 12px 0 2px;
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--ui-fg);
  }
  .tools {
    display: flex;
    gap: 4px;
  }
  .tool {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--ui-fg);
    cursor: pointer;
    transition:
      transform 0.15s var(--ease-spring),
      background 0.15s,
      border-color 0.15s;
  }
  .tool:hover {
    background: var(--bg);
    border-color: var(--ui-border);
    transform: scale(1.1);
  }
  .tool.on {
    background: var(--bg);
    border-color: var(--ui-fg-faint);
    color: var(--ui-fg-strong);
  }
  .tool svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 0.5s var(--ease-out);
  }
  .vars {
    display: grid;
    grid-template-columns: max-content max-content minmax(0, 1fr);
    column-gap: 8px;
    row-gap: 2px;
    align-items: baseline;
    margin-top: 6px;
  }
  .name,
  .eq {
    font-family: var(--font-z);
    font-size: 1.05rem;
    color: var(--fg);
  }
  .name :global(.z-text) {
    font-size: 1.05rem;
  }
  .val {
    font-size: 1.05rem;
    color: var(--fg);
  }
  /* after-state values equal to the before-state recede, changes stand out */
  .same {
    opacity: 0.5;
  }
  .free {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    margin-left: 6px;
    border-radius: 999px;
    border: 1px solid var(--z-schema);
    color: var(--z-schema);
    font-family: var(--font-ui);
    font-size: 0.72rem;
    font-weight: 600;
    cursor: help;
    vertical-align: 2px;
    background: transparent;
    padding: 0;
  }
  .free .tip {
    position: absolute;
    right: 0;
    bottom: calc(100% + 6px);
    width: max-content;
    max-width: 280px;
    padding: 8px 10px;
    background: var(--bg);
    color: var(--ui-fg-strong);
    border: 1px solid var(--ui-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-md);
    font-weight: 400;
    font-size: 0.82rem;
    line-height: 1.4;
    opacity: 0;
    pointer-events: none;
    transform: translateY(4px);
    transition:
      opacity 0.15s,
      transform 0.15s;
    z-index: 10;
  }
  .free:hover .tip,
  .free:focus .tip {
    opacity: 1;
    transform: none;
    transition-delay: 0.35s;
  }
  .checks {
    list-style: none;
    margin: 12px 0 0;
    padding: 10px 0 0;
    border-top: 1px solid var(--ui-border);
    display: grid;
    gap: 2px;
  }
  .checks li {
    display: grid;
    grid-template-columns: 1.2em minmax(0, 1fr);
    column-gap: 6px;
    align-items: baseline;
  }
  .mark {
    color: var(--ok);
    font-size: 0.9rem;
  }
  .bad .mark {
    color: var(--bad);
  }
  .pred :global(.z-text) {
    font-size: 1rem;
  }
  .msg {
    grid-column: 2;
    font-size: 0.8rem;
    color: var(--ui-fg);
  }
  .muted {
    margin: 6px 0 0;
    color: var(--ui-fg);
    font-size: 0.9rem;
  }
</style>
