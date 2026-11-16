// Turns a Z text into render pieces for ZText.svelte: the lexer's highlight spans,
// refined for static display (value literals like 2.Feb, '==' in definitions,
// ΔState / book? as one hover target, set display vs. comprehension braces,
// application parentheses), plus the plain gaps in between.

import { highlight, type HighlightSpan } from '../../lib/z/lexer';
import type { ExplainerContext } from '../../lib/content/explainers';

export interface ZPart {
  text: string;
  cls: string;
}

export interface ZPiece {
  text: string;
  /** CSS classes; absent for plain text (whitespace, gaps). */
  cls?: string;
  /** Sub-spans with their own classes (compound pieces such as ΔLibrary or book?). */
  parts?: ZPart[];
  /** Explainer id shown on hover/click. */
  explain?: string;
  /** Context passed to the explainer (state name, subject, …). */
  ctx?: ExplainerContext;
  /** Pieces of one construct (matching braces + bar, application parentheses) share a group. */
  group?: number;
}

interface Span extends HighlightSpan {
  parts?: ZPart[];
  ctx?: ExplainerContext;
  group?: number;
}

const VALUE_LITERAL = /(?<![\p{L}\p{N}_])\d+\.[A-Za-z]+(?![\p{L}\p{N}_])/gu;

export function zPieces(text: string, givenSets: readonly string[] = [], ctx?: ExplainerContext): ZPiece[] {
  const given = [...new Set([...(ctx?.givenSets ?? []), ...givenSets])];
  const baseCtx: ExplainerContext | undefined = given.length ? { ...ctx, givenSets: given } : ctx;
  let spans: Span[] = highlight(text, new Set(given)).map((s) => ({ ...s }));
  const src = (s: Span) => text.slice(s.from, s.to);

  // 1. Value literals such as 2.Feb (number, '.', identifier) form one upright value.
  const values = [...text.matchAll(VALUE_LITERAL)].map((m) => [m.index, m.index + m[0].length] as const);
  if (values.length) {
    spans = spans.filter((s) => !values.some(([a, b]) => s.from < b && s.to > a));
    for (const [a, b] of values) spans.push({ from: a, to: b, cls: 'z-value' });
    spans.sort((x, y) => x.from - y.from);
  }

  const out: Span[] = [];
  for (let k = 0; k < spans.length; k++) {
    const s = spans[k];
    const next = spans[k + 1];
    const t = src(s);

    // 2. '…' in set displays like {0, 1, 2, …} is not an error.
    if (s.cls === 'z-error' && t === '…') {
      out.push({ ...s, cls: 'z-punct' });
      continue;
    }

    // 3. '==' (is defined as) in definitions.
    if (t === '=' && next && next.from === s.to && src(next) === '=') {
      out.push({ from: s.from, to: next.to, cls: 'z-logic', explain: 'defeq', ctx: baseCtx });
      k++;
      continue;
    }

    // 4. Decorated identifiers (borrower′, book?, member!): one hover target.
    if (
      s.explain &&
      s.cls.startsWith('z-ident') &&
      next &&
      next.from === s.to &&
      next.explain === s.explain &&
      next.cls.startsWith('z-decoration')
    ) {
      out.push({
        from: s.from,
        to: next.to,
        cls: 'z-decorated',
        explain: s.explain,
        parts: [
          { text: t, cls: s.cls },
          { text: src(next), cls: next.cls },
        ],
        ctx: { ...baseCtx, subject: t + src(next) },
      });
      k++;
      continue;
    }

    // 5. ΔState / ΞState: one hover target, instantiated with the state's name.
    if ((s.explain === 'delta' || s.explain === 'xi') && next && next.from === s.to && next.cls === 'z-ident') {
      const name = src(next);
      const sameState = !ctx?.stateName || ctx.stateName === name;
      out.push({
        from: s.from,
        to: next.to,
        cls: 'z-schema-ref',
        explain: s.explain,
        parts: [
          { text: t, cls: s.cls },
          { text: name, cls: 'z-ident z-schema-name' },
        ],
        ctx: { ...baseCtx, stateName: name, stateVars: sameState ? ctx?.stateVars : undefined },
      });
      k++;
      continue;
    }

    // 6. Given-set names: the explainer names them.
    if (s.explain === 'given' && s.cls === 'z-given') {
      out.push({ ...s, ctx: { ...baseCtx, subject: t } });
      continue;
    }

    // 7. The state schema's name (e.g. the import line of Init).
    if (!s.explain && s.cls === 'z-ident' && ctx?.stateName && t === ctx.stateName) {
      out.push({ ...s, explain: 'state', ctx: { ...baseCtx, subject: t } });
      continue;
    }

    out.push(s.explain ? { ...s, ctx: s.ctx ?? baseCtx } : s);
  }

  // 8. Braces: set display vs. set comprehension; parentheses after a name: application.
  const stack: { idx: number; ch: string; comp: boolean; bars: number[]; apply: boolean }[] = [];
  for (let k = 0; k < out.length; k++) {
    const s = out[k];
    const t = src(s);
    if (t === '{' || t === '(' || t === '[') {
      const prev = out[k - 1];
      const apply =
        t === '(' && !!prev && prev.to === s.from && /^z-(ident|decorated|given)/.test(prev.cls) && !prev.cls.includes('z-schema');
      stack.push({ idx: k, ch: t, comp: false, bars: [], apply });
    } else if (t === '|' || t === '•') {
      const top = stack[stack.length - 1];
      if (top?.ch === '{') {
        top.comp = true;
        if (t === '|') top.bars.push(k);
      }
    } else if (t === '}' || t === ')' || t === ']') {
      const open = { '}': '{', ')': '(', ']': '[' }[t];
      const top = stack[stack.length - 1];
      if (!top || top.ch !== open) continue;
      stack.pop();
      let id: string | undefined;
      if (t === '}') id = top.comp ? 'setcomp' : 'setdisplay';
      else if (t === ')' && top.apply) id = 'apply';
      if (!id) continue;
      for (const j of [top.idx, k, ...top.bars]) out[j] = { ...out[j], explain: id, ctx: baseCtx, group: top.idx };
    }
  }

  // 9. Pieces, including the plain gaps.
  const pieces: ZPiece[] = [];
  let pos = 0;
  for (const s of out) {
    if (s.from < pos) continue;
    if (s.from > pos) pieces.push({ text: text.slice(pos, s.from) });
    pieces.push({
      text: src(s),
      cls: s.cls,
      parts: s.parts,
      explain: s.explain,
      ctx: s.explain ? s.ctx : undefined,
      group: s.group,
    });
    pos = s.to;
  }
  if (pos < text.length) pieces.push({ text: text.slice(pos) });
  return pieces;
}
