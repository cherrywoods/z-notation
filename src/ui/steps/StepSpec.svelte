<!--
  Step: the whole specification, typeset; "Save as PDF" prints just this document.
  Contract: props { spec }; one <TutorialColumns> with only `main`.
-->
<script lang="ts">
  import type { SpecDoc } from '../../lib/spec/model';
  import TutorialColumns from '../shell/TutorialColumns.svelte';
  import StaticSchema from '../views/StaticSchema.svelte';
  import ZText from '../z/ZText.svelte';
  import { givenNames, explainCtxOf } from '../../lib/spec/helpers';

  let { spec }: { spec: SpecDoc } = $props();

  const given = $derived(givenNames(spec.given));
  const ctx = $derived(explainCtxOf(spec));
  const schemas = $derived([spec.state, ...(spec.init ? [spec.init] : []), ...spec.operations]);

  function print() {
    const old = document.title;
    document.title = spec.title;
    window.print();
    document.title = old;
  }
</script>

<TutorialColumns>
  {#snippet main()}
    <article class="spec-doc">
      <header>
        <h1>{spec.title}</h1>
        <button type="button" class="pdf" onclick={print}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" /></svg>
          PDF
        </button>
      </header>
      {#if spec.given.trim()}
        <div class="given"><ZText text={spec.given} givenSets={given} {ctx} block /></div>
      {/if}
      {#each schemas as s (s.id)}
        <StaticSchema name={s.name} decls={s.decls} preds={s.preds} givenSets={given} {ctx} />
      {/each}
    </article>
  {/snippet}
</TutorialColumns>

<style>
  .spec-doc {
    display: grid;
    gap: 34px;
    max-width: 820px;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }
  h1 {
    margin: 0;
    font-family: var(--font-z);
    font-weight: 400;
    font-size: clamp(1.6rem, 3vw, 2.2rem);
  }
  .pdf {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border: 1px solid var(--ui-border);
    border-radius: 999px;
    background: var(--ui-bg);
    color: var(--ui-fg-strong);
    cursor: pointer;
    font-size: 0.95rem;
    transition:
      transform 0.15s var(--ease-spring),
      border-color 0.15s,
      box-shadow 0.15s;
  }
  .pdf:hover {
    transform: scale(1.05);
    border-color: var(--fg-muted);
    box-shadow: var(--shadow-sm);
  }
  .pdf svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .given :global(.z-text) {
    font-size: 1.3rem;
  }

  @media print {
    :global(body *) {
      visibility: hidden;
    }
    .spec-doc,
    .spec-doc :global(*) {
      visibility: visible;
    }
    .spec-doc {
      position: absolute;
      inset: 0 auto auto 0;
      width: 100%;
      max-width: none;
      gap: 26px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .pdf {
      display: none;
    }
  }
</style>
