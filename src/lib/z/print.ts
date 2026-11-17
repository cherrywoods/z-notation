// Printing terms back to canonical unicode text (minimal parentheses), plus the
// structural helpers other parts of the engine need: structural equality, free
// variables, capture-avoiding substitution / renaming, priming.

import type { Decl, Span, Term, VarDecl } from './ast';
import type { Decoration } from './lexer';
import { formatNumber } from './values';

// ── precedence ─────────────────────────────────────────────────────────────────

/** Binding strength of each construct (higher binds tighter); mirrors parser.ts. */
const P = {
  quant: 1,
  iff: 2,
  implies: 3,
  or: 4,
  and: 5,
  not: 6,
  rel: 7,
  arrow: 8,
  cross: 9,
  maplet: 10,
  range: 11,
  add: 12,
  mul: 13,
  prefix: 14,
  apply: 15,
  atom: 16,
} as const;

const BINOP_PREC: Record<string, number> = {
  '↔': P.arrow,
  '⇸': P.arrow,
  '→': P.arrow,
  '↦': P.maplet,
  '..': P.range,
  '+': P.add,
  '-': P.add,
  '∪': P.add,
  '∖': P.add,
  '*': P.mul,
  div: P.mul,
  mod: P.mul,
  '∩': P.mul,
};
const LOGIC_PREC: Record<string, number> = { '⇔': P.iff, '⇒': P.implies, '∨': P.or, '∧': P.and };

/** Precedence of a term's outermost construct. */
export function termPrec(t: Term): number {
  switch (t.kind) {
    case 'quant':
      return P.quant;
    case 'logic':
      return LOGIC_PREC[t.op];
    case 'not':
      return P.not;
    case 'rel':
      return P.rel;
    case 'binop':
      return BINOP_PREC[t.op];
    case 'cross':
      return P.cross;
    case 'unop':
      return P.prefix;
    case 'num':
      return t.value < 0 ? P.prefix : P.atom;
    case 'apply':
      return P.apply;
    default:
      return P.atom;
  }
}

// ── printing ───────────────────────────────────────────────────────────────────

/**
 * Print a term in canonical unicode with single spaces around infix symbols and
 * only the parentheses that precedence requires (plus a few for readability:
 * quantifiers inside other operators, and `dom (f(x))`-style prefix operands).
 */
export function printTerm(t: Term): string {
  return pr(t, 0);
}

function pr(t: Term, min: number): string {
  const s = raw(t);
  return termPrec(t) < min ? `(${s})` : s;
}

function raw(t: Term): string {
  switch (t.kind) {
    case 'name':
      return t.name;
    case 'num':
      return formatNumber(t.value);
    case 'builtinSet':
      return t.set;
    case 'emptyset':
      return '∅';
    case 'bool':
      return t.value ? 'true' : 'false';
    case 'setDisplay':
      return t.elems.length === 0 ? '∅' : `{${t.elems.map((e) => pr(e, P.iff)).join(', ')}}`;
    case 'setComp': {
      let s = `{ ${t.decls.map(printBinding).join('; ')}`;
      if (t.pred) s += ` | ${pr(t.pred, P.iff)}`;
      if (t.expr) s += ` . ${pr(t.expr, P.iff)}`;
      return s + ' }';
    }
    case 'tuple':
      return `(${t.elems.map((e) => pr(e, P.iff)).join(', ')})`;
    case 'cross':
      return t.elems.map((e) => pr(e, P.cross + 1)).join(' × ');
    case 'apply': {
      const fn = t.fn.kind === 'name' || t.fn.kind === 'apply' ? pr(t.fn, P.apply) : `(${pr(t.fn, 0)})`;
      const arg = t.arg.kind === 'tuple' ? raw(t.arg) : `(${pr(t.arg, 0)})`;
      return fn + arg;
    }
    case 'unop': {
      // `dom (rx(p))` reads better than `dom rx(p)`, although both parse the same.
      const arg = t.arg.kind === 'apply' ? `(${raw(t.arg)})` : pr(t.arg, P.prefix);
      switch (t.op) {
        case 'dom':
        case 'ran':
        case 'ℙ':
          return `${t.op} ${arg}`;
        case '#':
          return `#${arg}`;
        case 'neg':
          // `-(3)` keeps unop-neg-of-literal distinct from the literal -3.
          return t.arg.kind === 'num' ? `-(${raw(t.arg)})` : `-${arg}`;
      }
      break;
    }
    case 'binop': {
      const p = BINOP_PREC[t.op];
      if (p === P.arrow) return `${pr(t.left, p + 1)} ${t.op} ${pr(t.right, p)}`; // right-assoc
      if (p === P.range) return `${pr(t.left, p + 1)} .. ${pr(t.right, p + 1)}`; // non-assoc
      return `${pr(t.left, p)} ${t.op} ${pr(t.right, p + 1)}`; // left-assoc
    }
    case 'rel': {
      // `(x ↦ y) ∈ R` reads better than the equivalent `x ↦ y ∈ R`.
      const side = (x: Term) => (x.kind === 'binop' && x.op === '↦' ? `(${raw(x)})` : pr(x, P.rel + 1));
      return `${side(t.left)} ${t.op} ${side(t.right)}`;
    }
    case 'not':
      return `¬ ${pr(t.arg, P.not)}`;
    case 'logic': {
      const p = LOGIC_PREC[t.op];
      if (t.op === '⇒') return `${pr(t.left, p + 1)} ⇒ ${pr(t.right, p)}`;
      return `${pr(t.left, p)} ${t.op} ${pr(t.right, p + 1)}`;
    }
    case 'quant': {
      let s = `${t.q} ${t.decls.map(printBinding).join('; ')}`;
      if (t.pred) s += ` | ${pr(t.pred, P.iff)}`;
      return `${s} . ${pr(t.body, 0)}`;
    }
  }
  return '?';
}

/**
 * A declaration: `x : T` in a schema's declaration part, `x, y ∈ S` (the tutorial's
 * notation) in quantifiers and set comprehensions.
 */
export function printVarDecl(d: VarDecl, sep: ':' | '∈' = ':'): string {
  return `${d.names.map((n) => n.name).join(', ')} ${sep} ${pr(d.type, P.arrow)}`;
}

/** The declarations of ∀ / ∃ / { … } are always printed with ∈. */
const printBinding = (d: VarDecl) => printVarDecl(d, '∈');

/** Print one line of a declaration part. */
export function printDecl(d: Decl): string {
  switch (d.kind) {
    case 'var':
      return printVarDecl(d, ':');
    case 'delta':
      return `Δ${d.schema}`;
    case 'xi':
      return `Ξ${d.schema}`;
    case 'include':
      return d.schema;
  }
}

// ── structure ──────────────────────────────────────────────────────────────────

/** Direct sub-terms (declaration types included), in source order. */
export function children(t: Term): Term[] {
  switch (t.kind) {
    case 'setDisplay':
    case 'tuple':
    case 'cross':
      return t.elems;
    case 'setComp':
      return [...t.decls.map((d) => d.type), ...(t.pred ? [t.pred] : []), ...(t.expr ? [t.expr] : [])];
    case 'quant':
      return [...t.decls.map((d) => d.type), ...(t.pred ? [t.pred] : []), t.body];
    case 'apply':
      return [t.fn, t.arg];
    case 'unop':
    case 'not':
      return [t.arg];
    case 'binop':
    case 'rel':
    case 'logic':
      return [t.left, t.right];
    default:
      return [];
  }
}

/**
 * Rebuild a term top-down: `f` may return a replacement for a node (which is then
 * used as is), or undefined to keep the node and map its children. Purely
 * structural — binders are not treated specially (use `substitute` for that).
 */
export function mapTerm(t: Term, f: (t: Term) => Term | undefined): Term {
  const r = f(t);
  if (r) return r;
  const m = (x: Term) => mapTerm(x, f);
  const md = (d: VarDecl): VarDecl => ({ ...d, type: m(d.type) });
  switch (t.kind) {
    case 'setDisplay':
    case 'tuple':
    case 'cross':
      return { ...t, elems: t.elems.map(m) };
    case 'setComp':
      return { ...t, decls: t.decls.map(md), pred: t.pred && m(t.pred), expr: t.expr && m(t.expr) };
    case 'quant':
      return { ...t, decls: t.decls.map(md), pred: t.pred && m(t.pred), body: m(t.body) };
    case 'apply':
      return { ...t, fn: m(t.fn), arg: m(t.arg) };
    case 'unop':
    case 'not':
      return { ...t, arg: m(t.arg) };
    case 'binop':
    case 'rel':
    case 'logic':
      return { ...t, left: m(t.left), right: m(t.right) };
    default:
      return t;
  }
}

/** Structural equality ignoring spans (and the ':' / '∈' spelling of declarations). */
export function termEquals(a: Term, b: Term): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'name':
      return a.name === (b as typeof a).name;
    case 'num':
      return a.value === (b as typeof a).value;
    case 'bool':
      return a.value === (b as typeof a).value;
    case 'builtinSet':
      return a.set === (b as typeof a).set;
    case 'emptyset':
      return true;
    case 'unop':
      return a.op === (b as typeof a).op && termEquals(a.arg, (b as typeof a).arg);
    case 'binop':
    case 'rel':
    case 'logic': {
      const bb = b as typeof a;
      return a.op === bb.op && termEquals(a.left, bb.left) && termEquals(a.right, bb.right);
    }
    case 'quant': {
      const bb = b as typeof a;
      return a.q === bb.q && declsEqual(a.decls, bb.decls) && optEq(a.pred, bb.pred) && termEquals(a.body, bb.body);
    }
    case 'setComp': {
      const bb = b as typeof a;
      return declsEqual(a.decls, bb.decls) && optEq(a.pred, bb.pred) && optEq(a.expr, bb.expr);
    }
    default: {
      const ca = children(a);
      const cb = children(b);
      return ca.length === cb.length && ca.every((c, i) => termEquals(c, cb[i]));
    }
  }
}

function optEq(a: Term | undefined, b: Term | undefined): boolean {
  return a === undefined || b === undefined ? a === b : termEquals(a, b);
}

function declsEqual(a: VarDecl[], b: VarDecl[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (d, i) =>
        d.names.length === b[i].names.length &&
        d.names.every((n, j) => n.name === b[i].names[j].name) &&
        termEquals(d.type, b[i].type),
    )
  );
}

/** Structural equality of declarations (ignoring spans). */
export function declEquals(a: Decl, b: Decl): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'var') return declsEqual([a], [b as VarDecl]);
  return a.schema === (b as typeof a).schema;
}

/**
 * Free identifiers of a term (decorated names like 'onLoan′', 'book?'). Given-set
 * names count as free identifiers too. Declarations are scoped sequentially:
 * in `∀ p ∈ S; d ∈ dom (rx p) . …` the second type may mention `p`.
 */
export function freeVars(t: Term): Set<string> {
  const out = new Set<string>();
  collectFree(t, new Set(), out);
  return out;
}

function collectFree(t: Term, bound: ReadonlySet<string>, out: Set<string>): void {
  if (t.kind === 'name') {
    if (!bound.has(t.name)) out.add(t.name);
    return;
  }
  if (t.kind === 'quant' || t.kind === 'setComp') {
    const b = new Set(bound);
    for (const d of t.decls) {
      collectFree(d.type, b, out);
      for (const n of d.names) b.add(n.name);
    }
    if (t.pred) collectFree(t.pred, b, out);
    if (t.kind === 'quant') collectFree(t.body, b, out);
    else if (t.expr) collectFree(t.expr, b, out);
    return;
  }
  for (const c of children(t)) collectFree(c, bound, out);
}

/** All identifiers occurring anywhere in a term (free or bound). */
function allNames(t: Term, out = new Set<string>()): Set<string> {
  if (t.kind === 'name') out.add(t.name);
  if (t.kind === 'quant' || t.kind === 'setComp') for (const d of t.decls) for (const n of d.names) out.add(n.name);
  for (const c of children(t)) allNames(c, out);
  return out;
}

/** Split a decorated name into base and decoration. */
export function splitName(name: string): { base: string; decoration: Decoration } {
  const last = name.slice(-1);
  if (last === '′' || last === '?' || last === '!') return { base: name.slice(0, -1), decoration: last };
  return { base: name, decoration: '' };
}

/** A name term (span defaults to 0..0 for synthesised terms). */
export function nameTerm(name: string, span: Span = { from: 0, to: 0 }): Term {
  return { kind: 'name', name, ...splitName(name), span };
}

type NameNode = Extract<Term, { kind: 'name' }>;

/** A pending replacement: how to build it from the occurrence, and its free variables. */
interface Replacement {
  make: (occurrence: NameNode) => Term;
  free: ReadonlySet<string>;
}

/**
 * Capture-avoiding substitution of free variables by terms. Bound variables that
 * would capture a free variable of an inserted term are renamed (x → x1).
 */
export function substitute(t: Term, sub: ReadonlyMap<string, Term>): Term {
  const s = new Map<string, Replacement>();
  for (const [k, r] of sub) s.set(k, { make: () => r, free: freeVars(r) });
  return subst(t, s);
}

/** Rename free variables (e.g. {onLoan: 'onLoan′'}), respecting binders; spans are kept. */
export function rename(t: Term, map: ReadonlyMap<string, string> | Record<string, string>): Term {
  const entries: [string, string][] = map instanceof Map ? [...map] : Object.entries(map);
  const s = new Map<string, Replacement>();
  for (const [k, v] of entries) {
    s.set(k, { make: (occ) => ({ ...occ, name: v, ...splitName(v) }), free: new Set([v]) });
  }
  return subst(t, s);
}

/** Prime the given state variables: `x` → `x′` (free occurrences only). */
export function primeTerm(t: Term, stateVars: Iterable<string>): Term {
  const map = new Map<string, string>();
  for (const v of stateVars) map.set(v, v + '′');
  return rename(t, map);
}

function subst(t: Term, s: ReadonlyMap<string, Replacement>): Term {
  if (s.size === 0) return t;
  switch (t.kind) {
    case 'name': {
      const r = s.get(t.name);
      return r ? r.make(t) : t;
    }
    case 'quant':
    case 'setComp':
      return substBinder(t, s);
    default:
      return mapTerm(t, (c) => (c === t ? undefined : subst(c, s)));
  }
}

function substBinder(t: Extract<Term, { kind: 'quant' | 'setComp' }>, sub: ReadonlyMap<string, Replacement>): Term {
  // Only replacements for variables that actually occur free here matter.
  const free = freeVars(t);
  const s = new Map([...sub].filter(([k]) => free.has(k)));
  if (s.size === 0) return t;
  const avoid = allNames(t);
  for (const r of s.values()) for (const n of r.free) avoid.add(n);

  const decls: VarDecl[] = [];
  for (const d of t.decls) {
    const type = subst(d.type, s);
    const names = d.names.map((n) => {
      s.delete(n.name); // the binder shadows outer replacements
      const captures = [...s.values()].some((r) => r.free.has(n.name));
      if (!captures) return n;
      // Rename the bound variable so the inserted term keeps its meaning.
      const fresh = freshName(n.name, avoid);
      avoid.add(fresh);
      s.set(n.name, { make: (occ) => ({ ...occ, name: fresh, ...splitName(fresh) }), free: new Set([fresh]) });
      return { ...n, name: fresh, ...splitName(fresh) };
    });
    decls.push({ ...d, type, names });
  }
  const pred = t.pred && subst(t.pred, s);
  if (t.kind === 'quant') return { ...t, decls, pred, body: subst(t.body, s) };
  return { ...t, decls, pred, expr: t.expr && subst(t.expr, s) };
}

function freshName(name: string, avoid: ReadonlySet<string>): string {
  const { base, decoration } = splitName(name);
  for (let i = 1; ; i++) {
    const n = `${base}${i}${decoration}`;
    if (!avoid.has(n)) return n;
  }
}
