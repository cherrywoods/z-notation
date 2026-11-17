<script lang="ts">
  // Content of an explainer popover. Compact (hover): symbol, title, short, definition.
  // Pinned (click): + example, diagram, notes, back/close buttons.
  import X from '@lucide/svelte/icons/x';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import type { Explainer, ExplainerContext } from '../../lib/content/explainers';
  import ZText from '../z/ZText.svelte';
  import RichText from './RichText.svelte';
  import MiniSchema from './MiniSchema.svelte';
  import ArrowDiagram from './ArrowDiagram.svelte';

  interface Props {
    ex: Explainer;
    ctx?: ExplainerContext;
    pinned: boolean;
    canBack?: boolean;
    titleId: string;
    onclose?: () => void;
    onback?: () => void;
  }
  let { ex, ctx, pinned, canBack = false, titleId, onclose, onback }: Props = $props();

  /** Sets coloured as types inside the card: generic X, Y and those of the example systems. */
  const CARD_GIVEN = ['X', 'Y', 'PATIENT', 'DRUG', 'ACCOUNT', 'PERSON', 'SIGNAL', 'BLOCK'];

  // Context for the Z text inside the card: same state as the hovered symbol (default: the
  // Medication ward); the hovered identifier itself (subject) does not carry over.
  const cardCtx = $derived<ExplainerContext>({
    givenSets: [...CARD_GIVEN, ...(ctx?.givenSets ?? [])],
    stateName: ctx?.stateName || (ctx?.stateVars ? 'State' : 'Ward'),
    stateVars: ctx?.stateName || ctx?.stateVars ? ctx.stateVars : ['patients', 'allergic', 'prescribed'],
  });

  const hasMore = $derived(!!(ex.example || ex.exampleSchema || ex.diagram || ex.notes?.length));
  const word = $derived(/^[a-z]+$/.test(ex.symbol));
  /** x′ x? x!: the variable in plain text, the decoration in its colour. */
  const deco = $derived(/^x[′?!]$/.test(ex.symbol));
  /** The period of ∀ x ∈ S . P: shown in context, since a lone '.' is hard to see. */
  const period = $derived(ex.symbol === '.');
  const wide = $derived(ex.symbol.length > 2 && !word);
</script>

<div class="card" class:pinned>
  <header>
    {#if deco}
      <span class="glyph deco" aria-hidden="true"><span class="v">x</span><span class="z-decoration">{ex.symbol.slice(1)}</span></span>
    {:else if period}
      <span class="glyph period" aria-hidden="true"><span>x <span class="faint">∈</span> S<b class="z-logic">.</b>P</span></span>
    {:else if ex.symbol}
      <span class="glyph z-{ex.category ?? 'logic'}" class:word class:wide aria-hidden="true">{ex.symbol}</span>
    {:else}
      <span class="glyph schema-glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="24" height="24"
          ><path d="M4 4.5 H7 M17 4.5 H20 M4 4.5 V19.5 H20 M4 12 H20" /><path class="nm" d="M9 4.5 H15" /></svg
        >
      </span>
    {/if}
    <div class="titles">
      <h2 id={titleId}>{ex.title}</h2>
      {#if pinned && ex.ascii?.length}
        <span class="ascii">type {#each ex.ascii as a, i}{#if i}<span class="or">or</span>{/if}<kbd>{a}</kbd>{/each}</span>
      {/if}
    </div>
    {#if pinned}
      <div class="actions">
        {#if canBack}
          <button type="button" class="icon" aria-label="Back" title="Back" onclick={() => onback?.()}><ArrowLeft size={16} /></button>
        {/if}
        <button type="button" class="icon" aria-label="Close" title="Close (Esc)" onclick={() => onclose?.()}><X size={16} /></button>
      </div>
    {/if}
  </header>

  <p class="short"><RichText text={ex.short} ctx={cardCtx} /></p>

  {#if ex.definitionSchema || ex.definition}
    <section>
      <h3>Definition</h3>
      <div class="zpanel">
        {#if ex.definitionSchema}<MiniSchema schema={ex.definitionSchema} ctx={cardCtx} />{/if}
        {#if ex.definition}<ZText text={ex.definition} ctx={cardCtx} nested block class="zdef" />{/if}
      </div>
    </section>
  {/if}

  {#if pinned}
    {#if ex.example || ex.exampleSchema}
      <section>
        <h3>Example</h3>
        <div class="zpanel example">
          {#if ex.exampleSchema}<MiniSchema schema={ex.exampleSchema} ctx={cardCtx} />{/if}
          {#if ex.example}<ZText text={ex.example} ctx={cardCtx} nested block class="zdef" />{/if}
        </div>
      </section>
    {/if}
    {#if ex.diagram}
      <section class="diagram">
        <ArrowDiagram spec={ex.diagram} ctx={cardCtx} />
      </section>
    {/if}
    {#if ex.notes?.length}
      <ul class="notes">
        {#each ex.notes as note}<li><RichText text={note} ctx={cardCtx} /></li>{/each}
      </ul>
    {/if}
  {:else if hasMore}
    <p class="hint">Click for {ex.diagram ? 'picture' : 'example'} &amp; more</p>
  {/if}
</div>

<style>
  .card {
    background: var(--bg);
    color: var(--ui-fg-strong);
    border: 1px solid var(--ui-border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    padding: 12px 14px 12px;
    font-family: var(--font-ui);
    font-size: 14px;
    line-height: 1.45;
    width: max-content;
    max-width: min(380px, calc(100vw - 16px));
    max-height: var(--explainer-max-h, 80vh);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .card.pinned {
    width: min(380px, calc(100vw - 16px));
    padding-bottom: 14px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .glyph {
    flex: none;
    min-width: 36px;
    height: 36px;
    padding: 0 4px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: var(--bg-subtle);
    font-family: var(--font-z-symbols);
    font-size: 24px;
    line-height: 1;
  }
  .glyph.word {
    font-family: var(--font-z);
    font-size: 18px;
  }
  .glyph.wide {
    font-family: var(--font-z);
    font-size: 17px;
    white-space: pre;
  }
  .glyph.deco {
    font-family: var(--font-z);
    font-size: 22px;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .glyph.deco .v {
    padding-right: 1px;
  }
  .glyph.period {
    font-family: var(--font-z);
    font-size: 16px;
    padding: 0 9px;
    white-space: pre;
  }
  .glyph.period .faint {
    color: var(--fg-faint);
  }
  .glyph.period b {
    font-size: 24px;
    line-height: 1;
    font-weight: 700;
    margin: 0 3px;
  }
  .schema-glyph svg path {
    fill: none;
    stroke: var(--z-schema);
    stroke-width: 1.6;
    stroke-linecap: round;
  }
  .schema-glyph svg path.nm {
    stroke: var(--fg-faint);
    stroke-width: 2.2;
  }
  .titles {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
    line-height: 1.25;
  }
  .ascii {
    font-size: 11.5px;
    color: var(--fg-faint);
    margin-top: 2px;
  }
  .ascii .or {
    margin: 0 4px;
  }
  kbd {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    color: var(--fg-muted);
    background: var(--bg-subtle);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 4px;
  }
  .actions {
    display: flex;
    gap: 2px;
    align-self: flex-start;
    margin: -4px -6px 0 0;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-muted);
    cursor: pointer;
  }
  .icon:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }

  .short {
    margin: 8px 0 0;
  }
  section {
    margin-top: 10px;
  }
  h3 {
    margin: 0 0 4px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-faint);
  }
  .zpanel {
    background: var(--bg-subtle);
    border-radius: 8px;
    padding: 7px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-x: auto;
  }
  .zpanel.example {
    background: transparent;
    border: 1px solid var(--border);
  }
  .zpanel :global(.zdef) {
    font-size: 15px;
    line-height: 1.55;
  }
  .diagram {
    margin-top: 12px;
  }
  .notes {
    margin: 10px 0 0;
    padding: 0 0 0 16px;
    color: var(--fg-muted);
    font-size: 13px;
  }
  .notes li + li {
    margin-top: 3px;
  }
  .notes li::marker {
    color: var(--fg-faint);
  }
  .hint {
    margin: 8px 0 0;
    font-size: 11.5px;
    color: var(--fg-faint);
  }
</style>
