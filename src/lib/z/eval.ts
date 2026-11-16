// Evaluator for well-typed terms over a finite example universe.
//
// Given sets are the finite example carriers of a `Universe`. ℕ, ℤ, ℝ, ℙ S, X ⇸ Y, …
// evaluate to lazy sets: membership is exact (e.g. 5000 ∈ ℕ₁, 2.5 ∉ ℕ, 2.5 ∈ ℝ), but
// whenever such a set must be *listed* (∀ n : ℕ, { n : ℕ | … }) integers are bounded
// by [intMin, intMax] and enumeration gives up beyond `enumLimit` elements. ℝ can
// never be listed (a 'too-large' EvalError).
//
// Numbers are normalised to 15 significant digits when created (see `int` in
// values.ts), so 0.1 + 0.2 = 0.3 holds and equal-looking numbers are equal.
//
// Logical connectives short-circuit (left to right), so `x ∈ dom f ⇒ f(x) = y` never
// evaluates the undefined `f(x)`. Undefined applications throw an EvalError.

import type { Span, Term, VarDecl } from './ast';
import { printTerm } from './print';
import {
  EMPTY,
  atom,
  formatNumber,
  compareValues,
  int,
  isPair,
  isSetLike,
  lazy,
  mkSet,
  pair,
  printValue,
  tuple,
  valueEquals,
  valueKey,
  type LazyDesc,
  type SetLike,
  type SetValue,
  type Value,
} from './values';

export interface Universe {
  /** Example elements of each given set. */
  carriers: Record<string, Value[]>;
  /** Integer bounds used whenever ℕ / ℤ must be enumerated (quantifiers, comprehensions). */
  intMin: number;
  intMax: number;
  /** Maximum number of elements a set may have to be enumerated (default 5000). */
  enumLimit?: number;
}

export type Env = ReadonlyMap<string, Value>;

export class EvalError extends Error {
  constructor(
    message: string,
    /** Source span of the offending term (in its section). */
    readonly span: Span,
    /** 'undefined': partial function applied outside its domain; 'too-large': enumeration limit. */
    readonly reason: 'undefined' | 'too-large' | 'error' = 'error',
  ) {
    super(message);
    this.name = 'EvalError';
  }
}

const DEFAULT_LIMIT = 5000;

/** Build a universe from value pools: {BOOK: ['Dune', 'Emma']} → atoms with pool order. */
export function makeUniverse(
  pools: Record<string, readonly string[]>,
  opts: { intMin?: number; intMax?: number; enumLimit?: number } = {},
): Universe {
  const carriers: Record<string, Value[]> = {};
  for (const [set, names] of Object.entries(pools)) carriers[set] = names.map((n, i) => atom(set, n, i));
  return { carriers, intMin: opts.intMin ?? -10, intMax: opts.intMax ?? 10, enumLimit: opts.enumLimit };
}

// ── per-universe context ───────────────────────────────────────────────────────

interface Ctx {
  u: Universe;
  limit: number;
  carrierSets: Map<string, SetValue>;
}
const ctxCache = new WeakMap<Universe, Ctx>();
function ctxOf(u: Universe): Ctx {
  let c = ctxCache.get(u);
  if (!c) {
    c = { u, limit: u.enumLimit ?? DEFAULT_LIMIT, carrierSets: new Map() };
    ctxCache.set(u, c);
  }
  return c;
}
function carrier(name: string, c: Ctx): SetValue | undefined {
  let s = c.carrierSets.get(name);
  if (!s && Object.prototype.hasOwnProperty.call(c.u.carriers, name)) {
    s = mkSet(c.u.carriers[name]);
    c.carrierSets.set(name, s);
  }
  return s;
}

// ── public API ─────────────────────────────────────────────────────────────────

/** Evaluate an expression. Throws EvalError (e.g. for undefined function applications). */
export function evalTerm(t: Term, env: Env, u: Universe): Value {
  return ev(t, env, ctxOf(u));
}

/** Evaluate a predicate. Throws EvalError if a needed sub-term is undefined. */
export function evalPred(t: Term, env: Env, u: Universe): boolean {
  return pred(t, env, ctxOf(u));
}

/** Is `v` an element of the (possibly lazy) set `s`? Exact, also for ℕ, ℙ S, X ⇸ Y, … */
export function memberOf(v: Value, s: SetLike, u: Universe): boolean {
  return member(v, s, ctxOf(u));
}

/**
 * List the elements of a set, with ℕ / ℤ bounded by the universe. Returns null if
 * there are more than `limit` elements (default: the universe's enumLimit).
 */
export function enumerateSet(s: SetLike, u: Universe, limit?: number): Value[] | null {
  const c = ctxOf(u);
  return enumerate(s, limit === undefined ? c : { ...c, limit }, true);
}

/**
 * Check a value against a declared set, e.g. that a value for `borrower` is a
 * partial function BOOK ⇸ MEMBER, or that `dose?` is in ℕ₁.
 */
export function memberOfDeclared(v: Value, declaredSet: Term, env: Env, u: Universe): boolean {
  const c = ctxOf(u);
  return member(v, asSetLike(ev(declaredSet, env, c), declaredSet), c);
}

/**
 * All members of a declared set (ℕ / ℤ bounded by the universe), e.g. all candidates
 * for an input `book? : BOOK`. Returns null if there are too many.
 */
export function enumerateDeclared(declaredSet: Term, env: Env, u: Universe, limit?: number): Value[] | null {
  const c = ctxOf(u);
  const s = asSetLike(ev(declaredSet, env, c), declaredSet);
  return enumerate(s, limit === undefined ? c : { ...c, limit }, true);
}

/** Exact equality of values, materialising lazy sets where possible. */
export function equalValues(a: Value, b: Value, u: Universe): boolean {
  return equal(a, b, ctxOf(u));
}

// ── expressions ────────────────────────────────────────────────────────────────

function ev(t: Term, env: Env, c: Ctx): Value {
  switch (t.kind) {
    case 'name': {
      const v = env.get(t.name);
      if (v) return v;
      const s = carrier(t.name, c);
      if (s) return s;
      throw new EvalError(`No value for ${q(t.name)}`, t.span);
    }
    case 'num':
      return int(t.value);
    case 'builtinSet':
      return lazy({ kind: t.set === 'ℕ' ? 'nat' : t.set === 'ℕ₁' ? 'nat1' : t.set === 'ℝ' ? 'real' : 'int' });
    case 'emptyset':
      return EMPTY;
    case 'setDisplay':
      return mkSet(t.elems.map((e) => ev(e, env, c)));
    case 'setComp': {
      const out: Value[] = [];
      const names = t.decls.flatMap((d) => d.names.map((n) => n.name));
      for (const env2 of bindings(t.decls, env, c, t)) {
        if (t.pred && !pred(t.pred, env2, c)) continue;
        if (t.expr) out.push(ev(t.expr, env2, c));
        else out.push(names.length === 1 ? env2.get(names[0])! : tuple(names.map((n) => env2.get(n)!)));
      }
      return mkSet(out);
    }
    case 'tuple':
      return tuple(t.elems.map((e) => ev(e, env, c)));
    case 'cross': {
      const sets = t.elems.map((e) => asSetLike(ev(e, env, c), e));
      return smallOrLazy({ kind: 'cross', sets }, c);
    }
    case 'apply':
      return applyFn(t, ev(t.fn, env, c), ev(t.arg, env, c), c);
    case 'unop': {
      const v = ev(t.arg, env, c);
      switch (t.op) {
        case 'dom':
        case 'ran': {
          const i = t.op === 'dom' ? 0 : 1;
          return mkSet(pairsOf(finite(v, t.arg, c), t.arg).map((p) => p.elems[i]));
        }
        case 'ℙ':
          return lazy({ kind: 'power', base: asSetLike(v, t.arg) });
        case '#':
          return int(finite(v, t.arg, c).elems.length);
        case 'neg':
          return int(-asInt(v, t.arg));
      }
      break;
    }
    case 'binop':
      return evBinop(t, env, c);
    default:
      throw new EvalError(`${q(printTerm(t))} is a predicate, not a value`, t.span);
  }
  throw new EvalError(`Cannot evaluate ${q(printTerm(t as Term))}`, (t as Term).span);
}

function evBinop(t: Extract<Term, { kind: 'binop' }>, env: Env, c: Ctx): Value {
  const l = ev(t.left, env, c);
  const r = ev(t.right, env, c);
  switch (t.op) {
    case '↦':
      return pair(l, r);
    case '↔':
      return lazy({ kind: 'rel', from: asSetLike(l, t.left), to: asSetLike(r, t.right) });
    case '⇸':
      return lazy({ kind: 'pfun', from: asSetLike(l, t.left), to: asSetLike(r, t.right) });
    case '→':
      return lazy({ kind: 'tfun', from: asSetLike(l, t.left), to: asSetLike(r, t.right) });
    case '∪':
      return mkSet([...finite(l, t.left, c).elems, ...finite(r, t.right, c).elems]);
    case '∩': {
      const ls = asSetLike(l, t.left);
      const rs = asSetLike(r, t.right);
      if (ls.k === 'set') return mkSet(ls.elems.filter((e) => member(e, rs, c)));
      if (rs.k === 'set') return mkSet(rs.elems.filter((e) => member(e, ls, c)));
      return mkSet(finite(l, t.left, c).elems.filter((e) => member(e, rs, c)));
    }
    case '∖': {
      const rs = asSetLike(r, t.right);
      return mkSet(finite(l, t.left, c).elems.filter((e) => !member(e, rs, c)));
    }
    case '+':
      return int(asInt(l, t.left) + asInt(r, t.right));
    case '-':
      return int(asInt(l, t.left) - asInt(r, t.right));
    case '*':
      return int(asInt(l, t.left) * asInt(r, t.right));
    case 'div':
    case 'mod': {
      const a = asInt(l, t.left);
      const b = asInt(r, t.right);
      for (const [n, side] of [[a, t.left], [b, t.right]] as [number, Term][]) {
        if (Number.isInteger(n)) continue;
        const what = side.kind === 'num' ? `${formatNumber(n)} is not one` : `${q(printTerm(side))} is ${formatNumber(n)}`;
        throw new EvalError(`${t.op} works on whole numbers, but ${what}`, t.span);
      }
      if (b === 0) throw new EvalError(`${q(printTerm(t))} is undefined: division by zero`, t.span, 'undefined');
      const d = Math.floor(a / b); // Z: a div b rounds down, a mod b = a - b * (a div b)
      return int(t.op === 'div' ? d : a - b * d);
    }
    case '..':
      // the whole numbers from lo to hi
      return smallOrLazy({ kind: 'range', lo: Math.ceil(asInt(l, t.left)), hi: Math.floor(asInt(r, t.right)) }, c);
  }
}

/** f(x): the unique y with (x, y) ∈ f. */
function applyFn(t: Extract<Term, { kind: 'apply' }>, f: Value, x: Value, c: Ctx): Value {
  const fs = finite(f, t.fn, c);
  const results = functionIndex(fs, t.fn).get(valueKey(x)) ?? [];
  const fnText = t.fn.kind === 'name' || t.fn.kind === 'apply' ? printTerm(t.fn) : `(${printTerm(t.fn)})`;
  const call = `${fnText}(${printValue(x)})`;
  if (results.length === 0) {
    const dom = printTerm({ kind: 'unop', op: 'dom', arg: t.fn, span: t.fn.span });
    throw new EvalError(`${call} is undefined: ${printValue(x)} ∉ ${dom}`, t.span, 'undefined');
  }
  if (results.length > 1) {
    const vals = results.map(printValue).join(', ');
    throw new EvalError(`${call} is undefined: ${fnText} relates ${printValue(x)} to several values (${vals})`, t.span, 'undefined');
  }
  return results[0];
}

const fnIndexCache = new WeakMap<SetValue, Map<string, Value[]>>();
function functionIndex(s: SetValue, at: Term): Map<string, Value[]> {
  let idx = fnIndexCache.get(s);
  if (!idx) {
    idx = new Map();
    for (const p of pairsOf(s, at)) {
      const k = valueKey(p.elems[0]);
      const list = idx.get(k);
      if (list) list.push(p.elems[1]);
      else idx.set(k, [p.elems[1]]);
    }
    fnIndexCache.set(s, idx);
  }
  return idx;
}

// ── predicates ─────────────────────────────────────────────────────────────────

function pred(t: Term, env: Env, c: Ctx): boolean {
  switch (t.kind) {
    case 'bool':
      return t.value;
    case 'not':
      return !pred(t.arg, env, c);
    case 'logic':
      switch (t.op) {
        case '∧':
          return pred(t.left, env, c) && pred(t.right, env, c);
        case '∨':
          return pred(t.left, env, c) || pred(t.right, env, c);
        case '⇒':
          return !pred(t.left, env, c) || pred(t.right, env, c);
        case '⇔':
          return pred(t.left, env, c) === pred(t.right, env, c);
      }
      break;
    case 'quant': {
      for (const env2 of bindings(t.decls, env, c, t)) {
        if (t.pred && !pred(t.pred, env2, c)) continue;
        const b = pred(t.body, env2, c);
        if (t.q === '∀' && !b) return false;
        if (t.q === '∃' && b) return true;
      }
      return t.q === '∀';
    }
    case 'rel': {
      const l = ev(t.left, env, c);
      const r = ev(t.right, env, c);
      switch (t.op) {
        case '=':
          return equal(l, r, c);
        case '≠':
          return !equal(l, r, c);
        case '∈':
          return member(l, asSetLike(r, t.right), c);
        case '∉':
          return !member(l, asSetLike(r, t.right), c);
        case '⊆':
          return subset(l, r, t, c);
        case '⊂':
          return subset(l, r, t, c) && !equal(l, r, c);
        case '<':
          return asInt(l, t.left) < asInt(r, t.right);
        case '≤':
          return asInt(l, t.left) <= asInt(r, t.right);
        case '>':
          return asInt(l, t.left) > asInt(r, t.right);
        case '≥':
          return asInt(l, t.left) >= asInt(r, t.right);
      }
      break;
    }
    default:
      throw new EvalError(`${q(printTerm(t))} is a value, not a predicate`, t.span);
  }
  throw new EvalError(`Cannot evaluate ${q(printTerm(t as Term))}`, (t as Term).span);
}

function subset(l: Value, r: Value, t: Extract<Term, { kind: 'rel' }>, c: Ctx): boolean {
  const rs = asSetLike(r, t.right);
  if (l.k === 'lazy' && rs.k === 'lazy') {
    // ℕ₁ ⊆ ℕ ⊆ ℤ ⊆ ℝ, and large ranges inside them
    const rank: Record<string, number> = { nat1: 1, nat: 2, int: 3, real: 4 };
    const ld = l.desc;
    if (valueEquals(l, rs)) return true;
    if (ld.kind in rank && rs.desc.kind in rank) return rank[ld.kind] <= rank[rs.desc.kind];
    if (ld.kind === 'range' && (rs.desc.kind in rank || rs.desc.kind === 'range')) {
      return ld.lo > ld.hi || (member(int(ld.lo), rs, c) && member(int(ld.hi), rs, c));
    }
  }
  return finite(l, t.left, c).elems.every((e) => member(e, rs, c));
}

/** All environments for `x : S; y : T` (sequential: T may depend on x). */
function* bindings(decls: VarDecl[], env: Env, c: Ctx, at: Term): Generator<Env> {
  const names = decls.flatMap((d) => d.names.map((n) => ({ name: n.name, decl: d })));
  function* go(i: number, cur: Map<string, Value>): Generator<Env> {
    if (i === names.length) {
      yield cur;
      return;
    }
    const { name, decl } = names[i];
    const s = asSetLike(ev(decl.type, cur, c), decl.type);
    const elems = enumerate(s, c, true);
    if (!elems) {
      const msg = involvesReal(s)
        ? `Cannot try every value of ${q(printTerm(decl.type))}: real numbers (ℝ) cannot be listed one by one`
        : `Too many values to check in ${q(printTerm(decl.type))}`;
      throw new EvalError(msg, at.span, 'too-large');
    }
    for (const v of elems) {
      const next = new Map(cur);
      next.set(name, v);
      yield* go(i + 1, next);
    }
  }
  yield* go(0, new Map(env));
}

// ── sets ───────────────────────────────────────────────────────────────────────

function member(v: Value, s: SetLike, c: Ctx): boolean {
  if (s.k === 'set') return s.index.has(valueKey(v));
  const d = s.desc;
  switch (d.kind) {
    case 'nat':
      return v.k === 'int' && Number.isInteger(v.v) && v.v >= 0;
    case 'nat1':
      return v.k === 'int' && Number.isInteger(v.v) && v.v >= 1;
    case 'int':
      return v.k === 'int' && Number.isInteger(v.v);
    case 'real':
      return v.k === 'int' && Number.isFinite(v.v);
    case 'range':
      return v.k === 'int' && Number.isInteger(v.v) && v.v >= d.lo && v.v <= d.hi;
    case 'cross':
      return v.k === 'tuple' && v.elems.length === d.sets.length && v.elems.every((e, i) => member(e, d.sets[i], c));
    case 'power': {
      const fs = v.k === 'set' ? v : v.k === 'lazy' ? exactFinite(v, c) : null;
      return !!fs && fs.elems.every((e) => member(e, d.base, c));
    }
    case 'rel':
    case 'pfun':
    case 'tfun': {
      const fs = v.k === 'set' ? v : v.k === 'lazy' ? exactFinite(v, c) : null;
      if (!fs) return false;
      const seen = new Map<string, string>();
      for (const e of fs.elems) {
        if (!isPair(e) || !member(e.elems[0], d.from, c) || !member(e.elems[1], d.to, c)) return false;
        if (d.kind !== 'rel') {
          const k = valueKey(e.elems[0]);
          const y = valueKey(e.elems[1]);
          if (seen.has(k) && seen.get(k) !== y) return false; // not functional
          seen.set(k, y);
        }
      }
      if (d.kind === 'tfun') {
        const dom = d.from.k === 'set' ? d.from : exactFinite(d.from, c);
        if (!dom) return false; // a finite function cannot be total on an infinite set
        return dom.elems.every((x) => seen.has(valueKey(x)));
      }
      return true;
    }
  }
}

function equal(a: Value, b: Value, c: Ctx): boolean {
  if (a.k !== 'lazy' && b.k !== 'lazy') return valueEquals(a, b);
  if (a.k === 'lazy' && b.k === 'lazy' && valueEquals(a, b)) return true;
  const fa = a.k === 'lazy' ? exactFinite(a, c) : a;
  const fb = b.k === 'lazy' ? exactFinite(b, c) : b;
  if (!fa || !fb) return false; // an infinite set never equals a finite one
  return valueEquals(fa, fb);
}

/** Lazy set → finite set if it is finite and small enough, else null. */
function exactFinite(s: SetLike, c: Ctx): SetValue | null {
  if (s.k === 'set') return s;
  const elems = enumerate(s, c, false);
  return elems ? mkSet(elems) : null;
}

/** Materialise small finite sets right away; keep large ones lazy. */
function smallOrLazy(desc: LazyDesc, c: Ctx): Value {
  const l = lazy(desc);
  return exactFinite(l, c) ?? l;
}

/**
 * List the elements of a set. With `boundedInts`, ℕ / ℕ₁ / ℤ are cut to the
 * universe's [intMin, intMax]; otherwise they count as infinite (→ null).
 * ℝ can never be listed. Returns null if the set has more than `c.limit` elements.
 */
function enumerate(s: SetLike, c: Ctx, boundedInts: boolean): Value[] | null {
  if (s.k === 'set') return s.elems.length <= c.limit ? [...s.elems] : null;
  const d = s.desc;
  const { intMin, intMax } = c.u;
  const sub = (x: SetLike) => enumerate(x, c, boundedInts);
  switch (d.kind) {
    case 'nat':
      return boundedInts ? intRange(Math.max(0, intMin), intMax, c) : null;
    case 'nat1':
      return boundedInts ? intRange(Math.max(1, intMin), intMax, c) : null;
    case 'int':
      return boundedInts ? intRange(intMin, intMax, c) : null;
    case 'real':
      return null;
    case 'range':
      return intRange(d.lo, d.hi, c);
    case 'cross': {
      const parts = d.sets.map(sub);
      if (parts.some((p) => p === null)) return null;
      return cartesian(parts as Value[][], c)?.map((es) => tuple(es)) ?? null;
    }
    case 'power': {
      const base = sub(d.base);
      if (!base || Math.pow(2, base.length) > c.limit) return null;
      return subsets(base).map(mkSet);
    }
    case 'rel': {
      const xs = sub(d.from);
      const ys = sub(d.to);
      if (!xs || !ys) return null;
      const pairs = cartesian([xs, ys], c);
      if (!pairs || Math.pow(2, pairs.length) > c.limit) return null;
      return subsets(pairs.map((p) => tuple(p))).map(mkSet);
    }
    case 'pfun':
    case 'tfun': {
      const xs = sub(d.from);
      const ys = sub(d.to);
      if (!xs || !ys) return null;
      const choices = d.kind === 'pfun' ? ys.length + 1 : ys.length; // pfun: also "undefined"
      if (Math.pow(choices, xs.length) > c.limit) return null;
      let fns: Value[][] = [[]];
      for (const x of xs) {
        const next: Value[][] = [];
        for (const f of fns) {
          if (d.kind === 'pfun') next.push(f);
          for (const y of ys) next.push([...f, pair(x, y)]);
        }
        fns = next;
      }
      return fns.map(mkSet);
    }
  }
}

function intRange(lo: number, hi: number, c: Ctx): Value[] | null {
  if (hi < lo) return [];
  if (hi - lo + 1 > c.limit) return null;
  const out: Value[] = [];
  for (let i = lo; i <= hi; i++) out.push(int(i));
  return out;
}

function cartesian(parts: Value[][], c: Ctx): Value[][] | null {
  const size = parts.reduce((n, p) => n * p.length, 1);
  if (size > c.limit) return null;
  let acc: Value[][] = [[]];
  for (const p of parts) acc = acc.flatMap((prefix) => p.map((v) => [...prefix, v]));
  return acc;
}

/** All subsets, smallest first. */
function subsets(elems: Value[]): Value[][] {
  let acc: Value[][] = [[]];
  for (const e of elems) acc = [...acc, ...acc.map((s) => [...s, e])];
  return acc.sort((a, b) => a.length - b.length);
}

// ── coercions with student-readable errors ─────────────────────────────────────

const q = (s: string) => `‘${s}’`;

function asInt(v: Value, at: Term): number {
  if (v.k !== 'int') throw new EvalError(`${q(printTerm(at))} is not a number`, at.span);
  return v.v;
}

function asSetLike(v: Value, at: Term): SetLike {
  if (!isSetLike(v)) throw new EvalError(`${q(printTerm(at))} is not a set`, at.span);
  return v;
}

/** A finite set, materialising lazy sets when possible. */
function finite(v: Value, at: Term, c: Ctx): SetValue {
  const s = asSetLike(v, at);
  if (s.k === 'set') return s;
  const f = exactFinite(s, c);
  if (!f) {
    const msg = involvesReal(s)
      ? `${q(printTerm(at))} cannot be listed — there are infinitely many real numbers`
      : `${q(printTerm(at))} is too large to compute with`;
    throw new EvalError(msg, at.span, 'too-large');
  }
  return f;
}

/** Does a lazy set involve ℝ (so it can never be listed)? */
function involvesReal(s: SetLike): boolean {
  if (s.k === 'set') return false;
  const d = s.desc;
  switch (d.kind) {
    case 'real':
      return true;
    case 'power':
      return involvesReal(d.base);
    case 'rel':
    case 'pfun':
    case 'tfun':
      return involvesReal(d.from) || involvesReal(d.to);
    case 'cross':
      return d.sets.some(involvesReal);
    default:
      return false;
  }
}

function pairsOf(s: SetValue, at: Term): (Value & { k: 'tuple' })[] {
  for (const e of s.elems) {
    if (!isPair(e)) throw new EvalError(`${q(printTerm(at))} is not a relation (its elements are not pairs)`, at.span);
  }
  return s.elems as (Value & { k: 'tuple' })[];
}

/** Sort helper for callers that build value lists. */
export const sortValues = (vs: Value[]): Value[] => [...vs].sort(compareValues);
