<!--
  Step: the whole specification, typeset; "Save as PDF" prints just this document.
  Contract: props { spec }; one <TutorialColumns> with only `main`.
-->
<script lang="ts">
  import type { SchemaDoc, SectionPart, SpecDoc } from '../../lib/spec/model';
  import TutorialColumns from '../shell/TutorialColumns.svelte';
  import StaticSchema from '../views/StaticSchema.svelte';
  import ZText from '../z/ZText.svelte';
  import { givenNames, explainCtxOf, schemaNameError } from '../../lib/spec/helpers';
  import { live } from '../../lib/spec/live.svelte';

  let { spec }: { spec: SpecDoc } = $props();

  const given = $derived(givenNames(spec.given));
  const ctx = $derived(explainCtxOf(spec));
  const schemas = $derived([spec.state, ...(spec.init ? [spec.init] : []), ...spec.operations]);
  const showGiven = $derived(spec.given.replace(/[\s[\]]/g, '') !== '');

  /** Lines (0-based) of a section that have errors. */
  function errorLines(text: string, schemaId: string, part: SectionPart): Set<number> {
    const lines = new Set<number>();
    const lineAt = (offset: number) => text.slice(0, Math.max(0, offset)).split('\n').length - 1;
    for (const d of live.diagnostics) {
      if (d.severity !== 'error' || d.section.schemaId !== schemaId || d.section.part !== part) continue;
      const a = lineAt(d.from);
      const b = lineAt(Math.max(d.from, d.to - 1));
      for (let i = a; i <= b; i++) lines.add(i);
    }
    return lines;
  }

  /** Nothing written yet (operations: no predicates yet). */
  const incomplete = (s: SchemaDoc) => (s.role === 'operation' ? !s.preds.trim() : !s.decls.trim() && !s.preds.trim());

  const rows = $derived(
    schemas.map((s) => ({
      s,
      nameError: schemaNameError(spec, s.id, s.name),
      declErrors: errorLines(s.decls, s.id, 'decls'),
      predErrors: errorLines(s.preds, s.id, 'preds'),
      incomplete: incomplete(s),
    })),
  );
  const givenErrors = $derived(errorLines(spec.given, 'types', 'given'));
  const hasErrors = $derived(
    givenErrors.size > 0 || rows.some((r) => r.nameError || r.declErrors.size || r.predErrors.size),
  );
  const note = $derived(
    hasErrors ? 'Some schemas have errors.' : rows.some((r) => r.incomplete) ? 'Some schemas are incomplete.' : '',
  );

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
      {#if note}<p class="note">{note}</p>{/if}
      {#if showGiven}
        <div class="given">
          <ZText text={spec.given} givenSets={given} {ctx} block class={givenErrors.size ? 'err-line' : ''} />
        </div>
      {/if}
      {#each rows as r (r.s.id)}
        <StaticSchema
          name={r.s.name}
          decls={r.s.decls}
          preds={r.s.preds}
          givenSets={given}
          {ctx}
          nameError={r.nameError}
          incomplete={r.incomplete}
          declErrors={r.declErrors}
          predErrors={r.predErrors}
        />
      {/each}
    </article>
  {/snippet}
</TutorialColumns>

<style>
  .spec-doc {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 34px;
    max-width: 820px;
    min-width: 0;
  }
  .note {
    margin: -18px 0 0;
    font-size: 0.9rem;
    color: var(--ui-fg);
  }
  .given :global(.err-line) {
    text-decoration: underline wavy var(--error);
    text-decoration-skip-ink: none;
    text-underline-offset: 4px;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }
  h1 {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
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
    font-size: calc(1.3rem * var(--z-scale, 1));
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
    .pdf,
    .note {
      display: none;
    }
  }
</style>
