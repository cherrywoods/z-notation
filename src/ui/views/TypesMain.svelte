<script lang="ts">
  // Step 1: the given sets `[PATIENT, DRUG]`. Common given sets (NAME, DATE, …) sit in a
  // raised bar on the left and are added with one click.
  import ZEditor from '../editor/ZEditor.svelte';
  import Prompt from './Prompt.svelte';
  import { givenNames, explainCtxOf } from '../../lib/spec/helpers';
  import { DEFAULT_SETS, type DefaultSet } from '../../lib/spec/defaults';
  import { live } from '../../lib/spec/live.svelte';
  import { explain } from '../explain/explain.svelte';
  import type { SpecDoc } from '../../lib/spec/model';

  let { spec }: { spec: SpecDoc } = $props();

  const names = $derived(givenNames(spec.given));
  const available = $derived(DEFAULT_SETS.filter((d) => !names.includes(d.name)));

  function addDefault(d: DefaultSet) {
    spec.given = `[${[...names, d.name].join(', ')}]`;
    if (!spec.pools[d.name]) spec.pools[d.name] = [...d.values];
    if (d.infinite && !(spec.infinite ?? []).includes(d.name)) spec.infinite = [...(spec.infinite ?? []), d.name];
  }
</script>

<div class="types" class:with-bar={available.length > 0}>
  {#if available.length}
    <nav class="bar" aria-label="Common given sets">
      {#each available as d (d.name)}
        <button
          type="button"
          class="add"
          onclick={() => addDefault(d)}
          onmouseenter={(e) =>
            explain.show({ id: 'given', anchor: (e.currentTarget as HTMLElement).getBoundingClientRect(), ctx: { subject: d.name } })}
          onmouseleave={() => explain.hide()}
        >
          <span class="plus" aria-hidden="true">+</span>{d.name}
        </button>
      {/each}
    </nav>
  {/if}

  <div class="content">
    <Prompt text={spec.typesPrompt} />
    <div class="given">
      <ZEditor
        bind:value={spec.given}
        placeholder="[BOOK, MEMBER]"
        givenSets={names}
        explainCtx={explainCtxOf(spec)}
        diagnostics={live.diagnosticsFor('types', 'given')}
        ariaLabel="Given sets"
      />
    </div>
  </div>
</div>

<style>
  .types {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
    align-items: start;
  }
  .types.with-bar {
    grid-template-columns: max-content minmax(0, 1fr);
    gap: clamp(20px, 3vw, 36px);
  }
  .content {
    display: grid;
    gap: 18px;
    min-width: 0;
  }
  /* raised tool bar on the left */
  .bar {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    background: var(--bg);
    border: 1px solid var(--ui-border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-md);
    position: sticky;
    top: calc(var(--header-h) + 16px);
  }
  .add {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 12px 6px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--ui-fg);
    font-family: var(--font-z);
    font-size: 1rem;
    text-align: left;
    cursor: pointer;
    transition:
      transform 0.15s var(--ease-spring),
      background 0.15s,
      color 0.15s;
  }
  .add:hover {
    background: var(--ui-bg);
    color: var(--ui-fg-strong);
    transform: translateX(2px) scale(1.04);
  }
  .add:active {
    transform: scale(0.97);
  }
  .plus {
    font-family: var(--font-ui);
    color: var(--ui-fg-faint);
  }
  .given {
    padding: 14px 18px;
    border-left: 1.5px solid var(--fg);
  }
  .given :global(.cm-editor) {
    font-size: 1.45rem;
  }
  /* phones: the bar becomes a row above the editor */
  @media (max-width: 640px) {
    .types.with-bar {
      grid-template-columns: minmax(0, 1fr);
    }
    .bar {
      position: static;
      flex-direction: row;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .add {
      flex: none;
    }
  }
</style>
