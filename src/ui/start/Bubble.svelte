<!--
  One topic bubble: white circle, thin border, icon + short label.
  `grow`: grows on hover (ring). The own-topic bubble (`custom`) turns its label into a
  text input while `editing`.
-->
<script lang="ts">
  import type { TopicInfo } from '../../lib/spec/topics';
  import { iconFor } from './icons';

  interface Props {
    topic: TopicInfo;
    size: number;
    selected?: boolean;
    dim?: boolean;
    grow?: boolean;
    custom?: boolean;
    editing?: boolean;
    text?: string;
    /** Stagger index for the entrance animation (-1: none). */
    index?: number;
    /** Carousel clones: hidden from assistive tech and the tab order (still clickable). */
    clone?: boolean;
    onclick?: () => void;
    onhover?: (hovered: boolean) => void;
    onsubmit?: () => void;
    onblur?: () => void;
    oninput?: (text: string) => void;
  }
  let {
    topic,
    size,
    selected = false,
    dim = false,
    grow = false,
    custom = false,
    editing = false,
    text = '',
    index = -1,
    clone = false,
    onclick,
    onhover,
    onsubmit,
    onblur,
    oninput,
  }: Props = $props();

  const Icon = $derived(iconFor(topic.icon));
  const label = $derived(custom && text.trim() ? text.trim() : topic.short);
  const iconSize = $derived(Math.round(Math.max(22, Math.min(40, size * 0.24))));

  function focusOnMount(el: HTMLInputElement) {
    el.focus({ preventScroll: true });
    el.select();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onsubmit?.();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      (e.currentTarget as HTMLInputElement).blur();
    }
  }
</script>

<div
  class="bubble"
  class:grow
  class:selected={selected || editing}
  class:dim
  class:custom
  class:intro={index >= 0}
  style:--d="{size}px"
  style:--i={index}
  data-topic={topic.id}
  role="presentation"
  aria-hidden={clone ? 'true' : undefined}
  onpointerenter={(e) => e.pointerType !== 'touch' && onhover?.(true)}
  onpointerleave={(e) => e.pointerType !== 'touch' && onhover?.(false)}
>
  {#if editing}
    <div class="face">
      <Icon size={iconSize} strokeWidth={1.6} />
      <input
        type="text"
        value={text}
        placeholder="your topic"
        maxlength="40"
        spellcheck="false"
        autocomplete="off"
        enterkeyhint="go"
        aria-label="Your own topic"
        oninput={(e) => oninput?.(e.currentTarget.value)}
        {onkeydown}
        {onblur}
        {@attach focusOnMount}
      />
    </div>
  {:else}
    <button
      type="button"
      class="face"
      aria-pressed={selected}
      tabindex={clone ? -1 : undefined}
      aria-label={custom ? `Own topic${text.trim() ? `: ${text.trim()}` : ''}` : topic.title}
      onclick={() => onclick?.()}
    >
      <Icon size={iconSize} strokeWidth={1.6} />
      <span class="label">{label}</span>
    </button>
  {/if}
</div>

<style>
  .bubble {
    --s: 1;
    width: var(--d);
    height: var(--d);
    border-radius: 50%;
    transform: scale(var(--s));
    transition:
      transform 0.5s var(--ease-spring),
      opacity 0.3s var(--ease-out);
    -webkit-tap-highlight-color: transparent;
  }
  .intro {
    animation: pop 0.6s var(--ease-spring) backwards;
    animation-delay: calc(var(--i) * 45ms + 80ms);
  }
  @keyframes pop {
    from {
      opacity: 0;
      scale: 0.7;
    }
  }

  .face {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: calc(var(--d) * 0.055);
    padding: 0 calc(var(--d) * 0.1);
    background: var(--bg);
    color: var(--ui-fg);
    border: 1px solid var(--ui-border);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    font: inherit;
    transition:
      border-color 0.2s,
      box-shadow 0.3s var(--ease-out);
  }
  .custom .face {
    border-style: dashed;
    border-color: var(--ui-fg-faint);
  }
  /* names of up to ~26 characters: two balanced, centred lines */
  .label {
    font-size: clamp(12.5px, calc(var(--d) * 0.1), 16.5px);
    line-height: 1.25;
    /* keeps descenders (g, p) clear of the clamp's overflow clipping */
    padding-bottom: 0.15em;
    font-weight: 500;
    text-align: center;
    text-wrap: balance;
    max-width: 100%;
    overflow: hidden;
    overflow-wrap: break-word;
    hyphens: auto;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
  }
  input {
    width: 100%;
    min-width: 0;
    border: none;
    border-bottom: 1px solid var(--ui-fg-faint);
    border-radius: 0;
    background: transparent;
    padding: 2px 0;
    font: inherit;
    font-size: clamp(13px, calc(var(--d) * 0.1), 16px);
    font-weight: 500;
    text-align: center;
    color: var(--fg);
    outline: none;
  }
  input::placeholder {
    color: var(--ui-fg);
    font-weight: 400;
  }
  input:focus {
    border-bottom-color: var(--fg);
  }

  /* states */
  .dim {
    opacity: 0.45;
  }
  .grow.selected {
    --s: 1.14;
  }
  .selected .face {
    color: var(--fg);
    border: 1px solid var(--fg);
    box-shadow:
      0 0 0 1.5px var(--fg),
      var(--shadow-md);
  }
  @media (hover: hover) {
    .grow:hover {
      --s: 1.18;
      opacity: 1;
    }
    .grow.selected:hover {
      --s: 1.2;
    }
    .bubble:hover .face {
      color: var(--fg);
      border-color: var(--fg);
      box-shadow: var(--shadow-md);
    }
    .bubble.selected:hover .face {
      border-color: var(--fg);
      box-shadow:
        0 0 0 1.5px var(--fg),
        var(--shadow-lg);
    }
  }
  .face:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 4px;
  }
</style>
