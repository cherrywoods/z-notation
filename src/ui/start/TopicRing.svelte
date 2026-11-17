<!-- Desktop/tablet topic picker: bubbles on a circle (see ring.ts), a prompt in its centre. -->
<script lang="ts">
  import { CUSTOM_ID, type TopicInfo } from '../../lib/spec/topics';
  import type { RingLayout } from './ring';
  import Bubble from './Bubble.svelte';

  interface Props {
    items: TopicInfo[];
    layout: RingLayout;
    selected: string | null;
    customText: string;
    editing: boolean;
    /** Click on a bubble (StartPage decides: select, start, or edit the own topic). */
    onpick: (id: string) => void;
    oncustominput: (text: string) => void;
    oncustomsubmit: () => void;
    oncustomblur: () => void;
  }
  let { items, layout, selected, customText, editing, onpick, oncustominput, oncustomsubmit, oncustomblur }: Props =
    $props();

  let hovered = $state<string | null>(null);
  /** Roving tab stop: the selected bubble (or the first one). Arrow keys move it. */
  const tabStop = $derived(selected ?? items[0]?.id);
</script>

<p class="pick" style:left="{layout.cx}px" style:top="{layout.cy}px">
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5h3l7.4-7.4a1.4 1.4 0 0 0 0-2l-1-1a1.4 1.4 0 0 0-2 0L2.5 10.5v3Z" /></svg>
  Pick a system
</p>

<div class="ring" role="listbox" aria-label="Topics" aria-orientation="horizontal">
  {#each items as topic, i (topic.id)}
    {@const p = layout.points[i]}
    <div class="slot" style:left="{p.x}px" style:top="{p.y}px" role="option" aria-selected={selected === topic.id}>
      <Bubble
        {topic}
        size={layout.size}
        index={i}
        tabindex={tabStop === topic.id ? 0 : -1}
        grow
        selected={selected === topic.id}
        dim={hovered !== null && hovered !== topic.id && selected !== topic.id}
        custom={topic.id === CUSTOM_ID}
        editing={topic.id === CUSTOM_ID && editing}
        text={topic.id === CUSTOM_ID ? customText : ''}
        onclick={() => onpick(topic.id)}
        onhover={(h) => (hovered = h ? topic.id : hovered === topic.id ? null : hovered)}
        oninput={oncustominput}
        onsubmit={oncustomsubmit}
        onblur={oncustomblur}
      />
    </div>
  {/each}
</div>

<style>
  .pick {
    position: absolute;
    transform: translate(-50%, -50%);
    margin: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    white-space: nowrap;
    color: var(--ui-fg);
    font-size: 1.12rem;
    pointer-events: none;
  }
  .pick svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
  }
  .ring {
    position: absolute;
    inset: 0;
  }
  .slot {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 1;
  }
  .slot:hover,
  .slot:focus-within {
    z-index: 2;
  }
</style>
