<script lang="ts">
  // Editable example values of one given set, as a Z set display:
  //   PATIENT = {Ana, Ben, Chen, …}
  // Commas separate values (so "Dana Smith" is one value); braces typed inside are
  // dropped. A … (or ...) anywhere marks the set as infinite in principle; it is shown
  // at the end (examples still use the listed values).
  // Layout: an invisible copy of the text with the closing brace lies under the textarea.
  // It sizes the field and wraps like the textarea, so the brace follows the last value.
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

  const show = (vals: string[], inf: boolean) => [...vals, ...(inf ? ['…'] : [])].join(', ');
  const unique = (v: string, i: number, all: string[]) => all.indexOf(v) === i;

  // show the current values unless the user is typing
  $effect(() => {
    if (!focused) text = show(values, infinite);
  });

  function parse(t: string): { vals: string[]; inf: boolean } {
    const norm = t.replace(/\.\.\./g, '…');
    const inf = norm.includes('…');
    const vals = norm
      .replace(/[{}…]/g, '')
      .split(',')
      .map((v) => v.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .filter(unique);
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
    ><span class="brace z-set">{'{'}</span><span class="field"
      ><span class="mirror" aria-hidden="true">{text + '\u200b'}<span class="brace z-set">{'}'}</span></span
      ><textarea
      rows="1"
      spellcheck="false"
      autocomplete="off"
      aria-label={`Example values of ${name}, separated by commas; add … if there are infinitely many`}
      bind:value={text}
      onfocus={() => (focused = true)}
      onblur={() => {
        focused = false;
        commit();
        const { vals, inf } = parse(text);
        text = show(vals, inf);
      }}
      oninput={() => {
        if (text.includes('...')) text = text.replace(/\.\.\./g, '…');
        commit();
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.currentTarget as HTMLTextAreaElement).blur();
        }
      }}
    ></textarea></span
    ></span
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
    font-size: calc(1.05rem * var(--z-scale, 1));
    line-height: 1.75;
  }
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
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
  .field {
    position: relative;
    flex: 0 1 auto;
    min-width: 4ch;
  }
  /* mirror and textarea: same box, same wrapping */
  .mirror,
  textarea {
    box-sizing: border-box;
    padding: 0 1px;
    border: none;
    border-bottom: 1px dashed transparent;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
  }
  .mirror {
    display: block;
    position: relative;
    z-index: 1;
    color: transparent;
    pointer-events: none;
    user-select: none;
  }
  textarea {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    font: inherit;
    line-height: inherit;
    color: var(--fg);
    background: transparent;
    margin: 0;
    resize: none;
    overflow: hidden;
    transition:
      border-color 0.15s,
      background 0.15s;
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
