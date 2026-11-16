// Sound rewrite laws (equalities that hold for all relations / sets), applied one
// step at a time so that each step can be shown with its reason, as on the slides:
//
//   = dom (borrower ∪ {book? ↦ member?})
//   = dom borrower ∪ dom {book? ↦ member?}   [fact about dom]
//   = dom borrower ∪ {book?}                 [fact about dom]
//
// Deliberately NOT included (not true in general): dom (R ∖ S) = dom R ∖ dom S,
// dom (R ∩ S) = dom R ∩ dom S, ran (f ∖ {a ↦ f(a)}) = ran f ∖ {f(a)}, #(A ∪ B) = #A + #B.

import type { Term } from '../ast';
import { mapTerm } from '../print';
import { isEmptySet, key, mk, pairParts } from './terms';

/** What some laws need to know about the variables. */
export interface LawEnv {
  /** Is `name` declared as a function (⇸ or →)? */
  isFunction(name: string): boolean;
}

export interface Law {
  id: string;
  /** Bracket text, e.g. 'fact about dom'. */
  reason: string;
  /** The law itself, e.g. 'dom ∅ = ∅' (shown as a premise in 'facts' derivations). */
  statement: string;
  apply(t: Term, env: LawEnv): Term | null;
}

const NO_ENV: LawEnv = { isFunction: () => false };

type Unop = Extract<Term, { kind: 'unop' }>;
type Binop = Extract<Term, { kind: 'binop' }>;
const isUnop = (t: Term, op: 'dom' | 'ran' | '#'): t is Unop => t.kind === 'unop' && t.op === op;
const isBin = (t: Term, op: string): t is Binop => t.kind === 'binop' && t.op === op;

/** Operands of a ∪-chain (associativity), in order. */
function unionOperands(t: Term, out: Term[] = []): Term[] {
  if (isBin(t, '∪')) {
    unionOperands(t.left, out);
    unionOperands(t.right, out);
  } else out.push(t);
  return out;
}

/** a ∪ b ∪ c, left-associated (as it prints without parentheses). */
const unionOf = (ts: Term[]): Term => ts.reduce((acc, t) => mk.bin('∪', acc, t));

function projectDisplay(t: Term, i: 0 | 1): Term | null {
  if (t.kind !== 'setDisplay' || t.elems.length === 0) return null;
  const out: Term[] = [];
  for (const e of t.elems) {
    const p = pairParts(e);
    if (!p) return null;
    if (!out.some((o) => key(o) === key(p[i]))) out.push(p[i]);
  }
  return mk.display(out);
}

function domRanLaws(op: 'dom' | 'ran'): Law[] {
  const reason = `fact about ${op}`;
  return [
    {
      // dom (A ∪ B ∪ C) = dom A ∪ dom B ∪ dom C, in one step
      id: `${op}∪`,
      reason,
      statement: `${op} (R ∪ S) = ${op} R ∪ ${op} S`,
      apply: (t) => (isUnop(t, op) && isBin(t.arg, '∪') ? unionOf(unionOperands(t.arg).map((r) => mk.unop(op, r))) : null),
    },
    {
      id: `${op}{}`,
      reason,
      statement: op === 'dom' ? 'dom {a ↦ b} = {a}' : 'ran {a ↦ b} = {b}',
      apply: (t) => (isUnop(t, op) ? projectDisplay(t.arg, op === 'dom' ? 0 : 1) : null),
    },
    {
      id: `${op}∅`,
      reason,
      statement: `${op} ∅ = ∅`,
      apply: (t) => (isUnop(t, op) && isEmptySet(t.arg) ? mk.empty() : null),
    },
  ];
}

/**
 * dom (f ∖ {a ↦ f(a), …}) = dom f ∖ {a, …} for a function f. (If a ∉ dom f, the pair
 * a ↦ f(a) is not in f and both sides equal dom f; so it holds in any case.)
 */
const DOM_REMOVE: Law = {
  id: 'dom∖f',
  reason: 'fact about dom',
  statement: 'dom (f ∖ {a ↦ f(a)}) = dom f ∖ {a}',
  apply: (t, env) => {
    if (!isUnop(t, 'dom') || !isBin(t.arg, '∖')) return null;
    const f = t.arg.left;
    const S = t.arg.right;
    if (f.kind !== 'name' || !env.isFunction(f.name) || S.kind !== 'setDisplay' || S.elems.length === 0) return null;
    const kf = key(f);
    const firsts: Term[] = [];
    for (const e of S.elems) {
      const p = pairParts(e);
      if (!p || p[1].kind !== 'apply' || key(p[1].fn) !== kf || key(p[1].arg) !== key(p[0])) return null;
      firsts.push(p[0]);
    }
    return mk.bin('∖', mk.unop('dom', f), mk.display(firsts));
  },
};

export const LAWS: Law[] = [
  ...domRanLaws('dom'),
  ...domRanLaws('ran'),
  DOM_REMOVE,
  {
    id: '∪∅',
    reason: 'fact about ∪',
    statement: 'A ∪ ∅ = A',
    apply: (t) => (isBin(t, '∪') ? (isEmptySet(t.right) ? t.left : isEmptySet(t.left) ? t.right : null) : null),
  },
  {
    // {a} ∪ {b} = {a, b}, also within a longer ∪-chain: onLoan ∪ {a?} ∪ {b?} = onLoan ∪ {a?, b?}
    id: '{}∪{}',
    reason: 'fact about ∪',
    statement: '{a} ∪ {b} = {a, b}',
    apply: (t) => {
      if (!isBin(t, '∪')) return null;
      const ops = unionOperands(t);
      const displays = ops.filter((o) => o.kind === 'setDisplay' && o.elems.length > 0);
      if (displays.length < 2) return null;
      const elems: Term[] = [];
      for (const d of displays) {
        for (const e of (d as Extract<Term, { kind: 'setDisplay' }>).elems) if (!elems.some((x) => key(x) === key(e))) elems.push(e);
      }
      const merged = mk.display(elems);
      const first = ops.indexOf(displays[0]);
      return unionOf(ops.flatMap((o, i) => (i === first ? [merged] : displays.includes(o) ? [] : [o])));
    },
  },
  {
    id: '∩∅',
    reason: 'fact about ∩',
    statement: 'A ∩ ∅ = ∅',
    apply: (t) => (isBin(t, '∩') && (isEmptySet(t.left) || isEmptySet(t.right)) ? mk.empty() : null),
  },
  {
    id: '∖∅',
    reason: 'fact about ∖',
    statement: 'A ∖ ∅ = A',
    apply: (t) => (isBin(t, '∖') ? (isEmptySet(t.right) ? t.left : isEmptySet(t.left) ? mk.empty() : null) : null),
  },
  {
    id: '#∅',
    reason: 'fact about #',
    statement: '#∅ = 0',
    apply: (t) => (isUnop(t, '#') && isEmptySet(t.arg) ? mk.num(0) : null),
  },
];

/** Apply the first applicable law at the leftmost-outermost position. */
export function rewriteOnce(t: Term, env: LawEnv = NO_ENV, laws: readonly Law[] = LAWS): { term: Term; law: Law } | null {
  let found = null as Law | null;
  const out = mapTerm(t, (x) => {
    if (found) return x;
    for (const law of laws) {
      const r = law.apply(x, env);
      if (r) {
        found = law;
        return r;
      }
    }
    return undefined;
  });
  return found ? { term: out, law: found } : null;
}

/** Rewrite until no law applies; one entry per step. */
export function simplify(t: Term, env: LawEnv = NO_ENV, laws: readonly Law[] = LAWS, max = 16): { term: Term; law: Law }[] {
  const steps: { term: Term; law: Law }[] = [];
  let cur = t;
  for (let i = 0; i < max; i++) {
    const r = rewriteOnce(cur, env, laws);
    if (!r) break;
    steps.push(r);
    cur = r.term;
  }
  return steps;
}
