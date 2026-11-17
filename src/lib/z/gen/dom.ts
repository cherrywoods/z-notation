// Value domains for the example generator: a declared set (`BOOK ⇸ MEMBER`, `ℙ USER`,
// `ℕ`, …) compiled into something we can sample from and mutate. Sizes are biased
// towards small, readable examples (2–4 elements per set or relation).

import type { Term } from '../ast';
import { evalTerm, type Universe } from '../eval';
import { EMPTY, int, isPair, mkSet, pair, tuple, valueEquals, valueKey, type SetValue, type Value } from '../values';
import type { Rng } from './rng';

/** How integers of a variable should look: small counts, or money-like amounts. */
export type IntScale = 'small' | 'money';

export type Dom =
  | { k: 'finite'; elems: readonly Value[] }
  /** Whole numbers in [lo, hi]: sampled from `cands`, moved by ±step. */
  | { k: 'int'; lo: number; hi: number; cands: readonly number[]; step: number }
  | { k: 'set'; base: Dom }
  | { k: 'rel'; fn: 'rel' | 'pfun' | 'tfun'; from: Dom; to: Dom }
  | { k: 'tuple'; parts: Dom[] };

export type SetDom = Extract<Dom, { k: 'set' | 'rel' }>;

/** Hints for generating a set value (from predicates like `dom f ⊆ S`, `x ∈ s`). */
export interface SetSpec {
  /** Every new element should pass all filters. */
  filters: ((e: Value) => boolean)[];
  /** Elements that should be in the set. */
  required: Value[];
  /** Relations: values that should be in the domain. */
  reqDom: Value[];
}

export const emptySpec = (): SetSpec => ({ filters: [], required: [], reqDom: [] });

const MONEY = /balance|amount|overdraft|limit|price|cost|credit|debit|salary|fee|deposit|withdraw|sum|total|budget|fund|pay|cash|money|wage|fine|charge/i;

/** Integer style for a variable, guessed from its name. */
export function intScaleFor(name: string): IntScale {
  return MONEY.test(name) ? 'money' : 'small';
}

// ── compiling declared sets ─────────────────────────────────────────────────────

/**
 * Compile a declared set; null if it cannot be used (unknown names, empty, infinite).
 * `consts`: numbers written in the specification (e.g. 36.5 in `t? > 36.5`); they and
 * their neighbours become extra candidates, so that such bounds can be met.
 */
export function compileDom(t: Term, u: Universe, scale: IntScale, consts: readonly number[] = []): Dom | null {
  switch (t.kind) {
    case 'name': {
      if (Object.prototype.hasOwnProperty.call(u.carriers, t.name)) {
        const elems = u.carriers[t.name];
        return elems.length ? { k: 'finite', elems } : null;
      }
      return null;
    }
    case 'builtinSet':
      return intDom(t.set === 'ℕ' ? 0 : t.set === 'ℕ₁' ? 1 : -Infinity, Infinity, scale, consts);
    case 'unop':
      if (t.op === 'ℙ') {
        const base = compileDom(t.arg, u, scale, consts);
        return base && { k: 'set', base };
      }
      break;
    case 'binop':
      if (t.op === '↔' || t.op === '⇸' || t.op === '→') {
        const from = compileDom(t.left, u, scale, consts);
        const to = compileDom(t.right, u, scale, consts);
        if (!from || !to) return null;
        return { k: 'rel', fn: t.op === '↔' ? 'rel' : t.op === '⇸' ? 'pfun' : 'tfun', from, to };
      }
      if (t.op === '..') {
        try {
          const lo = evalTerm(t.left, new Map(), u);
          const hi = evalTerm(t.right, new Map(), u);
          if (lo.k === 'int' && hi.k === 'int' && lo.v <= hi.v) return intDom(lo.v, hi.v, scale, consts);
        } catch {
          /* fall through */
        }
        return null;
      }
      break;
    case 'cross': {
      const parts = t.elems.map((e) => compileDom(e, u, scale, consts));
      if (parts.some((p) => !p)) return null;
      return { k: 'tuple', parts: parts as Dom[] };
    }
  }
  // anything else: a finite set we can list (e.g. a set display)
  try {
    const v = evalTerm(t, new Map(), u);
    if (v.k === 'set' && v.elems.length > 0 && v.elems.length <= 500) return { k: 'finite', elems: v.elems };
  } catch {
    /* unusable */
  }
  return null;
}

/**
 * Add the numbers written in the spec, c and c ± step (inside [lo, hi]), so that
 * bounds like `x > 1000` can be met (by 1001).
 */
function withConsts(cands: number[], consts: readonly number[], step: number, lo: number, hi: number): number[] {
  const out = new Set(cands);
  for (const c of consts.slice(0, 12)) {
    for (const n of [c - step, c, c + step, c - 1, c + 1]) if (n >= lo && n <= hi) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function intDom(lo: number, hi: number, scale: IntScale, consts: readonly number[] = []): Dom {
  const base =
    scale === 'money'
      ? [-100, -50, -20, 0, 10, 20, 50, 100, 150, 200, 250, 300, 500]
      : [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  let cands: number[];
  if (Number.isFinite(lo) && Number.isFinite(hi) && hi - lo <= 20) {
    cands = [];
    for (let i = lo; i <= hi; i++) cands.push(i);
  } else {
    cands = base.filter((n) => n >= lo && n <= hi);
    if (cands.length < 3) {
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        cands = [];
        for (let i = 0; i < 12; i++) cands.push(Math.round(lo + ((hi - lo) * i) / 11));
      } else if (Number.isFinite(lo)) {
        cands = Array.from({ length: 10 }, (_, i) => lo + i);
      } else {
        cands = Array.from({ length: 10 }, (_, i) => hi - 9 + i);
      }
    }
  }
  const step = scale === 'money' ? 10 : 1;
  return { k: 'int', lo, hi, cands: withConsts(cands, consts, step, lo, hi), step };
}

export const isSetDom = (d: Dom): d is SetDom => d.k === 'set' || d.k === 'rel';

/** Atoms, numbers and tuples of those (not sets). */
export function isScalarDom(d: Dom): boolean {
  return d.k === 'finite' ? d.elems.every((e) => e.k !== 'set' && e.k !== 'lazy') : d.k === 'int' || (d.k === 'tuple' && d.parts.every(isScalarDom));
}

/**
 * Can the domain hold no (listable) value at all? Empty sets of candidates, and total
 * functions on infinite sets (ℕ → NAME), which no finite example can show.
 */
export function isEmptyDom(d: Dom): boolean {
  switch (d.k) {
    case 'finite':
      return d.elems.length === 0;
    case 'int':
      return d.cands.length === 0;
    case 'tuple':
      return d.parts.some(isEmptyDom);
    case 'set':
      return false;
    case 'rel':
      if (d.fn === 'tfun') return isInfinite(d.from) || (!isEmptyDom(d.from) && isEmptyDom(d.to));
      return false;
  }
}

function isInfinite(d: Dom): boolean {
  switch (d.k) {
    case 'finite':
      return false;
    case 'int':
      return !Number.isFinite(d.lo) || !Number.isFinite(d.hi) || d.hi - d.lo > 20; // see intDom
    case 'tuple':
      return d.parts.some(isInfinite);
    default:
      return true;
  }
}

/** All values of a small domain (integers: the candidate numbers), or null. */
export function enumDom(d: Dom, limit = 400): Value[] | null {
  switch (d.k) {
    case 'finite':
      return d.elems.length <= limit ? [...d.elems] : null;
    case 'int':
      return d.cands.map(int);
    case 'tuple': {
      let acc: Value[][] = [[]];
      for (const p of d.parts) {
        const vs = enumDom(p, limit);
        if (!vs || acc.length * vs.length > limit) return null;
        acc = acc.flatMap((prefix) => vs.map((v) => [...prefix, v]));
      }
      return acc.map((es) => tuple(es));
    }
    default:
      return null;
  }
}

// ── sampling ───────────────────────────────────────────────────────────────────

/** Number of elements for a new set: 2–4 at the top level, 1–2 inside other values. */
function targetSize(rng: Rng, depth: number): number {
  return depth === 0 ? rng.weighted([3, 12, 30, 32, 18, 5]) : rng.weighted([10, 50, 30, 10]);
}

export function sampleDom(d: Dom, rng: Rng, depth = 0): Value {
  switch (d.k) {
    case 'finite':
      return rng.pick(d.elems);
    case 'int':
      return int(rng.pick(d.cands));
    case 'tuple':
      return tuple(d.parts.map((p) => sampleDom(p, rng, depth)));
    default:
      return genSet(d, rng, null, depth);
  }
}

const okFor = (spec: SetSpec | null) => (e: Value) => !spec || spec.filters.every((f) => f(e));
const first = (p: Value) => (p as Extract<Value, { k: 'tuple' }>).elems[0];
const second = (p: Value) => (p as Extract<Value, { k: 'tuple' }>).elems[1];

/** A new set / relation / function value, following the hints in `spec`. */
export function genSet(d: SetDom, rng: Rng, spec: SetSpec | null, depth = 0, size?: number): SetValue {
  let n = size ?? targetSize(rng, depth);
  const ok = okFor(spec);
  const required = spec?.required ?? [];
  // leave some values out at the top level, so that "new" values exist (book? ∉ onLoan)
  const cap = (count: number) => {
    if (size === undefined && depth === 0 && count >= 3) n = Math.min(n, count - 1);
  };
  if (d.k === 'set') {
    const out = new Map<string, Value>();
    for (const r of required) out.set(valueKey(r), r);
    const cands = enumDom(d.base);
    if (cands) {
      cap(cands.length);
      for (const e of rng.shuffle(cands)) {
        if (out.size >= n) break;
        const k = valueKey(e);
        if (!out.has(k) && ok(e)) out.set(k, e);
      }
    } else {
      for (let tries = 0; out.size < n && tries < 3 * n + 3; tries++) {
        const e = sampleDom(d.base, rng, depth + 1);
        if (ok(e)) out.set(valueKey(e), e);
      }
    }
    return mkSet(out.values());
  }

  const rel = new RelGen(d, rng, ok, depth);
  const reqPairs = required.filter(isPair);
  if (rel.xs) cap(rel.xs.length);
  if (d.fn === 'tfun') {
    if (!rel.xs) return EMPTY; // a total function on an infinite set cannot be listed
    const out: Value[] = [];
    const used = new Set<string>();
    for (const x of rel.xs) {
      const r = reqPairs.find((p) => valueEquals(first(p), x));
      const p = r ?? pair(x, rel.image(x, undefined, used) ?? rel.anyImage(x));
      used.add(valueKey(second(p)));
      out.push(p);
    }
    return mkSet(out);
  }
  if (d.fn === 'pfun') {
    const byX = new Map<string, Value>();
    for (const p of reqPairs) {
      const k = valueKey(first(p));
      if (!byX.has(k)) byX.set(k, p);
    }
    for (const x of spec?.reqDom ?? []) {
      const k = valueKey(x);
      if (!byX.has(k)) byX.set(k, pair(x, rel.anyImage(x)));
    }
    if (rel.xs) {
      const used = new Set([...byX.values()].map((p) => valueKey(second(p))));
      for (const x of rng.shuffle(rel.xs)) {
        if (byX.size >= n) break;
        const k = valueKey(x);
        if (byX.has(k)) continue;
        const y = rel.image(x, undefined, used);
        if (y) {
          byX.set(k, pair(x, y));
          used.add(valueKey(y));
        }
      }
    }
    return mkSet(byX.values());
  }
  // relation
  const out = new Map<string, Value>();
  for (const p of reqPairs) out.set(valueKey(p), p);
  for (const x of spec?.reqDom ?? []) {
    if ([...out.values()].some((p) => valueEquals(first(p), x))) continue;
    const p = pair(x, rel.anyImage(x));
    out.set(valueKey(p), p);
  }
  const all = rel.allPairs();
  if (all) {
    for (const p of rng.shuffle(all)) {
      if (out.size >= n) break;
      const k = valueKey(p);
      if (!out.has(k)) out.set(k, p);
    }
  } else {
    for (let tries = 0; out.size < n && tries < 3 * n + 3; tries++) {
      const p = rel.randomPair();
      if (p) out.set(valueKey(p), p);
    }
  }
  return mkSet(out.values());
}

/** Helpers for building relations: candidate images and pairs under the filters. */
class RelGen {
  readonly xs: Value[] | null;
  readonly ys: Value[] | null;
  constructor(
    readonly d: Extract<Dom, { k: 'rel' }>,
    readonly rng: Rng,
    readonly ok: (e: Value) => boolean,
    readonly depth: number,
  ) {
    this.xs = enumDom(d.from);
    this.ys = enumDom(d.to);
  }
  /** An image for x that passes the filters (null if there is none), rather one not `used` yet. */
  image(x: Value, avoid?: Value, used?: Set<string>): Value | null {
    if (this.ys) {
      const opts = this.ys.filter((y) => (!avoid || !valueEquals(y, avoid)) && this.ok(pair(x, y)));
      if (used && this.rng.chance(0.75)) {
        const fresh = opts.filter((y) => !used.has(valueKey(y)));
        if (fresh.length) return this.rng.pick(fresh);
      }
      return opts.length ? this.rng.pick(opts) : null;
    }
    for (let i = 0; i < 6; i++) {
      const y = avoid && i < 3 && isSetDom(this.d.to) && avoid.k === 'set' ? mutateDom(this.d.to, avoid, this.rng, null, this.depth + 1) : sampleDom(this.d.to, this.rng, this.depth + 1);
      if ((!avoid || !valueEquals(y, avoid)) && this.ok(pair(x, y))) return y;
    }
    return null;
  }
  /** An image for x, ignoring the filters if needed. */
  anyImage(x: Value): Value {
    return this.image(x) ?? (this.ys && this.ys.length ? this.rng.pick(this.ys) : sampleDom(this.d.to, this.rng, this.depth + 1));
  }
  allPairs(): Value[] | null {
    if (!this.xs || !this.ys || this.xs.length * this.ys.length > 2000) return null;
    const out: Value[] = [];
    for (const x of this.xs) for (const y of this.ys) {
      const p = pair(x, y);
      if (this.ok(p)) out.push(p);
    }
    return out;
  }
  randomPair(): Value | null {
    const x = this.xs ? this.rng.pick(this.xs) : sampleDom(this.d.from, this.rng, this.depth + 1);
    const y = this.image(x);
    return y ? pair(x, y) : null;
  }
}

// ── mutation ───────────────────────────────────────────────────────────────────

/** A random neighbour of `v` (a small change), following the hints in `spec` for new elements. */
export function mutateDom(d: Dom, v: Value, rng: Rng, spec: SetSpec | null, depth = 0): Value {
  switch (d.k) {
    case 'finite': {
      if (d.elems.length < 2) return v;
      const others = d.elems.filter((e) => !valueEquals(e, v));
      return rng.pick(others);
    }
    case 'int': {
      const cur = v.k === 'int' ? v.v : 0;
      if (rng.chance(0.5)) {
        const others = d.cands.filter((c) => c !== cur);
        if (others.length) return int(rng.pick(others));
      }
      let next = cur + (rng.chance(0.5) ? d.step : -d.step);
      if (next < d.lo || next > d.hi) next = cur - (next - cur);
      if (next < d.lo || next > d.hi) next = rng.pick(d.cands);
      return int(next);
    }
    case 'tuple': {
      if (v.k !== 'tuple' || v.elems.length !== d.parts.length) return sampleDom(d, rng, depth);
      const i = rng.int(d.parts.length);
      const elems = [...v.elems];
      elems[i] = mutateDom(d.parts[i], elems[i], rng, null, depth);
      return tuple(elems);
    }
    default:
      if (v.k !== 'set') return genSet(d, rng, spec, depth);
      return mutateSet(d, v, rng, spec, depth);
  }
}

type Move = 'add' | 'remove' | 'swap' | 'image' | 'regen';

function mutateSet(d: SetDom, v: SetValue, rng: Rng, spec: SetSpec | null, depth: number): Value {
  const n = v.elems.length;
  const isFn = d.k === 'rel' && d.fn !== 'rel';
  const total = d.k === 'rel' && d.fn === 'tfun';
  const moves: Move[] = ['add', 'remove', 'swap', 'image', 'regen'];
  const weights = [
    total ? 0 : n <= 1 ? 4 : n >= 5 ? 0.5 : 2,
    total || n === 0 ? 0 : n >= 5 ? 4 : n === 1 ? 0.7 : 1.5,
    total || n === 0 ? 0 : 1,
    d.k === 'rel' && n > 0 ? (total ? 6 : 2) : 0,
    0.3,
  ];
  for (let attempt = 0; attempt < 4; attempt++) {
    const move = moves[rng.weighted(weights)];
    const r = applyMove(move, d, v, rng, spec, depth, isFn);
    if (r && !valueEquals(r, v)) return r;
  }
  return genSet(d, rng, spec, depth);
}

function applyMove(move: Move, d: SetDom, v: SetValue, rng: Rng, spec: SetSpec | null, depth: number, isFn: boolean): SetValue | null {
  const ok = okFor(spec);
  const elems = [...v.elems];
  const add = (): Value | null => {
    if (d.k === 'set') {
      const cands = enumDom(d.base);
      if (cands) {
        const opts = cands.filter((e) => !v.index.has(valueKey(e)) && ok(e));
        return opts.length ? rng.pick(opts) : null;
      }
      for (let i = 0; i < 6; i++) {
        const e = sampleDom(d.base, rng, depth + 1);
        if (!v.index.has(valueKey(e)) && ok(e)) return e;
      }
      return null;
    }
    const rel = new RelGen(d, rng, ok, depth);
    if (isFn) {
      const used = new Set(elems.map((p) => valueKey(first(p))));
      const xs = rel.xs ? rel.xs.filter((x) => !used.has(valueKey(x))) : null;
      for (let i = 0; i < 6; i++) {
        const x = xs ? (xs.length ? rng.pick(xs) : null) : sampleDom(d.from, rng, depth + 1);
        if (!x || used.has(valueKey(x))) {
          if (xs) return null;
          continue;
        }
        const y = rel.image(x);
        if (y) return pair(x, y);
      }
      return null;
    }
    const all = rel.allPairs();
    if (all) {
      const opts = all.filter((p) => !v.index.has(valueKey(p)));
      return opts.length ? rng.pick(opts) : null;
    }
    for (let i = 0; i < 6; i++) {
      const p = rel.randomPair();
      if (p && !v.index.has(valueKey(p))) return p;
    }
    return null;
  };

  switch (move) {
    case 'add': {
      const e = add();
      return e ? mkSet([...elems, e]) : null;
    }
    case 'remove': {
      if (!elems.length) return null;
      elems.splice(rng.int(elems.length), 1);
      return mkSet(elems);
    }
    case 'swap': {
      if (!elems.length) return null;
      const i = rng.int(elems.length);
      const removed = elems.splice(i, 1)[0];
      const smaller = mkSet(elems);
      const e = applyMove('add', d, smaller, rng, spec, depth, isFn);
      if (!e) return null;
      const added = e.elems.find((x) => !smaller.index.has(valueKey(x)));
      return added && valueEquals(added, removed) ? null : e;
    }
    case 'image': {
      if (d.k !== 'rel' || !elems.length) return null;
      const i = rng.int(elems.length);
      const p = elems[i];
      const rel = new RelGen(d, rng, ok, depth);
      const y = rel.image(first(p), second(p)) ?? (spec ? new RelGen(d, rng, () => true, depth).image(first(p), second(p)) : null);
      if (!y) return null;
      elems[i] = pair(first(p), y);
      return mkSet(elems);
    }
    case 'regen':
      return genSet(d, rng, spec, depth);
  }
}

/**
 * Smallest change of `v` towards the hints: drop elements that fail a filter, add
 * required elements and domain values (functions stay functions, total ones total).
 */
export function repairSet(d: SetDom, v: SetValue, rng: Rng, spec: SetSpec): SetValue {
  const ok = okFor(spec);
  const out = new Map<string, Value>();
  for (const e of v.elems) if (ok(e)) out.set(valueKey(e), e);
  for (const r of spec.required) out.set(valueKey(r), r);
  if (d.k === 'set') return mkSet(out.values());
  const rel = new RelGen(d, rng, ok, 0);
  let elems: Value[] = [...out.values()].filter(isPair);
  if (d.fn !== 'rel') {
    // keep one pair per x, preferring required ones
    const byX = new Map<string, Value>();
    const req = new Set(spec.required.map(valueKey));
    for (const p of elems) {
      const k = valueKey(first(p));
      if (!byX.has(k) || req.has(valueKey(p))) byX.set(k, p);
    }
    elems = [...byX.values()];
  }
  const inDom = new Set(elems.map((p) => valueKey(first(p))));
  const need = [...spec.reqDom, ...(d.fn === 'tfun' && rel.xs ? rel.xs : [])];
  for (const x of need) {
    const k = valueKey(x);
    if (inDom.has(k)) continue;
    inDom.add(k);
    elems.push(pair(x, rel.anyImage(x)));
  }
  return mkSet(elems);
}

/** All elements a set value may contain under the filters of `spec`, or null if too many to list. */
export function allowedElements(d: SetDom, rng: Rng, spec: SetSpec): Value[] | null {
  const ok = okFor(spec);
  if (d.k === 'set') return enumDom(d.base)?.filter(ok) ?? null;
  return new RelGen(d, rng, ok, 0).allPairs();
}
