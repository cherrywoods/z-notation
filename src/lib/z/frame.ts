// The tutorial's frame convention (docs/design.md): in a Δ operation, a state variable
// whose primed name no predicate line mentions stays unchanged (v′ = v). Exception: the
// state invariant determines v from variables the operation may change (onLoan =
// dom borrower when Lend sets borrower′); then v′ follows from the invariant after, and
// v′ = v would contradict the operation. Used by index.ts (the frame lines) and
// infer.ts (the note on redundant lines).
//
// What the invariant determines is recognised syntactically, sound but not complete:
//   v = E  (either way round)                      v from the state variables of E
//   A = S ∖ B  with B ⊆ S                          also B (= S ∖ A)
//   A ∪ B ∪ … = S  with the parts pairwise disjoint  each part (= S ∖ the others)
//   ∀ x ∈ S . x ∈ A ⇔ P  with A ⊆ S                 A (= {x ∈ S | P})

import type { PredInfo, SchemaInfo } from './index';
import type { Term } from './ast';
import { freeVars, printTerm } from './print';
import { conjuncts, isEmptySet, key } from './infer/terms';

/** The invariant determines state variable `v` from the state variables `deps`. */
export interface Determination {
  v: string;
  deps: string[];
}

/**
 * Determinations in the conjuncts of the (unprimed) state invariant. `decls`: the
 * declared set of each state variable (its keys are the state variables).
 */
export function determinations(inv: Term[], decls: ReadonlyMap<string, Term>): Determination[] {
  const out: Determination[] = [];
  const isState = (t: Term): t is Extract<Term, { kind: 'name' }> => t.kind === 'name' && decls.has(t.name);
  const stateIn = (...ts: Term[]) => [...new Set(ts.flatMap((t) => [...freeVars(t)].filter((n) => decls.has(n))))];
  const add = (v: string, deps: string[]) => {
    if (deps.length && !deps.includes(v)) out.push({ v, deps });
  };
  const invKeys = new Set(inv.map(key));
  // B ⊆ S: by the declaration B : ℙ S, or an invariant line B ⊆ S
  const within = (B: string, S: Term) => {
    const d = decls.get(B);
    const kS = key(S);
    if (d && d.kind === 'unop' && d.op === 'ℙ' && key(d.arg) === kS) return true;
    const b: Term = { kind: 'name', name: B, base: B, decoration: '', span: S.span };
    return invKeys.has(key({ kind: 'rel', op: '⊆', left: b, right: S, span: S.span }));
  };
  const disjoint = (a: Term, b: Term) =>
    invKeys.has(key({ kind: 'rel', op: '=', left: { kind: 'binop', op: '∩', left: a, right: b, span: a.span }, right: { kind: 'emptyset', span: a.span }, span: a.span }));

  for (const c of inv) {
    if (c.kind === 'rel' && c.op === '=') {
      for (const [l, r] of [
        [c.left, c.right],
        [c.right, c.left],
      ]) {
        // v = E
        if (isState(l)) add(l.name, stateIn(r).filter((n) => n !== l.name));
        // A = S ∖ B with B ⊆ S: B = S ∖ A
        if (r.kind === 'binop' && r.op === '∖' && isState(r.right) && within(r.right.name, r.left)) {
          const B = r.right.name;
          if (!freeVars(l).has(B) && !freeVars(r.left).has(B)) add(B, stateIn(l, r.left));
        }
        // A ∪ B ∪ … = S with the parts pairwise disjoint: A = S ∖ (B ∪ …)
        const parts = unionParts(l);
        if (parts.length > 1 && !isEmptySet(r)) {
          for (const p of parts) {
            if (!isState(p)) continue;
            const others = parts.filter((o) => o !== p);
            if (freeVars(r).has(p.name) || others.some((o) => freeVars(o).has(p.name))) continue;
            if (others.every((o) => disjoint(p, o))) add(p.name, stateIn(r, ...others));
          }
        }
      }
    }
    // ∀ x ∈ S . x ∈ A ⇔ P with A ⊆ S: A = {x ∈ S | P}
    if (c.kind === 'quant' && c.q === '∀' && !c.pred && c.decls.length === 1 && c.decls[0].names.length === 1) {
      const x = c.decls[0].names[0].name;
      const S = c.decls[0].type;
      const body = c.body;
      if (body.kind !== 'logic' || body.op !== '⇔' || freeVars(S).has(x)) continue;
      for (const [side, other] of [
        [body.left, body.right],
        [body.right, body.left],
      ]) {
        const A = memberOf(side, x);
        if (!A || !isState(A) || A.name === x || !within(A.name, S)) continue;
        if (freeVars(other).has(A.name) || freeVars(S).has(A.name)) continue;
        add(A.name, stateIn(other, S).filter((n) => n !== x));
      }
    }
  }
  return out;
}

/** `x ∈ A`, `x ∉ A` or `¬ (x ∈ A)` (for the bound variable x): A. */
function memberOf(t: Term, x: string): Term | null {
  if (t.kind === 'not') return memberOf(t.arg, x);
  if (t.kind === 'rel' && (t.op === '∈' || t.op === '∉') && t.left.kind === 'name' && t.left.name === x) return t.right;
  return null;
}

const unionParts = (t: Term): Term[] => (t.kind === 'binop' && t.op === '∪' ? [...unionParts(t.left), ...unionParts(t.right)] : [t]);

/**
 * The state variables the frame convention keeps unchanged: those not mentioned, unless
 * a determination links them (step by step) to a mentioned variable — then they may
 * change with it, and the invariant after says how.
 */
export function frozenVars(stateVars: readonly string[], mentioned: (v: string) => boolean, dets: readonly Determination[]): string[] {
  const free = new Set(stateVars.filter(mentioned));
  for (let grew = true; grew; ) {
    grew = false;
    for (const { v, deps } of dets) {
      if (free.has(v) || !deps.some((d) => free.has(d))) continue;
      free.add(v);
      grew = true;
    }
  }
  return stateVars.filter((v) => !free.has(v));
}

/** The frame lines `v′ = v` of an operation that a failed predicate mentions. */
export function framesIn(op: SchemaInfo, failed: Term): PredInfo[] {
  const fv = freeVars(failed);
  return op.preds.filter((p) => p.origin === 'frame' && p.term.kind === 'rel' && p.term.left.kind === 'name' && fv.has(p.term.left.name));
}

/**
 * The Example panel's message when frame lines break the invariant after, e.g.
 * "‘red′ = red’ is assumed because ClearSignal doesn't mention red′, but that
 * contradicts the invariant. Say how red changes."
 */
export function frameConflictMessage(opName: string, frames: PredInfo[]): string {
  const eqs = frames.map((p) => `‘${printTerm(p.term)}’`);
  const primed = frames.map((p) => (p.term.kind === 'rel' ? printTerm(p.term.left) : ''));
  const vars = frames.map((p) => (p.term.kind === 'rel' ? printTerm(p.term.right) : ''));
  const one = frames.length === 1;
  return (
    `${list(eqs, 'and')} ${one ? 'is' : 'are'} assumed because ${opName} doesn't mention ${list(primed, 'or')}, ` +
    `but that contradicts the invariant. Say how ${list(vars, 'and')} ${one ? 'changes' : 'change'}.`
  );
}

function list(parts: string[], word: string): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} ${word} ${parts[parts.length - 1]}`;
}
