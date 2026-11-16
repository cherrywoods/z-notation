<script lang="ts">
  // Editable example values of one given set, as a Z set display:
  //   PATIENT = {Ana, Ben, Chen, …}
  // Commas or spaces separate values; a trailing … (or ...) marks the set as infinite
  // in principle (examples still use the listed values).
  import { explain } from '../explain/explain.svelte';

  interface Props {
    name: string;
    values: string[];
    infinite: boolean;
    onchange: (values: string[], infinite: boolean) => void;
  }
  let { name, values, infinite, onchange }: Props = $props();

  let text = $state('');
  let focused = $state(false);
  let area = $state<HTMLTextAreaElement>();

  // grow with the text (values wrap instead of being cut off)
  $effect(() => {
    void text;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  });

  const show = (vals: string[], inf: boolean) => [...vals, ...(inf ? ['…'] : [])].join(', ');

  // show the current values unless the user is typing
  $effect(() => {
    if (!focused) text = show(values, infinite);
  });

  function parse(t: string): { vals: string[]; inf: boolean } {
    const norm = t.replace(/\.\.\./g, '…');
    const inf = /…\s*$/.test(norm);
    const vals = norm
      .replace(/…/g, ' ')
      .split(/[,\s]+/)
      .map((v) => v.trim())
      .filter((v) => v && v !== '…')
      .filter((v, i, all) => all.indexOf(v) === i);
    return { vals, inf };
  }

  function commit() {
    const { vals, inf } = parse(text);
    if (vals.join('\u0000') !== values.join('\u0000') || inf !== infinite) onchange(vals, inf);
  }

  function hover(e: MouseEvent, id: string) {
    explain.show({ id, anchor: (e.currentTarget as HTMLElement).getBoundingClientRect(), ctx: { subject: name } });
  }
</script>

<div class="pool">
  <span class="name z-given" data-explain="given" role="note" onmouseenter={(e) => hover(e, 'given')} onmouseleave={() => explain.hide()}
    >{name}</span
  >
  <span class="eq">=</span>
  <span class="set z-text"
    ><span class="brace z-set">{'{'}</span><textarea
      rows="1"
      spellcheck="false"
      autocomplete="off"
      aria-label={`Example values of ${name}; end with … if there are infinitely many`}
      bind:value={text}
      bind:this={area}
      onfocus={() => (focused = true)}
      onblur={() => {
        focused = false;
        commit();
        const { vals, inf } = parse(text);
        text = show(vals, inf);
      }}
      oninput={() => {
        if (text.endsWith('...')) text = text.slice(0, -3) + '…';
        commit();
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.currentTarget as HTMLTextAreaElement).blur();
        }
      }}
    ></textarea><span class="brace z-set">{'}'}</span></span
  >
</div>

<style>
  /* the parent lays rows out in a grid: name | = | {values} */
  .pool {
    display: contents;
  }
  .name,
  .eq,
  .set {
    font-family: var(--font-z);
    font-size: 1.05rem;
    line-height: 1.75;
  }
  .eq,
  .set {
    color: var(--fg);
  }
  .set {
    display: flex;
    align-items: flex-start;
    min-width: 0;
  }
  textarea {
    font: inherit;
    line-height: inherit;
    color: var(--fg);
    border: none;
    border-bottom: 1px dashed transparent;
    background: transparent;
    padding: 0 1px;
    margin: 0;
    min-width: 4ch;
    width: 100%;
    resize: none;
    overflow: hidden;
    display: block;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  /* hug the values so the closing brace follows them (where supported) */
  @supports (field-sizing: content) {
    textarea {
      field-sizing: content;
      width: auto;
      max-width: 100%;
    }
  }
  textarea:hover {
    border-bottom-color: var(--ui-fg-faint);
  }
  textarea:focus {
    outline: none;
    border-bottom: 1px solid var(--focus);
    background: var(--bg);
  }
</style>
