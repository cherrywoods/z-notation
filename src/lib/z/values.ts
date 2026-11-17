// Runtime values for evaluating Z over finite example universes.
//
//   atoms    elements of given sets ('Dune' ∈ BOOK, '2.Feb' ∈ DATE)
//   ints     whole numbers
//   tuples   (a, b, …) — a maplet a ↦ b is the pair (a, b)
//   sets     finite sets with a canonical element order and O(1) membership
//   lazy     sets that are infinite or too large to list (ℕ, ℙ BOOK, BOOK ⇸ MEMBER, …);
//            they support exact membership tests and are enumerated only on demand
//            (see eval.ts).

export interface AtomValue {
  k: 'atom';
  /** Given set the atom belongs to, e.g. 'BOOK'. */
  set: string;
  /** Display string, e.g. 'Dune' or '2.Feb'. Identity is (set, name). */
  name: string;
  /** Position in the example carrier; only used for ordering (pool order). */
  ord?: number;
  /**
   * A generic element of an infinite given set that is not in the example carrier
   * ("another DATE"). The evaluator uses it to stand for all such elements at once.
   */
  fresh?: true;
}
/** A whole number. */
export interface IntValue {
  k: 'int';
  v: number;
}
export interface TupleValue {
  k: 'tuple';
  elems: readonly Value[];
}
export interface SetValue {
  k: 'set';
  /** Elements in canonical order (see compareValues), without duplicates. */
  elems: readonly Value[];
  /** valueKey → element, for fast membership. */
  index: ReadonlyMap<string, Value>;
}
export type LazyDesc =
  | { kind: 'nat' } // ℕ
  | { kind: 'nat1' } // ℕ₁
  | { kind: 'int' } // ℤ
  | { kind: 'range'; lo: number; hi: number } // lo .. hi (large)
  | { kind: 'power'; base: SetLike } // ℙ S
  | { kind: 'rel' | 'pfun' | 'tfun'; from: SetLike; to: SetLike } // X ↔ Y, X ⇸ Y, X → Y
  | { kind: 'cross'; sets: SetLike[] } // X × Y (large)
  /** A given set that is infinite in principle; `sample` are its example elements. */
  | { kind: 'given'; set: string; sample: SetValue }
  /**
   * A set from a comprehension over an infinite set (ℕ, ℤ, an infinite given set) that
   * could not be listed completely. `known` are elements found (all genuine members);
   * `infinite`: the set is known to be infinite. `id` identifies the set.
   */
  | { kind: 'approx'; id: number; known: SetValue; infinite: boolean };
export interface LazySetValue {
  k: 'lazy';
  desc: LazyDesc;
}
export type SetLike = SetValue | LazySetValue;
export type Value = AtomValue | IntValue | TupleValue | SetValue | LazySetValue;

// ── constructors ───────────────────────────────────────────────────────────────

export const atom = (set: string, name: string, ord?: number): AtomValue =>
  ord === undefined ? { k: 'atom', set, name } : { k: 'atom', set, name, ord };
/** A number value (-0 becomes 0, so that equal numbers have equal keys). */
export const int = (v: number): IntValue => ({ k: 'int', v: v === 0 ? 0 : v });

/**
 * A number as Z text, never in exponent notation (1e21 → 1000000000000000000000), so
 * that printed literals parse back to the same number.
 */
export function formatNumber(n: number): string {
  if (Object.is(n, -0)) return '0';
  const s = String(n);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const [, sign, first, rest = '', expText] = m;
  const digits = first + rest;
  const e = Number(expText);
  if (e < 0) return `${sign}0.${'0'.repeat(-e - 1)}${digits}`;
  return sign + digits + '0'.repeat(Math.max(0, e - rest.length));
}
export const tuple = (elems: readonly Value[]): TupleValue => ({ k: 'tuple', elems });
export const pair = (a: Value, b: Value): TupleValue => tuple([a, b]);
export const lazy = (desc: LazyDesc): LazySetValue => ({ k: 'lazy', desc });

/** Build a finite set: removes duplicates and sorts into canonical order. */
export function mkSet(elems: Iterable<Value>): SetValue {
  const index = new Map<string, Value>();
  for (const e of elems) {
    const key = valueKey(e);
    if (!index.has(key)) index.set(key, e);
  }
  const sorted = [...index.values()].sort(compareValues);
  return { k: 'set', elems: sorted, index };
}

export const EMPTY: SetValue = mkSet([]);

export const isSetLike = (v: Value): v is SetLike => v.k === 'set' || v.k === 'lazy';
export const isPair = (v: Value): v is TupleValue => v.k === 'tuple' && v.elems.length === 2;

/** Membership in a finite set. */
export function setHas(s: SetValue, v: Value): boolean {
  return s.index.has(valueKey(v));
}

// ── keys, equality, order ──────────────────────────────────────────────────────

const keyCache = new WeakMap<object, string>();

/**
 * Canonical string key: equal values ⇔ equal keys. Atoms are length-prefixed so
 * that arbitrary display names cannot collide; set keys are independent of the
 * display order of their elements.
 */
export function valueKey(v: Value): string {
  switch (v.k) {
    case 'int':
      return `i${v.v}`;
    case 'atom':
      return `a${v.set.length}:${v.set}${v.name.length}:${v.name}`;
    default: {
      const cached = keyCache.get(v);
      if (cached !== undefined) return cached;
      let key: string;
      if (v.k === 'tuple') key = `t(${v.elems.map(valueKey).join(',')})`;
      else if (v.k === 'set') key = `s{${[...v.index.keys()].sort().join(',')}}`;
      else key = `L${lazyKey(v.desc)}`;
      keyCache.set(v, key);
      return key;
    }
  }
}

function lazyKey(d: LazyDesc): string {
  switch (d.kind) {
    case 'nat':
    case 'nat1':
    case 'int':
      return d.kind;
    case 'range':
      return `range(${d.lo},${d.hi})`;
    case 'power':
      return `power(${valueKey(d.base)})`;
    case 'rel':
    case 'pfun':
    case 'tfun':
      return `${d.kind}(${valueKey(d.from)},${valueKey(d.to)})`;
    case 'cross':
      return `cross(${d.sets.map(valueKey).join(',')})`;
    case 'given':
      return `given(${d.set})`;
    case 'approx':
      return `approx(${d.id})`;
  }
}

/** Structural equality. A finite set never equals a lazy set (see eval.ts for exact set equality). */
export function valueEquals(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (a.k !== b.k) return false;
  if (a.k === 'int') return a.v === (b as IntValue).v;
  if (a.k === 'atom') return a.set === (b as AtomValue).set && a.name === (b as AtomValue).name;
  if (a.k === 'set' && a.elems.length !== (b as SetValue).elems.length) return false;
  return valueKey(a) === valueKey(b);
}

const KIND_ORDER: Record<Value['k'], number> = { int: 0, atom: 1, tuple: 2, set: 3, lazy: 4 };
const collator = new Intl.Collator('en', { numeric: true });

/**
 * Canonical total order: ints numerically; atoms by set, then carrier position
 * (`ord`), then name (natural order, so train2 < train10); tuples and sets
 * lexicographically.
 */
export function compareValues(a: Value, b: Value): number {
  if (a.k !== b.k) return KIND_ORDER[a.k] - KIND_ORDER[b.k];
  switch (a.k) {
    case 'int':
      return a.v - (b as IntValue).v;
    case 'atom': {
      const bb = b as AtomValue;
      if (a.set !== bb.set) return a.set < bb.set ? -1 : 1;
      const oa = a.ord ?? Infinity;
      const ob = bb.ord ?? Infinity;
      if (oa !== ob) return oa < ob ? -1 : 1;
      if (a.name === bb.name) return 0;
      return collator.compare(a.name, bb.name) || (a.name < bb.name ? -1 : 1);
    }
    case 'tuple':
    case 'set': {
      const ea = a.elems;
      const eb = (b as typeof a).elems;
      if (a.k === 'set' && ea.length !== eb.length) return ea.length - eb.length;
      for (let i = 0; i < Math.min(ea.length, eb.length); i++) {
        const c = compareValues(ea[i], eb[i]);
        if (c !== 0) return c;
      }
      return ea.length - eb.length;
    }
    case 'lazy': {
      const ka = valueKey(a);
      const kb = valueKey(b);
      return ka === kb ? 0 : ka < kb ? -1 : 1;
    }
  }
}

// ── printing ───────────────────────────────────────────────────────────────────

/**
 * Z set notation as on the slides: `{Dune ↦ Ada, Emma ↦ Ben}`, `{Dune, Emma}`,
 * `∅`, `{Ana ↦ {aspirin ↦ 2}}`; a pair on its own prints as `(a, b)`.
 */
export function printValue(v: Value): string {
  switch (v.k) {
    case 'int':
      return formatNumber(v.v);
    case 'atom':
      return v.name;
    case 'tuple':
      return `(${v.elems.map(printValue).join(', ')})`;
    case 'set':
      if (v.elems.length === 0) return '∅';
      return `{${v.elems.map(printElem).join(', ')}}`;
    case 'lazy':
      return printLazy(v.desc, 0);
  }
}

/** Inside a set, pairs are written as maplets. */
function printElem(e: Value): string {
  return isPair(e) ? `${printValue(e.elems[0])} ↦ ${printValue(e.elems[1])}` : printValue(e);
}

function printLazy(d: LazyDesc, min: number): string {
  const sub = (s: SetLike, m: number) => (s.k === 'lazy' ? printLazy(s.desc, m) : printValue(s));
  const wrap = (p: number, s: string) => (p < min ? `(${s})` : s);
  switch (d.kind) {
    case 'nat':
      return 'ℕ';
    case 'nat1':
      return 'ℕ₁';
    case 'int':
      return 'ℤ';
    case 'range':
      return wrap(2, `${formatNumber(d.lo)} .. ${formatNumber(d.hi)}`);
    case 'power':
      return wrap(3, `ℙ ${sub(d.base, 3)}`);
    case 'rel':
    case 'pfun':
    case 'tfun': {
      const sym = d.kind === 'rel' ? '↔' : d.kind === 'pfun' ? '⇸' : '→';
      return wrap(1, `${sub(d.from, 2)} ${sym} ${sub(d.to, 1)}`);
    }
    case 'cross':
      return wrap(2, d.sets.map((s) => sub(s, 3)).join(' × '));
    case 'given':
      return d.set;
    case 'approx': {
      const shown = d.known.elems.filter((e) => !containsFresh(e)).map(printElem);
      return `{${[...shown, '…'].join(', ')}}`;
    }
  }
}

/** Does a value contain a generic atom ("another DATE")? */
export function containsFresh(v: Value): boolean {
  switch (v.k) {
    case 'atom':
      return !!v.fresh;
    case 'tuple':
    case 'set':
      return v.elems.some(containsFresh);
    default:
      return false;
  }
}
