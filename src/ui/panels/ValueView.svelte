<script lang="ts">
  // Renders an example value in Z set notation (as on the lecture slides). With `before`,
  // elements added since the before-state are highlighted and removed ones struck out.
  import ValueView from './ValueView.svelte';
  import { valueKey, type Value } from '../../lib/z/values';

  interface Props {
    value: Value;
    before?: Value;
  }
  let { value, before }: Props = $props();

  type Item = { v: Value; mark: '' | 'added' | 'removed'; inner?: Value };

  // For sets compared with a before-set: union in canonical order, with marks.
  // A pair whose image changed (x ↦ old, x ↦ new) shows as removed + added.
  const items = $derived.by((): Item[] | null => {
    if (value.k !== 'set') return null;
    if (!before || before.k !== 'set') return value.elems.map((v) => ({ v, mark: '' }));
    const now = new Set(value.elems.map(valueKey));
    const was = new Set(before.elems.map(valueKey));
    const out: Item[] = [];
    // keep the after order, slot removed elements in before-order positions
    const merged = [...before.elems.filter((v) => !now.has(valueKey(v))), ...value.elems];
    const order = new Map(merged.map((v, i) => [valueKey(v), i]));
    const all = [...new Map(merged.map((v) => [valueKey(v), v])).values()];
    all.sort((a, b) => {
      const ia = value.elems.findIndex((x) => valueKey(x) === valueKey(a));
      const ib = value.elems.findIndex((x) => valueKey(x) === valueKey(b));
      const ka = ia >= 0 ? ia : before.elems.findIndex((x) => valueKey(x) === valueKey(a)) - 0.5;
      const kb = ib >= 0 ? ib : before.elems.findIndex((x) => valueKey(x) === valueKey(b)) - 0.5;
      return ka - kb || (order.get(valueKey(a))! - order.get(valueKey(b))!);
    });
    for (const v of all) {
      const k = valueKey(v);
      out.push({ v, mark: now.has(k) && !was.has(k) ? 'added' : !now.has(k) ? 'removed' : '' });
    }
    return out;
  });
</script>

{#if value.k === 'atom'}<span class="atom">{value.name}</span>{:else if value.k === 'int'}<span class="num">{value.v}</span>{:else if value.k === 'tuple'}{#if value.elems.length === 2}<ValueView
      value={value.elems[0]}
    /><span class="maplet z-relation">{' ↦ '}</span><ValueView value={value.elems[1]} />{:else}({#each value.elems as e, i (i)}{#if i > 0}{', '}{/if}<ValueView value={e} />{/each}){/if}{:else if value.k === 'set' && items}{#if items.length === 0}<span
      class="z-set">∅</span
    >{:else}<span class="z-set">{'{'}</span>{#each items as it, i (valueKey(it.v))}{#if i > 0}<span class="comma">{', '}</span>{/if}<span
          class="el {it.mark}"><ValueView value={it.v} /></span
        >{/each}<span class="z-set">{'}'}</span>{/if}{:else}<span class="lazy">…</span>{/if}

<style>
  .el {
    white-space: nowrap; /* break only between elements, never inside 14.Feb */
    border-radius: 3px;
    transition: background 0.2s;
  }
  .el.added {
    background: var(--diff-added-bg);
    box-shadow: 0 0 0 2px var(--diff-added-bg);
  }
  .el.removed {
    background: var(--diff-removed-bg);
    box-shadow: 0 0 0 2px var(--diff-removed-bg);
    text-decoration: line-through;
    text-decoration-color: var(--diff-removed-fg);
    color: var(--diff-removed-fg);
  }
  .comma {
    white-space: normal; /* lines break after a comma */
  }
  .maplet {
    white-space: pre;
  }
</style>
