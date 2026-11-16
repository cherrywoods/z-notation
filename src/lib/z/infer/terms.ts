// Term helpers for the inference engine: builders for synthesised terms, a
// normalised comparison key (modulo commutativity / associativity of ∪ ∩ ∧ ∨ + *,
// symmetry of = ≠ ⇔, order and duplicates in set displays, renaming of bound
// variables), predicate "atoms" and sub-term replacement.

import type { BinOp, RelOp, Span, Term } from '../ast';
import { children, freeVars, mapTerm, nameTerm } from '../print';

export const SPAN0: Span = { from: 0, to: 0 };

export const mk = {
  name: (n: string): Term => nameTerm(n),
  empty: (): Term => ({ kind: 'emptyset', span: SPAN0 }),
  num: (value: number): Term => ({ kind: 'num', value, span: SPAN0 }),
  unop: (op: 'dom' | 'ran' | '#', arg: Term): Term => ({ kind: 'unop', op, arg, span: SPAN0 }),
  bin: (op: BinOp, left: Term, right: Term): Term => ({ kind: 'binop', op, left, right, span: SPAN0 }),
  display: (elems: Term[]): Term => (elems.length ? { kind: 'setDisplay', elems, span: SPAN0 } : mk.empty()),
  rel: (op: RelOp, left: Term, right: Term): Term => ({ kind: 'rel', op, left, right, span: SPAN0 }),
};

export const isEmptySet = (t: Term): boolean => t.kind === 'emptyset' || (t.kind === 'setDisplay' && t.elems.length === 0);

/** `a ↦ b` or `(a, b)` → [a, b]. */
export function pairParts(t: Term): [Term, Term] | null {
  if (t.kind === 'binop' && t.op === '↦') return [t.left, t.right];
  if (t.kind === 'tuple' && t.elems.length === 2) return [t.elems[0], t.elems[1]];
  return null;
}

// ── normalised key ─────────────────────────────────────────────────────────────

/** Operators whose operands are compared as a set (assoc., comm., idempotent). */
const ACI = new Set(['∪', '∩', '∧', '∨']);
/** Associative and commutative, but not idempotent. */
const AC = new Set(['+', '*']);

const FLIP: Partial<Record<RelOp, RelOp>> = { '>': '<', '≥': '≤' };
const NEGATE: Partial<Record<string, string>> = { '=': '≠', '≠': '=', '∈': '∉', '∉': '∈' };

/**
 * A string that is equal for two terms iff they are equal modulo the normalisation
 * (see the file comment). Sound: equal keys always mean logically equal terms.
 */
export function key(t: Term): string {
  return k(t, new Map(), 0);
}

function flatten(t: Term, op: string, out: Term[] = []): Term[] {
  if ((t.kind === 'binop' || t.kind === 'logic') && t.op === op) {
    flatten(t.left, op, out);
    flatten(t.right, op, out);
  } else out.push(t);
  return out;
}

const sortUniq = (xs: string[]) => [...new Set(xs)].sort();

function k(t: Term, b: ReadonlyMap<string, string>, depth: number): string {
  const r = (x: Term) => k(x, b, depth);
  switch (t.kind) {
    case 'name':
      return b.get(t.name) ?? t.name;
    case 'num':
      return String(t.value);
    case 'builtinSet':
      return t.set;
    case 'bool':
      return t.value ? 'true' : 'false';
    case 'emptyset':
      return '∅';
    case 'setDisplay':
      return t.elems.length === 0 ? '∅' : `{${sortUniq(t.elems.map(r)).join(',')}}`;
    case 'tuple':
      return `(${t.elems.map(r).join(',')})`;
    case 'cross':
      return `×(${t.elems.map(r).join(',')})`;
    case 'apply':
      return `${r(t.fn)}@(${r(t.arg)})`;
    case 'unop':
      return `${t.op}(${r(t.arg)})`;
    case 'binop':
      if (t.op === '↦') return `(${r(t.left)},${r(t.right)})`;
      if (ACI.has(t.op)) return `${t.op}[${sortUniq(flatten(t, t.op).map(r)).join(',')}]`;
      if (AC.has(t.op)) return `${t.op}[${flatten(t, t.op).map(r).sort().join(',')}]`;
      return `${t.op}(${r(t.left)},${r(t.right)})`;
    case 'rel':
      return relKey(t.op, r(t.left), r(t.right));
    case 'not': {
      const a = t.arg;
      if (a.kind === 'not') return r(a.arg);
      if (a.kind === 'rel' && NEGATE[a.op]) return relKey(NEGATE[a.op] as RelOp, r(a.left), r(a.right));
      return `¬(${r(a)})`;
    }
    case 'logic':
      if (ACI.has(t.op)) return `${t.op}[${sortUniq(flatten(t, t.op).map(r)).join(',')}]`;
      if (t.op === '⇔') return `⇔[${[r(t.left), r(t.right)].sort().join(',')}]`;
      return `⇒(${r(t.left)},${r(t.right)})`;
    case 'quant':
    case 'setComp': {
      // bound variables become their binding depth (independent of their names)
      const inner = new Map(b);
      let d = depth;
      const decls: string[] = [];
      for (const decl of t.decls) {
        for (const n of decl.names) {
          decls.push(k(decl.type, inner, d));
          inner.set(n.name, `#${d++}`);
        }
      }
      const ik = (x: Term) => k(x, inner, d);
      if (t.kind === 'setComp') return `{${decls.join(';')}|${t.pred ? ik(t.pred) : ''}•${t.expr ? ik(t.expr) : ''}}`;
      // ∀ D | P • Q ≡ ∀ D • P ⇒ Q;  ∃ D | P • Q ≡ ∃ D • P ∧ Q
      let body = t.body;
      if (t.pred) body = { kind: 'logic', op: t.q === '∀' ? '⇒' : '∧', left: t.pred, right: t.body, span: SPAN0 };
      return `${t.q}(${decls.join(';')}•${ik(body)})`;
    }
  }
}

function relKey(op: RelOp, l: string, r: string): string {
  const f = FLIP[op];
  if (f) return `${f}(${r},${l})`;
  if (op === '=' || op === '≠') return `${op}(${[l, r].sort().join(',')})`;
  return `${op}(${l},${r})`;
}

export const sameTerm = (a: Term, b: Term) => key(a) === key(b);

// ── predicates ─────────────────────────────────────────────────────────────────

/** Top-level conjuncts of a predicate. */
export function conjuncts(t: Term): Term[] {
  return flatten(t, '∧');
}

/** The relational shape of an atomic predicate (for the prover). */
export type AtomView =
  | { k: 'eq'; a: Term; b: Term }
  | { k: 'mem'; x: Term; s: Term }
  | { k: 'notmem'; x: Term; s: Term }
  | { k: 'sub'; a: Term; b: Term; strict: boolean };

export function view(t: Term): AtomView | null {
  if (t.kind === 'rel') {
    switch (t.op) {
      case '=':
        return { k: 'eq', a: t.left, b: t.right };
      case '∈':
        return { k: 'mem', x: t.left, s: t.right };
      case '∉':
        return { k: 'notmem', x: t.left, s: t.right };
      case '⊆':
      case '⊂':
        return { k: 'sub', a: t.left, b: t.right, strict: t.op === '⊂' };
    }
  }
  if (t.kind === 'not' && t.arg.kind === 'rel') {
    if (t.arg.op === '∈') return { k: 'notmem', x: t.arg.left, s: t.arg.right };
    if (t.arg.op === '∉') return { k: 'mem', x: t.arg.left, s: t.arg.right };
  }
  return null;
}

/** If `t` is `name = e` or `e = name`, return e. */
export function eqSide(t: Term, name: string): Term | null {
  if (t.kind !== 'rel' || t.op !== '=') return null;
  if (t.left.kind === 'name' && t.left.name === name) return t.right;
  if (t.right.kind === 'name' && t.right.name === name) return t.left;
  return null;
}

// ── occurrences ────────────────────────────────────────────────────────────────

/** Does any free name of `t` belong to `names`? */
export function mentions(t: Term, names: ReadonlySet<string>): boolean {
  for (const n of freeVars(t)) if (names.has(n)) return true;
  return false;
}

/**
 * Replace every occurrence of a sub-term with key `target` by `repl` (not below
 * binders, so no variable can be captured). Null if there is no occurrence.
 */
export function replaceSub(t: Term, target: string, repl: Term): Term | null {
  let hit = false;
  const out = mapTerm(t, (x) => {
    if (key(x) === target) {
      hit = true;
      return repl;
    }
    if (x.kind === 'quant' || x.kind === 'setComp') return x;
    return undefined;
  });
  return hit ? out : null;
}

/** Does `t` contain a sub-term with key `target` (anywhere)? */
export function containsKey(t: Term, target: string): boolean {
  if (key(t) === target) return true;
  return children(t).some((c) => containsKey(c, target));
}
