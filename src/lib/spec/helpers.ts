// Light-weight text helpers that do not need the full Z engine (used for highlighting
// and explainer context while the user is typing).

import type { SpecDoc } from './model';
import type { ExplainerContext } from '../../ui/explain/explain.svelte';

/** Names in `[A, B] [C]` given-set paragraphs. */
export function givenNames(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\[([^\]]*)\]/g)) {
    for (const n of m[1].split(',')) {
      const name = n.trim();
      if (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/** Undecorated variable names declared as `a, b : T` lines. */
export function declaredNames(decls: string): string[] {
  const out: string[] = [];
  for (const line of decls.split(/[\n;]/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    for (const n of line.slice(0, i).split(',')) {
      const name = n.trim();
      if (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

export function explainCtxOf(spec: SpecDoc): ExplainerContext {
  return { stateName: spec.state.name, stateVars: declaredNames(spec.state.decls) };
}
