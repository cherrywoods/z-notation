// Light-weight text helpers that do not need the full Z engine (used for highlighting
// and explainer context while the user is typing).

import type { SchemaDoc, SpecDoc } from './model';
import type { ExplainerContext } from '../../ui/explain/explain.svelte';
import { isIdentChar, isIdentStart } from '../z/lexer';
import { parseGiven } from '../z/parser';

/** A Z identifier by the lexer's rules (so ℕ, ℙ, Δ, Ξ are not names). */
export function isIdent(name: string): boolean {
  const cs = [...name];
  return cs.length > 0 && isIdentStart(cs[0]) && cs.slice(1).every(isIdentChar);
}

/** Names declared in the given-set paragraph(s), as the parser reads them. */
export function givenNames(text: string): string[] {
  try {
    return [...new Set(parseGiven(text).names.map((n) => n.name))];
  } catch {
    return [];
  }
}

export function schemasOf(spec: SpecDoc): SchemaDoc[] {
  return [spec.state, ...spec.operations, ...(spec.init ? [spec.init] : [])];
}

/** Why `name` cannot name the schema `schemaId` (one short line), or null if it can. */
export function schemaNameError(spec: SpecDoc, schemaId: string, name: string): string | null {
  const n = name.trim();
  if (!n) return 'Give it a name.';
  if (!isIdent(n)) {
    if (/[ΔΞ]/.test(n)) return 'No Δ or Ξ in the name.';
    if (/\s/.test(n)) return 'No spaces.';
    if (/^\p{N}/u.test(n)) return 'Start with a letter.';
    return 'Letters, digits and _ only.';
  }
  if (givenNames(spec.given).includes(n)) return `${n} is already a type.`;
  if (schemasOf(spec).some((s) => s.id !== schemaId && s.name.trim() === n)) return `Another schema is called ${n}.`;
  return null;
}

/**
 * The state schema was renamed from `from` to `to`: update ΔFrom / ΞFrom in the
 * operations, the bare `From` / `From′` line in Init, and the Init name if it is
 * still `InitFrom`. Mutates `spec`.
 */
export function renameStateRefs(spec: SpecDoc, from: string, to: string): void {
  if (!from || from === to) return;
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ref = new RegExp(`([ΔΞ])${esc}(?![\\p{L}\\p{N}_])`, 'gu');
  for (const op of spec.operations) {
    const decls = op.decls.replace(ref, `$1${to}`);
    if (decls !== op.decls) op.decls = decls;
  }
  const init = spec.init;
  if (!init) return;
  const bare = new RegExp(`^(\\s*)${esc}(′|')?(\\s*)$`, 'gmu');
  const decls = init.decls.replace(bare, (_m, a: string, prime: string | undefined, b: string) => `${a}${to}${prime ?? ''}${b}`);
  if (decls !== init.decls) init.decls = decls;
  if (init.name === `Init${from}`) init.name = `Init${to}`;
}

/** Undecorated variable names declared as `a, b : T` lines. */
export function declaredNames(decls: string): string[] {
  const out: string[] = [];
  for (const line of decls.split(/[\n;]/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    for (const n of line.slice(0, i).split(',')) {
      const name = n.trim();
      if (isIdent(name) && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

export function explainCtxOf(spec: SpecDoc): ExplainerContext {
  return { stateName: spec.state.name, stateVars: declaredNames(spec.state.decls) };
}

/**
 * Diagnostics worth showing: none for schemas the student has not started yet
 * (both parts empty) — a bare schema should not greet them with errors.
 */
export function visibleDiagnostics<D extends { section: { schemaId: string } }>(spec: SpecDoc, diags: D[]): D[] {
  const blank = new Set<string>();
  for (const s of [spec.state, ...(spec.init ? [spec.init] : []), ...spec.operations])
    if (!s.decls.trim() && !s.preds.trim()) blank.add(s.id);
  if (/^\s*\[\s*\]\s*$/.test(spec.given) || !spec.given.trim()) blank.add('types');
  return diags.filter((d) => !blank.has(d.section.schemaId));
}
