// Statements about functions in relational form, as step goals write them:
//
//   ∀ a ∈ dom owner; p₁, p₂ ∈ ran owner . (a ↦ p₁) ∈ owner ∧ (a ↦ p₂) ∈ owner ⇒ p₁ = p₂
//   ∀ t₁, t₂ ∈ dom at; b ∈ ran at . (t₁ ↦ b) ∈ at ∧ (t₂ ↦ b) ∈ at ⇒ t₁ = t₂
//
// For a function f (declared ⇸ or →), (x ↦ y) ∈ f says y = f(x). A bound y is replaced
// by f(x) everywhere; other pairs become equations f(x) = t. What is left is either
// trivial (f(x) = f(x): f is a function) or a simpler statement, e.g. the injectivity
// invariant ∀ t₁, t₂ ∈ dom at . at(t₁) = at(t₂) ⇒ t₁ = t₂, to be found among the known
// facts. Each step only strengthens the statement (the assumption x ∈ dom f is dropped,
// a conclusion (x ↦ t) ∉ f becomes f(x) ≠ t, other assumptions may be dropped), so
// proving the rest proves the goal.

import type { Term, VarDecl } from '../ast';
import { freeVars, substitute } from '../print';
import { conjuncts, mk, pairParts, SPAN0, view } from './terms';

export interface FnReduction {
  /** The functions whose declaration was used. */
  used: string[];
  /** The goal follows from the declarations alone. */
  trivial: boolean;
  /**
   * Otherwise: equivalent ways to write what is left to prove (binder domains x ∈ dom f
   * where (x ↦ …) ∈ f was assumed, and the binders in any order).
   */
  rest: Term[];
}

interface Binder {
  name: string;
  dom: Term;
}

const MAX_BINDERS = 4;

/** Reduce a ∀ goal by the functions it pairs with (null if nothing applies). */
export function reduceByFunctions(goal: Term, isFunction: (name: string) => boolean): FnReduction | null {
  if (goal.kind !== 'quant' || goal.q !== '∀') return null;
  let binders: Binder[] = goal.decls.flatMap((d) => d.names.map((n) => ({ name: n.name, dom: d.type })));
  if (binders.length > MAX_BINDERS) return null;
  const body: Term = goal.pred ? { kind: 'logic', op: '⇒', left: goal.pred, right: goal.body, span: SPAN0 } : goal.body;
  if (body.kind !== 'logic' || body.op !== '⇒') return null;
  let queue = conjuncts(body.left);
  let concl = body.right;
  const kept: Term[] = [];
  const used = new Set<string>();
  const alt = new Map<string, Term>();
  while (queue.length) {
    const c = queue.shift()!;
    const v = view(c);
    const pp = v?.k === 'mem' ? pairParts(v.x) : null;
    if (!pp || v?.k !== 'mem' || v.s.kind !== 'name' || !isFunction(v.s.name)) {
      kept.push(c);
      continue;
    }
    const f = v.s;
    const [x, y] = pp;
    used.add(f.name);
    if (x.kind === 'name' && binders.some((b) => b.name === x.name)) alt.set(x.name, mk.unop('dom', f));
    const app: Term = { kind: 'apply', fn: f, arg: x, span: SPAN0 };
    const yb = y.kind === 'name' ? binders.find((b) => b.name === y.name) : undefined;
    if (yb && !freeVars(x).has(yb.name) && !binders.some((b) => freeVars(b.dom).has(yb.name))) {
      const sub = new Map([[yb.name, app]]);
      binders = binders.filter((b) => b !== yb);
      queue = queue.map((t) => substitute(t, sub));
      kept.splice(0, kept.length, ...kept.map((t) => substitute(t, sub)));
      concl = substitute(concl, sub);
    } else kept.push(mk.rel('=', app, y));
  }
  if (!used.size) return null;
  // a conclusion about a pair of a function: about its value
  const cv = view(concl);
  const cp = cv && (cv.k === 'mem' || cv.k === 'notmem') ? pairParts(cv.x) : null;
  if (cp && cv && (cv.k === 'mem' || cv.k === 'notmem') && cv.s.kind === 'name' && isFunction(cv.s.name)) {
    used.add(cv.s.name);
    concl = mk.rel(cv.k === 'mem' ? '=' : '≠', { kind: 'apply', fn: cv.s, arg: cp[0], span: SPAN0 }, cp[1]);
  }
  const ck = concl.kind === 'rel' && concl.op === '=' ? [concl.left, concl.right] : null;
  if (ck && sameText(ck[0], ck[1])) return { used: [...used], trivial: true, rest: [] };
  const rest: Term[] = [];
  for (const order of orders(binders)) {
    for (const doms of domainChoices(order, alt)) {
      const bs = order.map((b, i) => ({ ...b, dom: doms[i] }));
      rest.push(build(bs, kept, concl));
      // without the remaining assumptions (a stronger statement)
      if (kept.length) rest.push(build(bs, [], concl));
    }
  }
  return { used: [...used], trivial: false, rest };
}

function build(binders: Binder[], ante: Term[], concl: Term): Term {
  const body: Term = ante.length
    ? { kind: 'logic', op: '⇒', left: ante.reduce((a, b) => ({ kind: 'logic', op: '∧', left: a, right: b, span: SPAN0 })), right: concl, span: SPAN0 }
    : concl;
  if (!binders.length) return body;
  const decls: VarDecl[] = binders.map((b) => ({
    kind: 'var',
    names: [{ name: b.name, base: b.name, decoration: '', span: SPAN0 }],
    type: b.dom,
    span: SPAN0,
    sep: '∈',
  }));
  return { kind: 'quant', q: '∀', decls, body, span: SPAN0 };
}

/** The binders in every order (when no domain depends on another binder). */
function orders(bs: Binder[]): Binder[][] {
  if (bs.some((b) => bs.some((c) => freeVars(b.dom).has(c.name)))) return [bs];
  if (bs.length <= 1) return [bs];
  return bs.flatMap((b, i) => orders([...bs.slice(0, i), ...bs.slice(i + 1)]).map((rest) => [b, ...rest]));
}

/** Each binder's domain as written or, where available, dom f. */
function domainChoices(bs: Binder[], alt: Map<string, Term>): Term[][] {
  let out: Term[][] = [[]];
  for (const b of bs) {
    const a = alt.get(b.name);
    out = out.flatMap((ds) => (a ? [[...ds, b.dom], [...ds, a]] : [[...ds, b.dom]]));
  }
  return out;
}

const sameText = (a: Term, b: Term) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));
const strip = (t: unknown): unknown =>
  Array.isArray(t) ? t.map(strip) : t && typeof t === 'object' ? Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'span').map(([k, v]) => [k, strip(v)])) : t;
