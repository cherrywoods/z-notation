// Graded truth of a predicate for local search: 0 exactly when `evalPred` would
// return true, otherwise a positive "distance" (≥ 1) that shrinks as the example
// gets closer to satisfying it (|A Δ B| for set equalities, |A ∖ B| for ⊆, the number
// of failing bindings for ∀, …). Undefined applications count as false.
//
// The evaluation order of the engine (left-to-right short-circuit) is respected, so
// that "0" never hides an undefined sub-term that `evalPred` would run into.

import type { Term } from '../ast';
import { EvalError, equalValues, evalPred, evalPredChecked, evalTerm, failingBindings, memberOf, type Universe } from '../eval';
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
export function truth(
  t: Term,
  env: Env,
  u: Universe,
): { result: boolean | 'undefined'; message?: string; general?: string; bounded?: true } {
  try {
    const r = evalPredChecked(t, env, u);
    return r.bounded ? { result: r.value, bounded: true } : { result: r.value };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!(e instanceof EvalError) || e.reason !== 'undefined') return { result: false, message };
    const general = e.general;
    return general ? { result: 'undefined', message, general } : { result: 'undefined', message };
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

// ── ∀ ──────────────────────────────────────────────────────────────────────────

/**
 * How badly the bindings violate the body: the sum of the body's distances over the
 * failing bindings (capped). The verdict itself is the evaluator's, and the failing
 * bindings are enumerated exactly as it does (same order, guards and work limit), so
 * the distance is 0 exactly when the evaluator says true.
 */
function forall(t: Quant, env: Env, u: Universe): number {
  const h = holds(t, env, u);
  if (h === true) return 0;
  if (h === 'error') return 1;
  let fails = 0;
  try {
    failingBindings(t, env, u, (e) => {
      // a failing binding counts with the body's own distance, so that getting closer
      // (e.g. one element fewer in a set that must be empty) is an improvement
      fails += Math.max(1, dist(t.body, new Map(e), u));
      return fails >= MAX_FAIL;
    });
  } catch {
    /* keep what was counted */
  }
  return Math.max(1, fails);
}
