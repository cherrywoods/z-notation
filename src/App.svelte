<!--
  Routing: start page or the tutorial of a topic. Presenter mode (projector) adds the
  join footer to every page; #/present and the key P switch it on (P toggles).
-->
<script lang="ts">
  import { fade } from 'svelte/transition';
  import { router } from './lib/router.svelte';
  import { store } from './lib/spec/store.svelte';
  import { hasTopic } from './lib/spec/topics';
  import StartPage from './ui/start/StartPage.svelte';
  import PresentMode from './ui/present/PresentMode.svelte';
  import PresenterFooter from './ui/present/PresenterFooter.svelte';
  import { presenter } from './ui/present/presenter.svelte';
  import TutorialShell from './ui/shell/TutorialShell.svelte';
  import ExplainerLayer from './ui/explain/ExplainerLayer.svelte';

  const route = $derived(router.route);
  const topicId = $derived(route.name === 'tutorial' ? route.topicId : null);

  // open the topic of the URL (unknown topic → start page)
  $effect.pre(() => {
    if (topicId === null) return;
    if (!hasTopic(topicId)) router.replace('#/');
    else if (store.current?.topicId !== topicId) store.openTopic(topicId);
  });

  // #/present switches presenter mode on and shows the start page
  $effect.pre(() => {
    if (route.name !== 'present') return;
    presenter.set(true);
    router.replace('#/');
  });

  function typing(t: EventTarget | null) {
    const el = t as HTMLElement | null;
    return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'p' && e.key !== 'P') return;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    e.preventDefault();
    presenter.toggle();
  }
</script>

<svelte:window {onkeydown} />

{#if route.name === 'tutorial'}
  {#if store.current && store.current.topicId === route.topicId}
    {#key route.topicId}
      <div in:fade|global={{ duration: 260 }}>
        <TutorialShell topicId={route.topicId} step={route.step} />
      </div>
    {/key}
  {/if}
{:else}
  <StartPage inert={presenter.big} />
{/if}

{#if presenter.on}
  <PresenterFooter />
{/if}
{#if presenter.big}
  <PresentMode />
{/if}

<ExplainerLayer />

<style>
  /* presenter mode: Z text in schemas and panels 1.3× (components multiply by it) */
  :global(html.presenting) {
    --z-scale: 1.3;
  }
</style>
