<!-- Desktop/tablet topic picker: bubbles on an ellipse (see ring.ts). -->
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
</script>

<div class="ring" role="listbox" aria-label="Topics" aria-orientation="horizontal">
  {#each items as topic, i (topic.id)}
    {@const p = layout.points[i]}
    <div class="slot" style:left="{p.x}px" style:top="{p.y}px" role="option" aria-selected={selected === topic.id}>
      <Bubble
        {topic}
        size={layout.size}
        index={i}
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
