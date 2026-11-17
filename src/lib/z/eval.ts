// Evaluator for well-typed terms over a finite example universe.
//
// Given sets are the finite example carriers of a `Universe`. ℕ, ℤ, ℙ S, X ⇸ Y, …
// evaluate to lazy sets: membership is exact (e.g. 5000 ∈ ℕ₁).
//
// Infinite sets and honest verdicts. When ℕ or ℤ must be *listed* (∀ n : ℕ,
// { n : ℕ | … }) only a window [intMin, intMax] plus a few "probe" numbers beyond it
// can be tried. A verdict that depended on such a cut-off is *bounded*
// (`evalPredChecked` reports it), unless a concrete witness decides it exactly:
// ∀ n ∈ ℕ . n < 50 is exactly false because the probe 100 is a counterexample.
// A comprehension over ℕ becomes an `approx` set that knows some of its elements and
// can test membership, so a finite set never wrongly equals {n : ℕ | n > 0}.
//
// Given sets that are infinite in principle (`Universe.infinite`) are checked
// exactly: example values only ever use the carrier's atoms, so all other elements
// behave alike, and one generic atom ("another DATE") stands for all of them. (A total
// function on such a set can only be shown on the example elements; where that
// matters the verdict is bounded.)
//
// Logical connectives short-circuit (left to right), so `x ∈ dom f ⇒ f(x) = y` never
// evaluates the undefined `f(x)`. Undefined applications throw an EvalError.

import type { Span, Term, VarDecl } from './ast';
import { spend } from './gen/clock';
import { freeVars, printTerm } from './print';
import {
  EMPTY,
  atom,
  compareValues,
  containsFresh,
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
  type AtomValue,
  type LazyDesc,
  type LazySetValue,
  type SetLike,
  type SetValue,
  type TupleValue,
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
  /** Work limit of one quantifier / comprehension in term nodes (default 10000, see DEFAULT_WORK). */
  workLimit?: number;
  /** Given sets that are infinite in principle: their carrier is only an example. */
  infinite?: readonly string[];
  /** Extra numbers to try beyond [intMin, intMax] (e.g. the constants of the spec). */
  probes?: readonly number[];
}

export type Env = ReadonlyMap<string, Value>;

export class EvalError extends Error {
  /** Source span of the offending term (in its section). */
  readonly span: Span;
  /** 'undefined': partial function applied outside its domain; 'too-large': enumeration limit. */
  readonly reason: 'undefined' | 'too-large' | 'error';
  private text: string | (() => string);
  private generalText: string | (() => string) | undefined;

  /**
   * `message` may be a function: it is only computed when read. `general`: the same
   * without the values, in terms of the spec (`cleared(a₁) is undefined when a₁ ∉ dom cleared`).
   */
  constructor(
    message: string | (() => string),
    span: Span,
    reason: 'undefined' | 'too-large' | 'error' = 'error',
    general?: string | (() => string),
  ) {
    // The searches throw (and catch) these all the time, e.g. for f(x) with x ∉ dom f:
    // no stack trace, which would cost far more than the evaluation itself.
    const E = Error as { stackTraceLimit?: number };
    const limit = E.stackTraceLimit;
    E.stackTraceLimit = 0;
    super();
    E.stackTraceLimit = limit;
    this.name = 'EvalError';
    this.span = span;
    this.reason = reason;
    this.text = message;
    this.generalText = general;
  }

  override get message(): string {
    if (typeof this.text === 'function') this.text = this.text();
    return this.text;
  }

  /** The reason in terms of the spec, if there is one (see the constructor). */
  get general(): string | undefined {
    if (typeof this.generalText === 'function') this.generalText = this.generalText();
    return this.generalText;
  }
}

/** A result and whether it relied on cutting off an infinite set. */
export interface Checked<T> {
  value: T;
  bounded: boolean;
}

const DEFAULT_LIMIT = 5000;
/**
 * Work limit of one quantifier or set comprehension (with everything nested in it), in
 * evaluated term nodes (set operations count their elements too). Each variable may
 * take up to `enumLimit` values, but not their product: `∀ a, b, c ∈ ℙ X` would have to
 * try 16 million bindings for 8 values in X.
 * When the limit is hit, the bindings not tried yet are cut off (a bounded verdict).
 */
const DEFAULT_WORK = 10000;
/** Numbers beyond the window that are always tried when ℕ / ℤ are listed. */
const PROBES = [50, 100, 1000, 1000000];

/** Build a universe from value pools: {BOOK: ['Dune', 'Emma']} → atoms with pool order. */
export function makeUniverse(
  pools: Record<string, readonly string[]>,
  opts: { intMin?: number; intMax?: number; enumLimit?: number; workLimit?: number; infinite?: readonly string[]; probes?: readonly number[] } = {},
): Universe {
  const carriers: Record<string, Value[]> = {};
  for (const [set, names] of Object.entries(pools)) carriers[set] = names.map((n, i) => atom(set, n, i));
  return {
    carriers,
    intMin: opts.intMin ?? -10,
    intMax: opts.intMax ?? 10,
    enumLimit: opts.enumLimit,
    workLimit: opts.workLimit,
    infinite: opts.infinite,
    probes: opts.probes,
  };
}

// ── per-universe context ───────────────────────────────────────────────────────

interface Base {
  u: Universe;
  limit: number;
  work: number;
  carrierSets: Map<string, SetLike>;
}
interface Ctx extends Base {
  /** Set when a result relied on cutting off an infinite set. */
  track: { bounded: boolean };
  /** Work left (term nodes) for the outermost quantifier / comprehension being evaluated. */
  budget: { left: number } | null;
}
const baseCache = new WeakMap<Universe, Base>();
function ctxOf(u: Universe): Ctx {
  let b = baseCache.get(u);
  if (!b) {
    b = { u, limit: u.enumLimit ?? DEFAULT_LIMIT, work: u.workLimit ?? DEFAULT_WORK, carrierSets: new Map() };
    baseCache.set(u, b);
  }
  return { ...b, track: { bounded: false }, budget: null };
}
function carrier(name: string, c: Ctx): SetLike | undefined {
  let s = c.carrierSets.get(name);
  if (!s && Object.prototype.hasOwnProperty.call(c.u.carriers, name)) {
    const sample = mkSet(c.u.carriers[name]);
    s = c.u.infinite?.includes(name) ? lazy({ kind: 'given', set: name, sample }) : sample;
    c.carrierSets.set(name, s);
  }
  return s;
}

/** Run `f` with its own bounded flag; returns the result and that flag (the caller decides). */
function tracked<T>(c: Ctx, f: () => T): [T, boolean] {
  const saved = c.track.bounded;
  c.track.bounded = false;
  try {
    const v = f();
    return [v, c.track.bounded];
  } finally {
    c.track.bounded = saved;
  }
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

/** Evaluate a predicate and say whether the verdict relied on cutting off an infinite set. */
export function evalPredChecked(t: Term, env: Env, u: Universe): Checked<boolean> {
  const c = ctxOf(u);
  const value = pred(t, env, c);
  return { value, bounded: c.track.bounded };
}

/** Evaluate an expression and say whether the value relied on cutting off an infinite set. */
export function evalTermChecked(t: Term, env: Env, u: Universe): Checked<Value> {
  const c = ctxOf(u);
  const value = ev(t, env, c);
  return { value, bounded: c.track.bounded };
}

/** Is `v` an element of the (possibly lazy) set `s`? Exact, also for ℕ, ℙ S, X ⇸ Y, … */
export function memberOf(v: Value, s: SetLike, u: Universe): boolean {
  if (s.k === 'set' && v.k !== 'lazy') {
    spend();
    return s.index.has(valueKey(v)); // (the searches test a lot of these)
  }
  return member(v, s, ctxOf(u));
}

/**
 * List the elements of a set, with ℕ / ℤ bounded by the universe (and infinite given
 * sets cut to their example carrier). Returns null if there are more than `limit`
 * elements (default: the universe's enumLimit).
 */
export function enumerateSet(s: SetLike, u: Universe, limit?: number): Value[] | null {
  const c = ctxOf(u);
  return enumerate(s, limit === undefined ? c : { ...c, limit }, true);
}

/**
 * The values a quantifier `∀ x : s` tries, exactly as the evaluator does: for ℕ / ℤ
 * the window plus probe numbers (`probe` marks values beyond the window, whose
 * evaluation errors are ignored), for an infinite given set its carrier plus generic
 * atoms. `cut`: the list is not complete. Null if there are too many values.
 */
export function bindingValues(s: SetLike, env: Env, u: Universe): { values: Value[]; probe: boolean[]; cut: boolean } | null {
  const L = listFor(s, ctxOf(u), env);
  return L && { values: L.items.map((i) => i.v), probe: L.items.map((i) => i.probe), cut: L.cut };
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
 * All members of a declared set (ℕ / ℤ bounded by the universe, infinite given sets
 * by their carrier), e.g. all candidates for an input `book? : BOOK`. Returns null if
 * there are too many.
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

/** Is the set infinite? null if unknown (a comprehension over ℕ that may be finite). */
export function isInfiniteSet(s: SetLike, u: Universe): boolean | null {
  return infiniteSet(s, ctxOf(u));
}

// ── expressions ────────────────────────────────────────────────────────────────

/** Count `n` units of work (the work clock and the limit of the current quantifier). */
function charge(c: Ctx, n: number): void {
  spend(n);
  if (c.budget) c.budget.left -= n;
}

function ev(t: Term, env: Env, c: Ctx): Value {
  charge(c, 1);
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
      return lazy({ kind: t.set === 'ℕ' ? 'nat' : t.set === 'ℕ₁' ? 'nat1' : 'int' });
    case 'emptyset':
      return EMPTY;
    case 'setDisplay':
      return mkSet(t.elems.map((e) => inner(ev(e, env, c), c)));
    case 'setComp':
      return comprehension(t, env, c);
    case 'tuple':
      return tuple(t.elems.map((e) => inner(ev(e, env, c), c)));
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

let approxIds = 0;
/** Membership tests of approx sets (comprehensions without `. e`). */
const approxMembers = new WeakMap<LazySetValue, (v: Value, c: Ctx) => boolean>();

/** `{ x ∈ S | P . e }`. Over an infinite set the result is an `approx` set. */
function comprehension(t: Extract<Term, { kind: 'setComp' }>, env: Env, c: Ctx): Value {
  const names = t.decls.flatMap((d) => d.names.map((n) => n.name));
  const st: BindState = { cut: false, unsure: false };
  const out: Value[] = [];
  let generic = false; // an element contains a generic atom: there are infinitely many such
  eachBinding(t, env, c, st, (env2, probe, gb) => {
    // (the guards — the conjuncts of the predicate — hold here)
    if (gb) st.unsure = true;
    let v: Value;
    if (t.expr) {
      try {
        const [e, eb] = tracked(c, () => ev(t.expr!, env2, c));
        v = inner(e, c);
        if (eb) st.unsure = true;
      } catch (e) {
        if (probe && e instanceof EvalError) {
          st.unsure = true;
          return false;
        }
        throw e;
      }
    } else v = names.length === 1 ? env2.get(names[0])! : tuple(names.map((n) => env2.get(n)!));
    if (containsFresh(v)) generic = true;
    else out.push(v);
    return false;
  });
  if (st.unsure) c.track.bounded = true;
  if (!st.cut && !generic) return mkSet(out);
  const s = lazy({ kind: 'approx', id: ++approxIds, known: mkSet(out), infinite: generic });
  if (!t.expr) approxMembers.set(s, (v, c2) => compMember(t, env, names, v, c2));
  return s;
}

/** v ∈ { x : S; y : T | P } — exact, without listing anything. */
function compMember(t: Extract<Term, { kind: 'setComp' }>, env: Env, names: string[], v: Value, c: Ctx): boolean {
  const vals = names.length === 1 ? [v] : v.k === 'tuple' && v.elems.length === names.length ? v.elems : null;
  if (!vals) return false;
  const env2 = new Map(env);
  let k = 0;
  for (const d of t.decls) {
    for (const n of d.names) {
      const dom = asSetLike(ev(d.type, env2, c), d.type);
      const x = vals[k++];
      if (!member(x, dom, c)) return false;
      env2.set(n.name, x);
    }
  }
  return !t.pred || pred(t.pred, env2, c);
}

function evBinop(t: Extract<Term, { kind: 'binop' }>, env: Env, c: Ctx): Value {
  const l = ev(t.left, env, c);
  const r = ev(t.right, env, c);
  switch (t.op) {
    case '↦':
      return pair(inner(l, c), inner(r, c));
    case '↔':
      return lazy({ kind: 'rel', from: asSetLike(l, t.left), to: asSetLike(r, t.right) });
    case '⇸':
      return lazy({ kind: 'pfun', from: asSetLike(l, t.left), to: asSetLike(r, t.right) });
    case '→':
      return lazy({ kind: 'tfun', from: asSetLike(l, t.left), to: asSetLike(r, t.right) });
    case '∪':
    case '∩':
    case '∖': {
      const ls = asSetLike(l, t.left);
      const rs = asSetLike(r, t.right);
      const fl = exactFinite(ls, c);
      const fr = exactFinite(rs, c);
      if (t.op === '∪' && fl && fr) {
        charge(c, fl.elems.length + fr.elems.length);
        return mkSet([...fl.elems, ...fr.elems]);
      }
      // list a finite side, test membership in the other
      const list = t.op === '∩' ? (fl ?? fr) : t.op === '∖' ? fl : null;
      if (list) {
        charge(c, list.elems.length);
        const other = list === fl ? rs : ls;
        return mkSet(list.elems.filter((e) => member(e, other, c) === (t.op === '∩')));
      }
      // sets that cannot be listed (PATIENT × DRUG, ℕ, …): exact membership only
      return lazy({ kind: 'setop', op: t.op, left: ls, right: rs });
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
      if (b === 0) {
        throw new EvalError(`${q(printTerm(t))} is undefined: division by zero`, t.span, 'undefined', () => `${printTerm(t)} is undefined when ${printTerm(t.right)} = 0`);
      }
      const d = Math.floor(a / b); // Z: a div b rounds down, a mod b = a - b * (a div b)
      return int(t.op === 'div' ? d : a - b * d);
    }
    case '..':
      return smallOrLazy({ kind: 'range', lo: asInt(l, t.left), hi: asInt(r, t.right) }, c);
  }
}

/** f(x): the unique y with (x, y) ∈ f. */
function applyFn(t: Extract<Term, { kind: 'apply' }>, f: Value, x0: Value, c: Ctx): Value {
  const x = inner(x0, c);
  const fs = finite(f, t.fn, c);
  const results = functionIndex(fs, t.fn).get(valueKey(x)) ?? [];
  if (results.length === 1) return results[0];
  // (messages are built only when shown: the searches run into undefined applications often)
  // `cleared(a₁) is undefined: a₁ = DLH4AB ∉ dom cleared` names the argument as written
  // and its value, so that the line it comes from is easy to find
  const fnText = () => (t.fn.kind === 'name' || t.fn.kind === 'apply' ? printTerm(t.fn) : `(${printTerm(t.fn)})`);
  const argText = () => {
    const a = printTerm(t.arg);
    const v = printValue(x);
    return a === v || t.arg.kind === 'num' ? [v, v] : [a, `${a} = ${v}`];
  };
  const call = () => `${fnText()}(${argText()[0]})`;
  const written = () => `${fnText()}(${printTerm(t.arg)})`;
  if (results.length === 0) {
    const dom = () => printTerm({ kind: 'unop', op: 'dom', arg: t.fn, span: t.fn.span });
    throw new EvalError(() => `${call()} is undefined: ${argText()[1]} ∉ ${dom()}`, t.span, 'undefined', () => `${written()} is undefined when ${printTerm(t.arg)} ∉ ${dom()}`);
  }
  const vals = results.map(printValue).join(', ');
  throw new EvalError(
    () => `${call()} is undefined: ${fnText()} relates ${argText()[1]} to several values (${vals})`,
    t.span,
    'undefined',
    () => `${written()} is undefined when ${fnText()} relates ${printTerm(t.arg)} to several values`,
  );
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
  charge(c, 1);
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
    case 'quant':
      return quantifier(t, env, c);
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

/**
 * ∀ / ∃. A counterexample (∀) or witness (∃) whose evaluation did not rely on a
 * cut-off decides exactly; otherwise the verdict is bounded if the listing was cut.
 */
function quantifier(t: Quant, env: Env, c: Ctx): boolean {
  const st: BindState = { cut: false, unsure: false };
  let unsureHit = false;
  let exactHit = false;
  const rest = binderPlan(t).rest;
  eachBinding(t, env, c, st, (env2, probe, gb) => {
    // the guards hold; ∀: the body (or the consequent of `A ⇒ B`) decides; ∃: a witness
    let b = true;
    let bb = false;
    if (rest) {
      try {
        [b, bb] = tracked(c, () => pred(rest, env2, c));
      } catch (e) {
        if (probe && e instanceof EvalError) {
          st.unsure = true;
          return false;
        }
        throw e;
      }
    }
    const hit = t.q === '∀' ? !b : b;
    if (hit && !gb && !bb) return (exactHit = true);
    if (hit) unsureHit = true;
    if (gb || bb) st.unsure = true;
    return false;
  });
  if (exactHit) return t.q === '∃';
  if (unsureHit || st.unsure || st.cut) c.track.bounded = true;
  return unsureHit ? t.q === '∃' : t.q === '∀';
}

// ── bindings of quantifiers and comprehensions ─────────────────────────────────
//
// `∀ D | P . Q` is `∀ D . P ⇒ Q`, `∃ D | P . Q` is `∃ D . P ∧ Q`, `{ D | P . e }`
// collects e where P holds. The conjuncts of P (and of the antecedent A of a body
// `A ⇒ B` for ∀, of the body for ∃) are *guards*: each is evaluated as soon as its
// variables are bound, and a false guard skips all further bindings below. This is
// cheap pruning, and it is also what Z means: `∀ b ∈ BOOK; m ∈ f(b) | b ∈ dom f . …`
// holds whatever f(b) would be for b ∉ dom f, so f(b) is never evaluated there.
// Variables whose declared sets do not mention bound variables are bound in the
// order the guards need them (∀ a, b ∈ NAME; d ∈ DATE | (a ↦ d) ∈ f … binds a, d first).

type Quant = Extract<Term, { kind: 'quant' }>;
type Binder = Quant | Extract<Term, { kind: 'setComp' }>;

interface BindState {
  /** Not all bindings were tried (ℕ / ℤ window, or the work limit). */
  cut: boolean;
  /** Some verdict on the way relied on a cut-off. */
  unsure: boolean;
}

interface BinderPlan {
  names: { name: string; type: Term }[];
  guards: { term: Term; need: number }[];
  /** What a binding that passes the guards still has to satisfy (∀: Q, or B of `A ⇒ B`; ∃ / {…}: nothing). */
  rest: Term | null;
  /** No declared set mentions a bound variable (each is evaluated once). */
  closed: boolean;
}

const planCache = new WeakMap<Binder, BinderPlan>();
const conjOf = (t: Term): Term[] => (t.kind === 'logic' && t.op === '∧' ? [...conjOf(t.left), ...conjOf(t.right)] : [t]);

function binderPlan(t: Binder): BinderPlan {
  let p = planCache.get(t);
  if (p) return p;
  let names = t.decls.flatMap((d: VarDecl) => d.names.map((n) => ({ name: n.name, type: d.type })));
  const terms = t.pred ? conjOf(t.pred) : [];
  let rest: Term | null = null;
  if (t.kind === 'quant' && t.q === '∀') {
    if (t.body.kind === 'logic' && t.body.op === '⇒') {
      terms.push(...conjOf(t.body.left));
      rest = t.body.right;
    } else rest = t.body;
  } else if (t.kind === 'quant') terms.push(...conjOf(t.body));
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
      const i = pos.get(f);
      if (i !== undefined && i > need) need = i;
    }
    return need;
  };
  p = { names, guards: terms.map((term) => ({ term, need: needOf(term) })), rest, closed };
  planCache.set(t, p);
  return p;
}

/**
 * Enumerate the bindings of a quantifier or comprehension that pass its guards and call
 * `leaf(env, probe, guardsBounded)` for each (the env is reused: read it right away);
 * `leaf` returns true to stop. Errors in guards are left to the leaves (a probe number
 * beyond the ℕ / ℤ window may run into them: that is not a verdict).
 */
function eachBinding(
  t: Binder,
  env: Env,
  c: Ctx,
  st: BindState,
  leaf: (env: Env, probe: boolean, gb: boolean) => boolean,
): void {
  const { names, guards, closed } = binderPlan(t);
  const own = !c.budget;
  if (own) c.budget = { left: c.work };
  const budget = c.budget!;
  const cur = new Map(env);
  // values the bound names have outside (restored when a level is done, so that a
  // declared set never sees a stale binding of a later variable)
  const outer = names.map((n) => env.get(n.name));
  const lists: (Listing | undefined)[] = [];
  const go = (i: number, g: number, probe: boolean, gb: boolean, deferred: boolean): boolean => {
    for (; g < guards.length && guards[g].need < i && (!deferred || i === names.length); g++) {
      let ok: boolean;
      let b: boolean;
      try {
        [ok, b] = tracked(c, () => pred(guards[g].term, cur, c));
      } catch (e) {
        if (i < names.length) {
          deferred = true; // decided at the leaves below
          break;
        }
        if (probe && e instanceof EvalError) {
          st.unsure = true;
          return false;
        }
        throw e;
      }
      if (!ok) {
        if (b) st.unsure = true;
        return false;
      }
      gb ||= b;
    }
    if (i === names.length) return leaf(cur, probe, gb);
    const { name, type } = names[i];
    let L = lists[i];
    if (!L) {
      const s = asSetLike(ev(type, cur, c), type);
      const got = listFor(s, c, cur);
      if (!got) throw new EvalError(() => `Too many values to check in ${q(printTerm(type))}`, t.span, 'too-large');
      L = got;
      // (listings of ℕ, ℤ and infinite given sets depend on the values bound so far)
      if (closed && (s.k === 'set' || ['power', 'rel', 'pfun', 'tfun', 'approx'].includes(s.desc.kind))) lists[i] = L;
    }
    if (L.cut) st.cut = true;
    for (const it of L.items) {
      if (budget.left <= 0) {
        st.cut = true;
        return true;
      }
      cur.set(name, it.v);
      if (go(i + 1, g, probe || it.probe, gb, deferred)) return true;
    }
    const o = outer[i];
    if (o === undefined) cur.delete(name);
    else cur.set(name, o);
    return false;
  };
  try {
    go(0, 0, false, false, false);
  } finally {
    if (own) c.budget = null;
  }
}

/**
 * The bindings of `∀ D | P . Q` that fail, exactly as the evaluator enumerates them
 * (same order, guards and work limit): `onFail(env)` for each binding whose body is
 * false or undefined, until it returns true. Used to grade how badly a ∀ fails.
 */
export function failingBindings(t: Quant, env: Env, u: Universe, onFail: (env: Env) => boolean): void {
  const c = ctxOf(u);
  const rest = binderPlan(t).rest;
  if (t.q !== '∀' || !rest) return;
  const st: BindState = { cut: false, unsure: false };
  eachBinding(t, env, c, st, (env2, probe) => {
    let ok: boolean;
    try {
      ok = pred(rest, env2, c);
    } catch (e) {
      ok = probe && e instanceof EvalError;
    }
    return ok ? false : onFail(env2);
  });
}

function subset(l: Value, r: Value, t: Extract<Term, { kind: 'rel' }>, c: Ctx): boolean {
  const ls = asSetLike(l, t.left);
  const rs = asSetLike(r, t.right);
  if (ls.k === 'lazy' && rs.k === 'lazy') {
    // ℕ₁ ⊆ ℕ ⊆ ℤ, and large ranges inside them (all of these sets are intervals)
    const rank: Record<string, number> = { nat1: 1, nat: 2, int: 3 };
    const ld = ls.desc;
    if (valueEquals(ls, rs)) return true;
    if (ld.kind in rank && rs.desc.kind in rank) return rank[ld.kind] <= rank[rs.desc.kind];
    if (ld.kind === 'range' && (rs.desc.kind in rank || rs.desc.kind === 'range')) {
      return ld.lo > ld.hi || (member(int(ld.lo), rs, c) && member(int(ld.hi), rs, c));
    }
    if (ld.kind === 'given' && rs.desc.kind === 'given') return ld.set === rs.desc.set;
  }
  const fl = exactFinite(ls, c);
  if (fl) return fl.elems.every((e) => member(e, rs, c));
  // an infinite set is never a subset of a finite one
  if (exactFinite(rs, c) && infiniteSet(ls, c) === true) return false;
  return listedIn(ls, rs, c);
}

/**
 * All listable elements of `a` are in `b`. Listed elements are genuine members of `a`,
 * so one that is (exactly) not in `b` decides exactly; otherwise a cut list is bounded.
 */
function listedIn(a: SetLike, b: SetLike, c: Ctx): boolean {
  const L = listFor(a, c, new Map());
  if (!L) {
    c.track.bounded = true;
    return true;
  }
  let result = true;
  for (const it of L.items) {
    const [m, mb] = tracked(c, () => member(it.v, b, c));
    if (!m && !mb) return false;
    if (!m) result = false;
    if (mb) c.track.bounded = true;
  }
  if (L.cut) c.track.bounded = true;
  return result;
}

// ── sets ───────────────────────────────────────────────────────────────────────

/**
 * A value as an element of a set or tuple: a lazy set that is finite and small enough
 * becomes a finite set, so that `ℙ {1}` and `{∅, {1}}` are the same element (finite
 * sets are compared by their elements' keys).
 */
function inner(v: Value, c: Ctx): Value {
  return v.k === 'lazy' ? (exactFinite(v, c) ?? v) : v;
}

function member(v: Value, s: SetLike, c: Ctx): boolean {
  spend();
  if (s.k === 'set') return s.index.has(valueKey(inner(v, c)));
  const d = s.desc;
  switch (d.kind) {
    case 'nat':
      return v.k === 'int' && v.v >= 0;
    case 'nat1':
      return v.k === 'int' && v.v >= 1;
    case 'int':
      return v.k === 'int';
    case 'range':
      return v.k === 'int' && v.v >= d.lo && v.v <= d.hi;
    case 'given':
      return v.k === 'atom' && v.set === d.set;
    case 'approx': {
      if (d.known.index.has(valueKey(v))) return true;
      const test = approxMembers.get(s);
      if (test) {
        try {
          return test(v, c);
        } catch (e) {
          if (!(e instanceof EvalError)) throw e;
        }
      }
      c.track.bounded = true; // only the listed elements are known
      return false;
    }
    case 'cross':
      return v.k === 'tuple' && v.elems.length === d.sets.length && v.elems.every((e, i) => member(e, d.sets[i], c));
    case 'setop':
      return d.op === '∪' ? member(v, d.left, c) || member(v, d.right, c) : member(v, d.left, c) && member(v, d.right, c) === (d.op === '∩');
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
        if (!dom) {
          // on an infinite given set an example can only show the function at its example
          // elements: total there counts, as a bounded verdict
          if (d.from.k === 'lazy' && d.from.desc.kind === 'given') {
            c.track.bounded = true;
            return d.from.desc.sample.elems.every((x) => seen.has(valueKey(x)));
          }
          return false; // a finite function cannot be total on ℕ, ℤ, …
        }
        return dom.elems.every((x) => seen.has(valueKey(x)));
      }
      return true;
    }
  }
}

function equal(a: Value, b: Value, c: Ctx): boolean {
  if (a.k !== 'lazy' && b.k !== 'lazy') return valueEquals(a, b);
  if (a.k === 'lazy' && b.k === 'lazy' && valueEquals(a, b)) return true;
  if (!isSetLike(a) || !isSetLike(b)) return false;
  const fa = exactFinite(a, c);
  const fb = exactFinite(b, c);
  if (fa && fb) return valueEquals(fa, fb);
  // a finite set never equals an infinite one
  const ia = fa ? false : infiniteSet(a, c);
  const ib = fb ? false : infiniteSet(b, c);
  if ((ia === true && ib === false) || (ia === false && ib === true)) return false;
  // otherwise compare what can be listed: an element on one side only decides exactly
  return listedIn(a, b, c) && listedIn(b, a, c);
}

/** Is the set infinite? null if unknown. */
function infiniteSet(s: SetLike, c: Ctx): boolean | null {
  if (s.k === 'set') return false;
  const d = s.desc;
  switch (d.kind) {
    case 'nat':
    case 'nat1':
    case 'int':
    case 'given':
      return true;
    case 'range':
      return false;
    case 'approx':
      return d.infinite ? true : null;
    case 'power':
      return infiniteSet(d.base, c);
    case 'rel':
    case 'pfun':
    case 'tfun': {
      const a = infiniteSet(d.from, c);
      const b = infiniteSet(d.to, c);
      if (a === false && b === false) return false;
      if ((a === true && nonEmpty(d.to)) || (b === true && nonEmpty(d.from))) return true;
      return null;
    }
    case 'cross': {
      const parts = d.sets.map((x) => infiniteSet(x, c));
      if (parts.every((p) => p === false)) return false;
      if (parts.some((p) => p === true) && d.sets.every(nonEmpty)) return true;
      return null;
    }
    case 'setop': {
      const a = infiniteSet(d.left, c);
      const b = infiniteSet(d.right, c);
      if (d.op === '∪') return a === true || b === true ? true : a === false && b === false ? false : null;
      if (a === false || (d.op === '∩' && b === false)) return false;
      return d.op === '∖' && a === true && b === false ? true : null;
    }
  }
}

function nonEmpty(s: SetLike): boolean {
  if (s.k === 'set') return s.elems.length > 0;
  const d = s.desc;
  switch (d.kind) {
    case 'range':
      return d.lo <= d.hi;
    case 'approx':
      return d.known.elems.length > 0 || d.infinite;
    case 'cross':
      return d.sets.every(nonEmpty);
    case 'setop':
      return d.op === '∪' && (nonEmpty(d.left) || nonEmpty(d.right)); // (∩, ∖: not known)
    default:
      return true; // ℕ, ℤ, given sets; ℙ S, X ↔ Y, X ⇸ Y contain ∅
  }
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
 * List the elements of a set. With `bounded`, ℕ / ℕ₁ / ℤ are cut to the universe's
 * [intMin, intMax], infinite given sets to their carrier and approx sets to their
 * known elements; otherwise these count as unlistable (→ null).
 * Returns null if the set has more than `c.limit` elements.
 */
function enumerate(s: SetLike, c: Ctx, bounded: boolean): Value[] | null {
  if (s.k === 'set') return s.elems.length <= c.limit ? [...s.elems] : null;
  const d = s.desc;
  const { intMin, intMax } = c.u;
  const sub = (x: SetLike) => enumerate(x, c, bounded);
  switch (d.kind) {
    case 'nat':
      return bounded ? intRange(Math.max(0, intMin), intMax, c) : null;
    case 'nat1':
      return bounded ? intRange(Math.max(1, intMin), intMax, c) : null;
    case 'int':
      return bounded ? intRange(intMin, intMax, c) : null;
    case 'range':
      return intRange(d.lo, d.hi, c);
    case 'given':
      return bounded ? [...d.sample.elems] : null;
    case 'approx':
      return bounded ? d.known.elems.filter((e) => !containsFresh(e)) : null;
    case 'cross': {
      const parts = d.sets.map(sub);
      if (parts.some((p) => p === null)) return null;
      return cartesian(parts as Value[][], c)?.map((es) => tuple(es)) ?? null;
    }
    case 'setop': {
      const a = sub(d.left);
      if (d.op === '∪') {
        const b = sub(d.right);
        return a && b ? mkSet([...a, ...b]).elems.slice() : null;
      }
      if (a) return a.filter((e) => member(e, d.right, c) === (d.op === '∩'));
      const b = d.op === '∩' ? sub(d.right) : null;
      return b && b.filter((e) => member(e, d.left, c));
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

interface Listing {
  /** `probe`: a number beyond the window (errors while trying it are ignored). */
  items: { v: Value; probe: boolean }[];
  /** The list is not the whole set. */
  cut: boolean;
}

/** The values a quantifier or comprehension tries for a variable declared `x : s`. */
function listFor(s: SetLike, c: Ctx, env: Env): Listing | null {
  const plain = (vs: readonly Value[], cut: boolean): Listing => ({ items: vs.map((v) => ({ v, probe: false })), cut });
  if (s.k === 'set') return s.elems.length <= c.limit ? plain(s.elems, false) : null;
  const d = s.desc;
  switch (d.kind) {
    case 'given': {
      // exact: the carrier, the generic atoms already in use, and one new generic atom.
      // The new one counts as a probe: if a value is undefined there (a total function
      // X → Y can only be shown on the example elements), that is not a verdict.
      const used = freshAtomsIn(env, d.set);
      const items = plain([...d.sample.elems, ...used], false).items;
      return { items: [...items, { v: freshAtom(d.set, used.length + 1), probe: true }], cut: false };
    }
    case 'nat':
    case 'nat1':
    case 'int': {
      const lo = d.kind === 'nat' ? 0 : d.kind === 'nat1' ? 1 : -Infinity;
      const window = intRange(Math.max(lo, c.u.intMin), c.u.intMax, c);
      if (!window) return null;
      const extra = probeNumbers(c, lo, Infinity, env).map((n) => ({ v: int(n), probe: true }));
      return { items: [...plain(window, true).items, ...extra], cut: true };
    }
    case 'range': {
      const all = intRange(d.lo, d.hi, c);
      if (all) return plain(all, false);
      const window = intRange(Math.max(d.lo, c.u.intMin), Math.min(d.hi, c.u.intMax), c) ?? [];
      const extra = [d.lo, d.hi, ...probeNumbers(c, d.lo, d.hi, env)].filter((n) => n < c.u.intMin || n > c.u.intMax);
      return { items: [...plain(window, true).items, ...[...new Set(extra)].map((n) => ({ v: int(n), probe: true }))], cut: true };
    }
    case 'cross': {
      // X × Y over infinite given sets: like `x ∈ X; y ∈ Y` (each part listed exactly)
      const parts: Listing[] = [];
      for (const p of d.sets) {
        const L = listFor(p, c, env);
        if (!L) return null;
        parts.push(L);
      }
      if (parts.reduce((n, p) => n * p.items.length, 1) > c.limit) return null;
      let acc: { vs: Value[]; probe: boolean }[] = [{ vs: [], probe: false }];
      for (const p of parts) acc = acc.flatMap((a) => p.items.map((it) => ({ vs: [...a.vs, it.v], probe: a.probe || it.probe })));
      return { items: acc.map((a) => ({ v: tuple(a.vs), probe: a.probe })), cut: parts.some((p) => p.cut) };
    }
    case 'approx':
      return plain(d.known.elems, true);
    case 'setop': {
      // list a side exactly (as quantifiers do), keep what is in the set
      const L = listFor(d.left, c, env);
      if (d.op === '∪') {
        const R = listFor(d.right, c, env);
        if (!L || !R) return null;
        const seen = new Set<string>();
        const items = [...L.items, ...R.items].filter((it) => !seen.has(valueKey(it.v)) && !!seen.add(valueKey(it.v)));
        return { items, cut: L.cut || R.cut };
      }
      if (L) return { items: L.items.filter((it) => member(it.v, d.right, c) === (d.op === '∩')), cut: L.cut };
      const R = d.op === '∩' ? listFor(d.right, c, env) : null;
      return R && { items: R.items.filter((it) => member(it.v, d.left, c)), cut: R.cut };
    }
    default: {
      const exact = enumerate(s, c, false);
      if (exact) return plain(exact, false);
      const some = enumerate(s, c, true);
      return some ? plain(some, true) : null;
    }
  }
}

/**
 * Numbers beyond the window [intMin, intMax] (inside [lo, hi]) worth trying: a few fixed
 * ones, the numbers of the spec, and the numbers of the current values with their
 * neighbours and negatives (balance −20 with overdraft 10: ∀ b ∈ ℤ must try −20).
 */
function probeNumbers(c: Ctx, lo: number, hi: number, env?: Env): number[] {
  const { intMin, intMax } = c.u;
  const cands = [intMax + 1, intMax + 2, ...PROBES, intMin - 1, ...PROBES.map((n) => -n), ...(c.u.probes ?? [])];
  if (env) for (const n of numbersIn(env)) cands.push(n, n - 1, n + 1, -n);
  const out = new Set<number>();
  for (const n of cands) if (Number.isSafeInteger(n) && n >= lo && n <= hi && (n < intMin || n > intMax)) out.add(n);
  return [...out];
}

/** The numbers in the values of an environment (at most 200). */
function numbersIn(env: Env): number[] {
  const out = new Set<number>();
  const walk = (v: Value): void => {
    if (out.size >= 200) return;
    if (v.k === 'int') out.add(v.v);
    else if (v.k === 'tuple' || v.k === 'set') for (const e of v.elems) walk(e);
  };
  for (const v of env.values()) walk(v);
  return [...out];
}

const freshCache = new Map<string, AtomValue>();
/** The i-th generic element of an infinite given set ("another DATE"). */
function freshAtom(set: string, i: number): AtomValue {
  const name = i === 1 ? `another ${set}` : `another ${set} (${i})`;
  let a = freshCache.get(`${set}\u0000${name}`);
  if (!a) {
    a = { k: 'atom', set, name, fresh: true };
    freshCache.set(`${set}\u0000${name}`, a);
  }
  return a;
}

/**
 * Distinct generic atoms of `set` bound in `env`. (Only quantifier and comprehension
 * variables over the given set itself can hold one; example values never do.)
 */
function freshAtomsIn(env: Env, set: string): AtomValue[] {
  const found = new Map<string, AtomValue>();
  for (const v of env.values()) if (v.k === 'atom' && v.fresh && v.set === set) found.set(v.name, v);
  return [...found.values()];
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

/**
 * A finite set, materialising lazy sets when possible. An infinite given set gives its
 * example carrier and an approx set its known elements; both make the result bounded.
 */
function finite(v: Value, at: Term, c: Ctx): SetValue {
  const s = asSetLike(v, at);
  if (s.k === 'set') return s;
  const f = exactFinite(s, c);
  if (f) return f;
  if (s.desc.kind === 'given') {
    c.track.bounded = true;
    return s.desc.sample;
  }
  if (s.desc.kind === 'approx') {
    c.track.bounded = true;
    return mkSet(s.desc.known.elems.filter((e) => !containsFresh(e)));
  }
  if (s.desc.kind === 'setop' || s.desc.kind === 'cross') {
    // e.g. #(PATIENT × DRUG): only the example elements can be counted
    const some = enumerate(s, c, true);
    if (some) {
      c.track.bounded = true;
      return mkSet(some.filter((e) => !containsFresh(e)));
    }
  }
  throw new EvalError(`${q(printTerm(at))} is too large to compute with`, at.span, 'too-large');
}

function pairsOf(s: SetValue, at: Term): TupleValue[] {
  for (const e of s.elems) {
    if (!isPair(e)) throw new EvalError(`${q(printTerm(at))} is not a relation (its elements are not pairs)`, at.span);
  }
  return s.elems as TupleValue[];
}

/** Sort helper for callers that build value lists. */
export const sortValues = (vs: Value[]): Value[] => [...vs].sort(compareValues);
