<script lang="ts">
  // Read-only Z schema box (same geometry as the editable SchemaBox), for the
  // specification view and the printout. Lines with errors get the wavy underline;
  // an unusable name and an empty schema are marked quietly.
  import ZText from '../z/ZText.svelte';
  import { schemaFrame } from '../explain/frame';
  import type { ExplainerContext } from '../../lib/content/explainers';

  interface Props {
    name: string;
    decls: string;
    preds: string;
    givenSets?: string[];
    ctx?: ExplainerContext;
    /** Why the name is not usable (shown as a tooltip on the marked name). */
    nameError?: string | null;
    /** Nothing (or too little) written yet. */
    incomplete?: boolean;
    /** 0-based line numbers with errors, per part. */
    declErrors?: ReadonlySet<number>;
    predErrors?: ReadonlySet<number>;
  }
  let { name, decls, preds, givenSets, ctx, nameError = null, incomplete = false, declErrors, predErrors }: Props =
    $props();

  const frame = schemaFrame(() => ctx);
  const shownName = $derived(name.trim() || 'unnamed');
</script>

{#snippet part(text: string, errors: ReadonlySet<number> | undefined)}
  {#if errors?.size}
    {#each text.split('\n') as line, i (i)}
      <ZText text={line || ' '} {givenSets} {ctx} block class={errors.has(i) ? 'err-line' : ''} />
    {/each}
  {:else}
    <ZText text={text} {givenSets} {ctx} block />
  {/if}
{/snippet}

<div class="schema">
  <span class="strip left" data-explain="schema" aria-hidden="true" {@attach frame}></span>
  <span class="strip bottom" data-explain="schema" aria-hidden="true" {@attach frame}></span>
  <div class="top">
    <span class="rule lead" data-explain="schema" aria-hidden="true" {@attach frame}></span>
    <span class="name" class:invalid={!!nameError} title={nameError ?? name}>{shownName}</span>
    {#if incomplete}<span class="note">incomplete</span>{/if}
    <span class="rule fill" data-explain="schema" aria-hidden="true" {@attach frame}></span>
  </div>
  <div class="part">{@render part(decls, declErrors)}</div>
  {#if preds.trim()}
    <div class="divider" data-explain="schema" aria-hidden="true" {@attach frame}></div>
    <div class="part">{@render part(preds, predErrors)}</div>
  {/if}
</div>

<style>
  .schema {
    --rule: 1.5px solid var(--fg);
    position: relative;
    margin-top: 1em;
    padding: 0.95em 0 0.55em 14px;
    border-left: var(--rule);
    border-bottom: var(--rule);
    break-inside: avoid;
    font-size: calc(1.1rem * var(--z-scale, 1));
    min-width: 0;
  }
  .top {
    position: absolute;
    top: -0.9em;
    left: -1.5px;
    right: 0;
    height: 1.8em;
    display: flex;
    align-items: center;
  }
  .rule {
    border-top: var(--rule);
    height: 0;
    position: relative;
  }
  /* thin invisible hover strips on the rules (the 'schema' explainer) */
  .rule::after,
  .divider::after {
    content: '';
    position: absolute;
    inset: -6px 0 -5px;
  }
  .strip {
    position: absolute;
    z-index: 1;
  }
  .strip.left {
    left: -7px;
    width: 12px;
    top: 0;
    bottom: -2px;
  }
  .strip.bottom {
    left: -7px;
    right: 0;
    bottom: -7px;
    height: 12px;
  }
  .lead {
    width: 14px;
    flex: none;
  }
  .fill {
    flex: 1;
    min-width: 16px;
  }
  .name {
    font-family: var(--font-z);
    font-style: normal;
    padding: 0 6px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name.invalid {
    text-decoration: underline wavy var(--error);
    text-decoration-skip-ink: none;
    text-underline-offset: 4px;
  }
  .note {
    flex: none;
    padding: 0 6px 0 0;
    font-family: var(--font-ui);
    font-size: 0.75rem;
    color: var(--ui-fg);
  }
  .part {
    padding: 0 4px;
    min-width: 0;
  }
  .part :global(.z-text) {
    font-size: calc(1.1rem * var(--z-scale, 1));
  }
  .part :global(.err-line) {
    text-decoration: underline wavy var(--error);
    text-decoration-skip-ink: none;
    text-underline-offset: 4px;
  }
  .divider {
    position: relative;
    margin: 0.3em 0 0.35em -14px;
    width: min(45%, 300px);
    border-top: var(--rule);
  }
</style>
