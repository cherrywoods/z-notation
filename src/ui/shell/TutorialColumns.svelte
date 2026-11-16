<!--
  Body layout of a tutorial step. Step views render exactly one of these:

    <TutorialColumns>
      {#snippet main()} …editor area… {/snippet}
      {#snippet side()} …Example / Inference panels… {/snippet}
    </TutorialColumns>

  ≥ 900px: two columns (main ≈ 1.35fr | side ≈ 1fr). Narrower: stacked, side below main.
  Without `side`, main spans the full width (e.g. the Spec step).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    main: Snippet;
    side?: Snippet;
  }
  let { main, side }: Props = $props();
</script>

<div class="cols" class:single={!side}>
  <section class="main">{@render main()}</section>
  {#if side}
    <aside class="side">{@render side()}</aside>
  {/if}
</div>

<style>
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: clamp(20px, 3vw, 40px);
    width: 100%;
    max-width: 1560px;
    margin: 0 auto;
    padding: clamp(16px, 3vw, 32px) var(--gutter);
    /* room for the fixed arrow buttons */
    padding-bottom: 112px;
  }
  .main,
  .side {
    min-width: 0;
  }
  @media (min-width: 900px) {
    .cols:not(.single) {
      grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
      align-items: start;
    }
  }
  .single {
    max-width: 1100px;
  }
  @media print {
    .cols {
      padding: 0;
    }
  }
</style>
