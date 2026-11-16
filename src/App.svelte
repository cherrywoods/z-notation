<!-- Routing: start page (+ presentation overlay) or the tutorial of a topic. -->
<script lang="ts">
  import { fade } from 'svelte/transition';
  import { router } from './lib/router.svelte';
  import { store } from './lib/spec/store.svelte';
  import { hasTopic } from './lib/spec/topics';
  import StartPage from './ui/start/StartPage.svelte';
  import PresentMode from './ui/present/PresentMode.svelte';
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
</script>

{#if route.name === 'tutorial'}
  {#if store.current && store.current.topicId === route.topicId}
    {#key route.topicId}
      <div in:fade|global={{ duration: 260 }}>
        <TutorialShell topicId={route.topicId} step={route.step} />
      </div>
    {/key}
  {/if}
{:else}
  <StartPage inert={route.name === 'present'} />
  {#if route.name === 'present'}
    <PresentMode />
  {/if}
{/if}

<ExplainerLayer />
