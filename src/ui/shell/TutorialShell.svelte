<!--
  Tutorial shell: thin header (home · title · step row · reset), the current step view
  (direction-aware slide/fade), big back/next arrows, Alt+←/→.
  Expects store.current to be the spec of `topicId` (App.svelte opens it).
-->
<script lang="ts">
  import { router, stepHref } from '../../lib/router.svelte';
  import { store } from '../../lib/spec/store.svelte';
  import { topicName } from '../../lib/spec/topics';
  import { stepsOf } from './steps';
  import StepRow from './StepRow.svelte';
  import ResetControl from './ResetControl.svelte';
  import ArrowButton from './ArrowButton.svelte';
  import StepAbout from '../steps/StepAbout.svelte';
  import StepTypes from '../steps/StepTypes.svelte';
  import StepState from '../steps/StepState.svelte';
  import StepOperation from '../steps/StepOperation.svelte';
  import StepInit from '../steps/StepInit.svelte';
  import StepSpec from '../steps/StepSpec.svelte';

  interface Props {
    topicId: string;
    step: string;
  }
  let { topicId, step }: Props = $props();

  const spec = $derived(store.current!);
  /** Same name as on the start page bubble (own topic: the student's title). */
  const name = $derived(topicName(topicId) ?? spec.title);
  const steps = $derived(stepsOf(spec));
  const index = $derived(steps.findIndex((s) => s.id === step));
  const prev = $derived(index > 0 ? steps[index - 1] : undefined);
  const next = $derived(index >= 0 && index < steps.length - 1 ? steps[index + 1] : undefined);

  // unknown step (bad URL, or the operation/Init was just removed): go to the step before
  let lastIndex = 0;
  $effect(() => {
    if (index >= 0) {
      lastIndex = index;
      return;
    }
    const fallback = steps[Math.min(Math.max(lastIndex - 1, 0), steps.length - 1)];
    router.replace(stepHref(topicId, fallback.id));
  });

  // direction of the step change (for the transition); plain variables, read by the
  // transition functions when the {#key} block swaps
  let shownIndex = -1;
  let dir = 1;
  const viewKey = $derived.by(() => {
    if (index >= 0) {
      dir = shownIndex < 0 || index >= shownIndex ? 1 : -1;
      shownIndex = index;
    }
    return step;
  });

  function stepIn(_node: Element) {
    const d = dir;
    return {
      duration: 340,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
      css: (t: number, u: number) => `opacity: ${t}; transform: translateX(${u * d * 32}px)`,
    };
  }
  function stepOut(_node: Element) {
    const d = dir;
    return {
      duration: 180,
      css: (t: number, u: number) => `opacity: ${t}; transform: translateX(${-u * d * 24}px)`,
    };
  }

  $effect(() => {
    void step;
    window.scrollTo({ top: 0 });
  });

  $effect(() => {
    document.title = `${name} · Z`;
    return () => {
      document.title = 'Z Specification Language';
    };
  });

  function add(what: 'operation' | 'init') {
    if (what === 'init') {
      store.addInit();
      router.go(stepHref(topicId, 'init'));
    } else {
      router.go(stepHref(topicId, store.addOperation().id));
    }
  }

  function goNext() {
    if (next) router.go(stepHref(topicId, next.id));
  }
  function goBack() {
    router.go(prev ? stepHref(topicId, prev.id) : '#/');
  }

  function onkeydown(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'ArrowRight' && next) {
      e.preventDefault();
      goNext();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goBack();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="shell">
  <header>
    <div class="left">
      <a class="home" href="#/" title="All topics" aria-label="All topics">Z</a>
      <span class="title" title={spec.title}>{name}</span>
    </div>
    <StepRow {topicId} {steps} current={step} canAddInit={!spec.init} onadd={add} />
    <div class="right">
      <ResetControl onreset={() => store.resetTopic()} />
    </div>
  </header>

  <main class="stage">
    {#key viewKey}
      <div class="view" in:stepIn out:stepOut>
        {#if step === 'about'}
          <StepAbout {spec} />
        {:else if step === 'types'}
          <StepTypes {spec} />
        {:else if step === 'state'}
          <StepState {spec} />
        {:else if step === 'spec'}
          <StepSpec {spec} />
        {:else if step === 'init'}
          {#if spec.init}<StepInit {spec} />{/if}
        {:else if index >= 0}
          <StepOperation {spec} schemaId={step} />
        {/if}
      </div>
    {/key}
  </main>

  <!-- desktop: two floating corner buttons; phones: a white bar at the bottom -->
  <nav class="arrows" aria-label="Back and next">
    <ArrowButton
      dir="back"
      docked
      label={prev ? `Back: ${prev.label}` : 'All topics'}
      href={prev ? stepHref(topicId, prev.id) : '#/'}
    />
    <ArrowButton
      dir="next"
      docked
      label={next ? `Next: ${next.label}` : 'Next'}
      href={next ? stepHref(topicId, next.id) : undefined}
      visible={!!next}
    />
  </nav>
</div>

<style>
  .shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--header-h);
    padding: 0 max(12px, calc(var(--gutter) - 8px));
    padding-top: env(safe-area-inset-top);
    box-sizing: content-box;
    background: color-mix(in srgb, var(--ui-bg) 92%, transparent);
    backdrop-filter: saturate(1.4) blur(10px);
    -webkit-backdrop-filter: saturate(1.4) blur(10px);
    border-bottom: 1px solid var(--ui-border);
  }
  .left,
  .right {
    flex: 1 1 0;
    display: flex;
    align-items: center;
  }
  .left {
    gap: 10px;
    /* the title truncates first (and disappears when tiny); the home link always stays */
    min-width: 34px;
    container-type: inline-size;
  }
  @container (max-width: 170px) {
    .title {
      display: none;
    }
  }
  .right {
    justify-content: flex-end;
    /* the reset confirmation pushes the step row, never overlaps it */
    min-width: max-content;
  }
  header > :global(nav) {
    flex: 0 1 auto;
  }
  .home {
    flex: none;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    font-family: var(--font-ui);
    font-size: 1.15rem;
    font-weight: 500;
    line-height: 1;
    color: var(--ui-fg);
    text-decoration: none;
    transition:
      background-color 0.18s,
      transform 0.3s var(--ease-spring);
  }
  @media (hover: hover) {
    .home:hover {
      color: var(--ui-fg-strong);
      background: var(--ui-border);
      transform: scale(1.08);
    }
  }
  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.875rem;
    color: var(--ui-fg);
  }

  .stage {
    flex: 1;
    display: grid;
    /* the outgoing and incoming views overlap during the transition */
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  }
  .view {
    grid-area: 1 / 1;
    min-width: 0;
  }

  @media (max-width: 760px) {
    .title {
      display: none;
    }
    .left,
    .right {
      flex: none;
    }
    header > :global(nav) {
      flex: 1 1 auto;
    }
  }
  @media print {
    header {
      display: none;
    }
  }
  .arrows {
    display: contents;
  }
  @media (max-width: 640px) {
    .arrows {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 30;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px max(16px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom))
        max(16px, env(safe-area-inset-left));
      background: var(--bg);
      border-top: 1px solid var(--ui-border);
    }
  }
  @media print {
    .arrows {
      display: none;
    }
  }
</style>
