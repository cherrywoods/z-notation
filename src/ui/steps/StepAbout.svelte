<!--
  Step: the system card (first step). The system's icon, its name and a short
  paragraph of context. The own topic gets an editable description instead.
  Contract: props { spec }; one <TutorialColumns> with only `main`.
-->
<script lang="ts">
  import type { SpecDoc } from '../../lib/spec/model';
  import { store } from '../../lib/spec/store.svelte';
  import { CUSTOM_ID, cardOf, iconOf, topicName } from '../../lib/spec/topics';
  import { iconFor } from '../start/icons';
  import TutorialColumns from '../shell/TutorialColumns.svelte';

  let { spec }: { spec: SpecDoc } = $props();
  // edits go to the store's state (not through the prop)
  const doc = $derived(store.current ?? spec);

  const custom = $derived(doc.topicId === CUSTOM_ID);
  const name = $derived(topicName(doc.topicId) ?? doc.title);
  const card = $derived(cardOf(doc.topicId));
  const Icon = $derived(iconFor(iconOf(doc.topicId)));
</script>

<TutorialColumns>
  {#snippet main()}
    <article class="card">
      <div class="icon" aria-hidden="true"><Icon size={26} strokeWidth={1.6} /></div>
      <h1>{name}</h1>
      {#if custom}
        <div class="desc">
          <textarea
            rows="4"
            spellcheck="true"
            aria-label="Description of your system"
            bind:value={doc.description}
          ></textarea>
          {#if !doc.description?.trim()}
            <p class="prompt" aria-hidden="true">
              <svg viewBox="0 0 16 16"><path d="M2.5 13.5h3l7.4-7.4a1.4 1.4 0 0 0 0-2l-1-1a1.4 1.4 0 0 0-2 0L2.5 10.5v3Z" /></svg>
              <span>Describe your system in a few sentences.</span>
            </p>
          {/if}
        </div>
      {:else if card.length}
        <ul class="text">
          {#each card as item, i (i)}<li>{item}</li>{/each}
        </ul>
      {/if}
    </article>
  {/snippet}
</TutorialColumns>

<style>
  /* raised, like the tool bar on the left of the other steps */
  .card {
    max-width: 620px;
    margin: clamp(8px, 6vh, 56px) auto 0;
    padding: clamp(22px, 4vw, 36px) clamp(20px, 4vw, 40px) clamp(24px, 4vw, 38px);
    background: var(--bg);
    border: 1.5px solid var(--edge-raised);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-raised);
    min-width: 0;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    border: 1px solid var(--ui-border);
    color: var(--ui-fg);
  }
  h1 {
    margin: 16px 0 10px;
    font-family: var(--font-z);
    font-weight: 400;
    font-size: clamp(1.6rem, 3vw, 2rem);
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .text {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 10px;
    font-size: 1.1rem;
    line-height: 1.55;
    color: var(--fg);
    overflow-wrap: anywhere;
  }
  /* quiet bullets */
  .text li {
    position: relative;
    padding-left: 22px;
  }
  .text li::before {
    content: '';
    position: absolute;
    left: 4px;
    top: 0.68em;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ui-fg-faint);
  }

  /* own topic: an editable description with the usual stylus prompt */
  .desc {
    position: relative;
    display: grid;
  }
  textarea {
    grid-area: 1 / 1;
    width: 100%;
    min-height: calc(1.6em * 4 + 12px);
    padding: 6px 8px;
    margin: 0 -8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: 1.1rem;
    line-height: 1.6;
    resize: none;
    field-sizing: content;
    transition: background 0.15s;
  }
  textarea:hover {
    background: var(--bg-subtle);
  }
  textarea:focus {
    outline: none;
    background: var(--bg-subtle);
  }
  .prompt {
    grid-area: 1 / 1;
    align-self: start;
    display: flex;
    gap: 10px;
    margin: 0;
    padding: 9px 0 0;
    color: var(--ui-fg);
    font-size: 0.95rem;
    line-height: 1.45;
    pointer-events: none;
    transition: opacity 0.15s;
  }
  .desc:focus-within .prompt {
    opacity: 0.55;
  }
  .prompt svg {
    flex: none;
    width: 15px;
    height: 15px;
    margin-top: 3px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
  }
</style>
