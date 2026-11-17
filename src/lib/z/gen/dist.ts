// Graded truth of a predicate for local search: 0 exactly when `evalPred` would
// return true, otherwise a positive "distance" (≥ 1) that shrinks as the example
// gets closer to satisfying it (|A Δ B| for set equalities, |A ∖ B| for ⊆, the number
// of failing bindings for ∀, …). Undefined applications count as false.
//
// The evaluation order of the engine (left-to-right short-circuit) is respected, so
// that "0" never hides an undefined sub-term that `evalPred` would run into.

import type { Term, VarDecl } from '../ast';
import { EvalError, bindingValues, equalValues, evalPred, evalPredChecked, evalTerm, memberOf, type Universe } from '../eval';
import { freeVars } from '../print';
import { isSetLike, valueKey, type Value } from '../values';

type Env = Map<string, Value>;
type Quant = Extract<Term, { kind: 'quant' }>;

/** Cap on the number of failing ∀ bindings counted. */
const MAX_FAIL = 50;

export function dist(t: Term, env: Env, u: Universe): number {
  try {
    return d(t, env, u);
  } catch {
    return 1;
  }
}

/** Does the term bind variables (∀, ∃, set comprehension)? Those are costly to evaluate. */
export function hasBinder(t: Term): boolean {
  if (t.kind === 'quant' || t.kind === 'setComp') return true;
  switch (t.kind) {
    case 'setDisplay':
    case 'tuple':
    case 'cross':
      return t.elems.some(hasBinder);
    case 'apply':
      return hasBinder(t.fn) || hasBinder(t.arg);
    case 'unop':
    case 'not':
      return hasBinder(t.arg);
    case 'binop':
    case 'rel':
    case 'logic':
      return hasBinder(t.left) || hasBinder(t.right);
    default:
      return false;
  }
}

/**
 * Truth of a predicate as the evaluator defines it, with the reason when it is not
 * true, and `bounded` when the verdict relied on cutting off an infinite set.
 */
export function truth(t: Term, env: Env, u: Universe): { result: boolean | 'undefined'; message?: string; bounded?: true } {
  try {
    const r = evalPredChecked(t, env, u);
    return r.bounded ? { result: r.value, bounded: true } : { result: r.value };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { result: e instanceof EvalError && e.reason === 'undefined' ? 'undefined' : false, message };
  }
}

/** Exact truth (true only if evaluation succeeds and gives true). */
function holds(t: Term, env: Env, u: Universe): boolean | 'error' {
  try {
    return evalPred(t, env, u);
  } catch {
    return 'error';
  }
}

const exact = (t: Term, env: Env, u: Universe): number => (holds(t, env, u) === true ? 0 : 1);

function d(t: Term, env: Env, u: Universe): number {
  switch (t.kind) {
    case 'bool':
      return t.value ? 0 : 1;
    case 'logic': {
      switch (t.op) {
        case '∧':
          return dist(t.left, env, u) + dist(t.right, env, u);
        case '∨': {
          const l = holds(t.left, env, u);
          if (l === true) return 0;
          if (l === 'error') return 1;
          return Math.min(dist(t.left, env, u), dist(t.right, env, u));
        }
        case '⇒': {
          const l = holds(t.left, env, u);
          if (l === 'error') return 1;
          return l ? dist(t.right, env, u) : 0;
        }
        default:
          return exact(t, env, u);
      }
    }
    case 'quant':
      return t.q === '∀' ? forall(t, env, u) : exact(t, env, u);
    case 'rel':
      return rel(t, env, u);
    default:
      return exact(t, env, u);
  }
}

function rel(t: Extract<Term, { kind: 'rel' }>, env: Env, u: Universe): number {
  const l = evalTerm(t.left, env, u);
  const r = evalTerm(t.right, env, u);
  switch (t.op) {
    case '=': {
      if (equalValues(l, r, u)) return 0;
      if (l.k === 'set' && r.k === 'set') {
        let n = 0;
        for (const e of l.elems) if (!r.index.has(valueKey(e))) n++;
        for (const e of r.elems) if (!l.index.has(valueKey(e))) n++;
        return Math.max(1, n);
      }
      if (l.k === 'int' && r.k === 'int') return numDist(Math.abs(l.v - r.v));
      return 1;
    }
    case '≠':
      return equalValues(l, r, u) ? 1 : 0;
    case '∈':
      if (!isSetLike(r)) throw new Error('not a set');
      return memberOf(l, r, u) ? 0 : 1;
    case '∉':
      if (!isSetLike(r)) throw new Error('not a set');
      return memberOf(l, r, u) ? 1 : 0;
    case '⊆':
    case '⊂': {
      if (l.k !== 'set' || !isSetLike(r)) return exact(t, env, u);
      let n = 0;
      for (const e of l.elems) if (!memberOf(e, r, u)) n++;
      if (t.op === '⊂' && n === 0 && equalValues(l, r, u)) return 1;
      return n;
    }
    case '<':
    case '≤':
    case '>':
    case '≥': {
      if (l.k !== 'int' || r.k !== 'int') throw new Error('not a number');
      const a = l.v;
      const b = r.v;
      const ok = t.op === '<' ? a < b : t.op === '≤' ? a <= b : t.op === '>' ? a > b : a >= b;
      if (ok) return 0;
      // how far off (a strict comparison needs one more step past equality)
      const strict = t.op === '<' || t.op === '>';
      return numDist(Math.abs(a - b) + (strict ? 1 : 0));
    }
  }
}

const numDist = (gap: number) => 1 + Math.min(gap, 1000) / 1000;

// ── ∀ with pruning ─────────────────────────────────────────────────────────────

interface QuantInfo {
  names: { name: string; type: Term }[];
  /** Conjuncts of the `| P` part and the antecedent of a body `A ⇒ B`, in evaluation order. */
  guards: { term: Term; need: number }[];
}
const quantCache = new WeakMap<Quant, QuantInfo>();

const conj = (t: Term): Term[] => (t.kind === 'logic' && t.op === '∧' ? [...conj(t.left), ...conj(t.right)] : [t]);

function quantInfo(t: Quant): QuantInfo {
  let qi = quantCache.get(t);
  if (qi) return qi;
  let names = t.decls.flatMap((dcl: VarDecl) => dcl.names.map((n) => ({ name: n.name, type: dcl.type })));
  // guards in evaluation order: the `| P` part, then (once it holds) the body's antecedent
  const terms = [...(t.pred ? conj(t.pred) : []), ...(t.body.kind === 'logic' && t.body.op === '⇒' ? conj(t.body.left) : [])];
  // Bind the variables of the first guards first, so that they prune early
  // (∀ a, b : NAME; d, e : DATE • (a ↦ d) ∈ f ∧ … binds a, d before b, e). Only when
  // no declared set mentions a bound variable, so the order does not matter.
  const bound = new Set(names.map((n) => n.name));
  const closed = bound.size === names.length && names.every((n) => ![...freeVars(n.type)].some((f) => bound.has(f)));
  if (closed && terms.length) {
    const order: typeof names = [];
    for (const g of terms) {
      const fv = freeVars(g);
      for (const n of names) if (fv.has(n.name) && !order.includes(n)) order.push(n);
    }
    for (const n of names) if (!order.includes(n)) order.push(n);
    names = order;
  }
  const pos = new Map(names.map((n, i) => [n.name, i]));
  const needOf = (x: Term) => {
    let need = -1;
    for (const f of freeVars(x)) {
      const p = pos.get(f);
      if (p !== undefined && p > need) need = p;
    }
    return need;
  };
  const guards = terms.map((term) => ({ term, need: needOf(term) }));
  qi = { names, guards };
  quantCache.set(t, qi);
  return qi;
}

/** Number of bindings that violate the body (capped). */
function forall(t: Quant, env: Env, u: Universe): number {
  const { names, guards } = quantInfo(t);
  const saved = names.map((n) => (env.has(n.name) ? env.get(n.name) : undefined));
  let fails = 0;

  // `probe`: a value beyond the ℕ / ℤ window is bound; errors there are ignored,
  // exactly as in the evaluator
  const go = (i: number, g: number, probe: boolean): void => {
    // evaluate the guards that are fully bound, in order; a false guard makes the
    // whole subtree vacuously true (exactly as the short-circuiting evaluator would)
    while (g < guards.length && guards[g].need < i) {
      const h = holds(guards[g].term, env, u);
      if (h === false) return;
      if (h === 'error') break; // let the full evaluation report it
      g++;
    }
    if (i === names.length) {
      let ok: boolean;
      try {
        ok = (t.pred ? !evalPred(t.pred, env, u) : false) || evalPred(t.body, env, u);
      } catch {
        ok = probe;
      }
      if (!ok) fails++;
      return;
    }
    const s = evalTerm(names[i].type, env, u);
    if (!isSetLike(s)) throw new Error('not a set');
    const list = bindingValues(s, env, u);
    if (!list) throw new Error('too large');
    for (let k = 0; k < list.values.length; k++) {
      env.set(names[i].name, list.values[k]);
      go(i + 1, g, probe || list.probe[k]);
      if (fails >= MAX_FAIL) return;
    }
  };

  try {
    go(0, 0, false);
  } catch {
    fails = Math.max(fails, 1);
  } finally {
    names.forEach((n, i) => {
      const old = saved[i];
      if (old === undefined) env.delete(n.name);
      else env.set(n.name, old);
    });
  }
  return fails;
}
