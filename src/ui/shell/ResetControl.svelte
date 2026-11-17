<!-- Reset the open topic, with an inline confirmation. -->
<script lang="ts">
  import { RotateCcw } from '@lucide/svelte';
  import InlineConfirm from './InlineConfirm.svelte';

  let { onreset }: { onreset: () => void } = $props();
</script>

<InlineConfirm label="Reset this topic" question="Start over?" action="Reset" onconfirm={onreset}>
  {#snippet icon()}<RotateCcw size={16} />{/snippet}
</InlineConfirm>
