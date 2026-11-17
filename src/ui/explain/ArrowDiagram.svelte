<script lang="ts">
  // Mini arrow diagram(s): a left set and a right set with arrows between elements.
  // Used for ↔ ⇸ → (how many arrows per element), dom/ran (highlighted subsets).
  import type { DiagramPanel, DiagramSpec, ExplainerContext } from '../../lib/content/explainers';
  import RichText from './RichText.svelte';

  let { spec, ctx }: { spec: DiagramSpec; ctx?: ExplainerContext } = $props();
  const uid = $props.id();

  // geometry (viewBox units ≈ px)
  const TOP = 30; // y of the first row
  const ROW = 22;
  const GAP = 58; // between the two sets (room for the arrows)
  const PAD = 18; // set outline around its widest label
  const KINDS = ['normal', 'added', 'removed', 'bad'] as const;

  /** Rough text width at 13px (to size the sets and to end arrows next to the labels). */
  const textW = (s: string) =>
    [...s].reduce(
      (w, c) =>
        w +
        (/[.ijlI]/.test(c) ? 3.3 : /[MW]/.test(c) ? 11 : /[mw]/.test(c) ? 9 : /[A-Z]/.test(c) ? 8 : /\d/.test(c) ? 6.5 : 6),
      0,
    );

  /** Column widths and centres of a panel. */
  function geom(p: DiagramPanel) {
    const lw = Math.max(36, ...p.left.map(textW)) + PAD;
    const rw = Math.max(36, ...p.right.map(textW)) + PAD;
    return { lw, rw, LX: lw / 2 + 1, RX: lw + GAP + rw / 2 + 1, W: lw + GAP + rw + 2 };
  }

  const rows = (p: DiagramPanel) => Math.max(p.left.length, p.right.length, 1);
  const height = (p: DiagramPanel) => TOP + (rows(p) - 1) * ROW + 16;
  /** Rows of the elements of `xs` in `all`, as contiguous runs [first, last]. */
  function runs(all: string[], xs: string[] | undefined): [number, number][] {
    const idx = (xs ?? [])
      .map((x) => all.indexOf(x))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    const out: [number, number][] = [];
    for (const i of idx) {
      const last = out[out.length - 1];
      if (last && last[1] === i - 1) last[1] = i;
      else out.push([i, i]);
    }
    return out;
  }
  const y = (i: number) => TOP + i * ROW;
  const isNumber = (s: string) => /^\d/.test(s);
</script>

<div class="diagram" class:two={spec.panels.length > 1}>
  {#each spec.panels as p, pi}
    {@const h = height(p)}
    {@const { lw, rw, LX, RX, W } = geom(p)}
    <figure>
      <svg viewBox="0 0 {W} {h}" width={W} height={h} role="img" aria-label={p.caption?.replaceAll('`', '') ?? 'arrow diagram'}>
        <defs>
          {#each KINDS as k}
            <marker id="{uid}-{pi}-{k}" class="head {k}" viewBox="0 0 8 8" refX="7.2" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0.5,0.8 L7.5,4 L0.5,7.2 Z" />
            </marker>
          {/each}
        </defs>

        <!-- sets -->
        {#if p.leftLabel}<text class="label" x={LX} y="11">{p.leftLabel}</text>{/if}
        {#if p.rightLabel}<text class="label" x={RX} y="11">{p.rightLabel}</text>{/if}
        <rect class="set" x={LX - lw / 2} y={TOP - 15} width={lw} height={(rows(p) - 1) * ROW + 26} rx="14" />
        <rect class="set" x={RX - rw / 2} y={TOP - 15} width={rw} height={(rows(p) - 1) * ROW + 26} rx="14" />

        <!-- highlighted subsets (dom / ran) -->
        {#each runs(p.left, p.highlightLeft) as [a, b]}
          <rect class="hl" x={LX - lw / 2 + 5} y={y(a) - 10} width={lw - 10} height={(b - a) * ROW + 20} rx="9" />
        {/each}
        {#each runs(p.right, p.highlightRight) as [a, b]}
          <rect class="hl" x={RX - rw / 2 + 5} y={y(a) - 10} width={rw - 10} height={(b - a) * ROW + 20} rx="9" />
        {/each}

        <!-- arrows -->
        {#each p.arrows as ar}
          {@const i = p.left.indexOf(ar.from)}
          {@const j = p.right.indexOf(ar.to)}
          {#if i >= 0 && j >= 0}
            {@const k = ar.kind ?? 'normal'}
            {@const x1 = LX + textW(ar.from) / 2 + 4}
            {@const x2 = RX - textW(ar.to) / 2 - 5}
            <line class="arrow {k}" x1={x1} y1={y(i)} x2={x2} y2={y(j)} marker-end="url(#{uid}-{pi}-{k})" />
            {#if k === 'removed'}
              {@const mx = (x1 + x2) / 2}
              {@const my = (y(i) + y(j)) / 2}
              <path class="strike" d="M{mx - 4},{my - 4} L{mx + 4},{my + 4} M{mx + 4},{my - 4} L{mx - 4},{my + 4}" />
            {/if}
          {/if}
        {/each}

        <!-- elements -->
        {#each p.left as name, i}
          <text class="el" class:number={isNumber(name)} class:bad={p.badLeft?.includes(name)} x={LX} y={y(i)}>{name}</text>
        {/each}
        {#each p.right as v, i}
          <text class="el" class:number={isNumber(v)} x={RX} y={y(i)}>{v}</text>
        {/each}
      </svg>
      {#if p.caption}
        <figcaption>
          {#if p.verdict === 'ok'}<span class="verdict ok" aria-label="allowed">✓</span>{/if}{#if p.verdict === 'bad'}<span class="verdict bad" aria-label="not allowed">✗</span>{/if}<RichText text={p.caption} {ctx} />
        </figcaption>
      {/if}
    </figure>
  {/each}
</div>

<style>
  .diagram {
    display: flex;
    justify-content: center;
    gap: 8px;
  }
  figure {
    margin: 0;
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .two figure {
    flex: 1 1 0;
  }
  svg {
    display: block;
    max-width: 100%;
    height: auto;
    overflow: visible;
  }
  .label {
    font-family: var(--font-z);
    font-style: normal;
    font-size: 11.5px;
    fill: var(--z-type);
    text-anchor: middle;
  }
  .set {
    fill: var(--bg-subtle);
    stroke: var(--border);
    stroke-width: 1;
  }
  .hl {
    fill: color-mix(in srgb, var(--z-relation) 12%, white);
    stroke: var(--z-relation);
    stroke-width: 1;
    stroke-dasharray: 3 2;
  }
  .el {
    font-family: var(--font-z);
    font-style: normal;
    font-size: 13px;
    fill: var(--fg);
    text-anchor: middle;
    dominant-baseline: central;
  }
  .el.number {
    font-style: normal;
  }
  .el.bad {
    fill: var(--bad);
    font-weight: 600;
  }
  .arrow {
    stroke: var(--z-relation);
    stroke-width: 1.35;
    fill: none;
  }
  .arrow.added {
    stroke: var(--diff-added-fg);
    stroke-width: 1.8;
  }
  .arrow.removed {
    stroke: var(--diff-removed-fg);
    stroke-dasharray: 3 2.5;
    opacity: 0.6;
  }
  .arrow.bad {
    stroke: var(--bad);
    stroke-width: 1.6;
  }
  .strike {
    stroke: var(--diff-removed-fg);
    stroke-width: 1.5;
    stroke-linecap: round;
  }
  .head path {
    fill: var(--z-relation);
  }
  .head.added path {
    fill: var(--diff-added-fg);
  }
  .head.removed path {
    fill: var(--diff-removed-fg);
    opacity: 0.6;
  }
  .head.bad path {
    fill: var(--bad);
  }
  figcaption {
    max-width: 100%;
    text-align: center;
    text-wrap: balance;
    margin-top: 4px;
    font-size: 12.5px;
    line-height: 1.35;
    color: var(--fg-muted);
  }
  .verdict {
    font-weight: 700;
    margin-right: 4px;
  }
  .verdict.ok {
    color: var(--ok);
  }
  .verdict.bad {
    color: var(--bad);
  }
</style>
