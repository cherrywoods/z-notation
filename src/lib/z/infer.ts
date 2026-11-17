// Rule-based inference for the "Inference" panel and the redundancy marks in the
// editor. Everything here is conservative: a fact is only reported when it follows
// by sound laws, and every fact comes with its derivation in the style of the
// lecture slides (example: a library with onLoan = dom borrower and an operation
// Lend that adds book? ↦ member? to borrower):
//
//   onLoan′ = dom borrower′                         [invariant after]
//           = dom (borrower ∪ {book? ↦ member?})    [spec of Lend]
//           = dom borrower ∪ dom {book? ↦ member?}  [fact about dom]
//           = dom borrower ∪ {book?}                [fact about dom]
//           = onLoan ∪ {book?}                      [invariant before]
//
// Facts:
//   'effect'     Δ operations: v′ = e for state variables the operation does not set
//   'unchanged'  Ξ operations: v′ = v; Δ operations: v′ = v for unmentioned variables
//   'guaranteed' Δ operations: what the invariant after demands where the state changes
//   'defined'    x ∈ dom f for applications f(x) (text `x ∈ dom f`)
//   'initial'    values implied by Init + invariant (onLoan = ∅ ⇒ borrower = ∅)
//
// Redundant predicates (only own lines; the later of two lines that imply each other):
//   duplicates, lines of the state invariant, Ξ equalities, consequences of the
//   declarations, after-state equations that the invariant derives from the other
//   lines (the chain above), memberships / inclusions that follow from the other
//   lines (preconditions only from preconditions + the invariant before — never
//   from the after state), Init values implied by the other Init lines.

import type { Derivation, SchemaDoc, SpecDoc, ZDiagnostic } from '../spec/model';
import type { Span, Term } from './ast';
import type { Analysis, PredInfo, SchemaInfo } from './index';
import { children, freeVars, printTerm, rename, substitute } from './print';
import type { InferenceResult, InferredFact } from './results';
import { Prover, declPremise, dedupe, premiseOf, type Atom, type Premise, type PremiseSource } from './infer/prove';
import { reduceByFunctions } from './infer/functions';
import { lex } from './lexer';
import { parseTerm } from './parser';
import { simplify, type Law, type LawEnv } from './infer/rewrite';
import { conjuncts, containsKey, eqSide, isEmptySet, key, mentions, mk, pairParts, replaceSub, view } from './infer/terms';
import { determinations, frozenVars } from './frame';

export interface InferOptions {
  /** Rethrow internal errors instead of skipping the schema (tests). */
  strict?: boolean;
}

export function infer(spec: SpecDoc, an: Analysis, opts: InferOptions = {}): InferenceResult {
  const facts: InferredFact[] = [];
  const redundant: ZDiagnostic[] = [];
  const docs = new Map<string, SchemaDoc>();
  for (const d of [spec.state, ...(spec.init ? [spec.init] : []), ...spec.operations]) docs.set(d.id, d);
  for (const s of an.schemas) {
    if (!s.ok) continue;
    try {
      const ctx = context(an, s, docs.get(s.id));
      if (s.role === 'init' && !ctx.initNames) continue;
      if (s.role === 'operation' && !s.imports) continue;
      const f = s.role === 'init' ? initFacts(ctx) : s.role === 'operation' ? opFacts(ctx) : forcedFacts(ctx);
      const r = redundancy(ctx);
      facts.push(...f);
      redundant.push(...r);
    } catch (e) {
      if (opts.strict) throw e;
      // never throw: skip this schema
    }
  }
  return { facts, redundant };
}

// ── context ────────────────────────────────────────────────────────────────────

interface Line {
  /** Ordinal among the schema's own (well-typed) predicates. */
  i: number;
  term: Term;
  info: PredInfo;
  conj: Term[];
}

interface Ctx {
  s: SchemaInfo;
  doc: SchemaDoc | undefined;
  stateName: string;
  stateVars: string[];
  /** After-state variables (onLoan′, …). */
  primed: Set<string>;
  /** Names that make a predicate a postcondition: after-state variables and outputs. */
  post: Set<string>;
  decls: Map<string, Term>;
  given: Set<string>;
  lines: Line[];
  /** Conjuncts of the state invariant (unprimed / primed copy) as seen in this schema. */
  inv: Term[];
  invP: Term[];
  xi: Term[];
  /** `v′ = v` for the state variables a Δ operation does not mention. */
  frame: Term[];
  /** How the state is imported: 'ΔLibrary', 'ΞLibrary', 'Library'. */
  importText: string;
  /** Init: the state variables as named in Init (primed if it imports State′). */
  initNames: string[] | null;
}

function context(an: Analysis, s: SchemaInfo, doc: SchemaDoc | undefined): Ctx {
  const S = an.stateName;
  const stateVars = an.stateVars;
  const primed = new Set(stateVars.map((v) => v + '′'));
  const outputs = s.vars.filter((v) => v.role === 'output').map((v) => v.name);
  const conjOf = (origin: PredInfo['origin']) =>
    s.preds.filter((p) => p.origin === origin && p.ok).flatMap((p) => conjuncts(p.term));
  const lines = s.preds
    .filter((p) => p.origin === 'own' && p.ok)
    .map((info, i) => ({ i, term: info.term, info, conj: conjuncts(info.term) }));
  let initNames: string[] | null = null;
  if (s.role === 'init') {
    initNames = s.initImport === 'unprimed' ? [...stateVars] : s.initImport === 'primed' ? [...primed] : null;
  }
  return {
    s,
    doc,
    stateName: S,
    stateVars,
    primed,
    post: new Set([...primed, ...outputs]),
    decls: new Map(s.vars.map((v) => [v.name, v.declared])),
    given: new Set(an.givenSets),
    lines,
    inv: conjOf('invariant'),
    invP: conjOf('invariant′'),
    xi: s.preds.filter((p) => p.origin === 'xi').map((p) => p.term),
    frame: s.preds.filter((p) => p.origin === 'frame').map((p) => p.term),
    importText: s.role === 'operation' ? `${s.imports ?? ''}${S}` : s.role === 'init' ? (s.initImport === 'primed' ? `${S}′` : S) : '',
    initNames,
  };
}

const isPre = (ctx: Ctx, t: Term) => !mentions(t, ctx.post);

function ownReason(ctx: Ctx, conj: Term): string {
  if (ctx.s.role === 'state') return 'invariant';
  if (ctx.s.role === 'init') return 'Init';
  return isPre(ctx, conj) ? 'precondition' : `spec of ${ctx.s.name}`;
}

/** Atoms from own lines; `preOnly`: only conjuncts without after-state / output variables. */
function ownAtoms(ctx: Ctx, lines: Line[], preOnly = false): Atom[] {
  return lines.flatMap((l) =>
    l.conj.filter((c) => !preOnly || isPre(ctx, c)).map((c) => ({ term: c, reason: ownReason(ctx, c), src: 'own' as const })),
  );
}

function invAtoms(ctx: Ctx, primed: boolean): Atom[] {
  const reason = ctx.s.role === 'operation' ? (primed ? 'invariant after' : 'invariant before') : 'invariant';
  return (primed ? ctx.invP : ctx.inv).map((term) => ({ term, reason, src: 'inv' as const }));
}

function xiAtoms(ctx: Ctx): Atom[] {
  return [
    ...ctx.xi.map((term) => ({ term, reason: `Ξ${ctx.stateName}`, src: 'xi' as const })),
    ...ctx.frame.map((term) => ({ term, reason: NOT_MENTIONED, src: 'frame' as const })),
  ];
}

const NOT_MENTIONED = 'not mentioned';

/** Functions (⇸, →) for the law dom (f ∖ {a ↦ f(a)}) = dom f ∖ {a}. */
function lawEnv(ctx: Ctx): LawEnv {
  return {
    isFunction: (name) => {
      const d = ctx.decls.get(name);
      return !!d && d.kind === 'binop' && (d.op === '⇸' || d.op === '→');
    },
  };
}

const strip = (ps: Premise[]) => ps.map(({ text, reason }) => ({ text, reason }));
const lawPremise = (statement: string, reason: string): Premise => ({ text: statement, reason, src: 'law' });

// ── operations: effect, unchanged, defined ─────────────────────────────────────

interface Def {
  e: Term;
  /** The own conjunct `v′ = e`, printed. */
  text: string;
  /** Bracket text when it is not the operation's own line ('not mentioned'). */
  reason?: string;
}

/** `v′ = v` for the variables the operation does not mention, as definitions. */
function frameDefs(ctx: Ctx, defs: Map<string, Def>): Map<string, Def> {
  const all = new Map(defs);
  for (const t of ctx.frame) {
    if (t.kind === 'rel' && t.left.kind === 'name' && !all.has(t.left.name)) {
      all.set(t.left.name, { e: t.right, text: printTerm(t), reason: NOT_MENTIONED });
    }
  }
  return all;
}

/** Own conjuncts `v′ = e` (e without after-state variables), first one per variable. */
function explicitDefs(ctx: Ctx, lines: Line[]): Map<string, Def> {
  const defs = new Map<string, Def>();
  for (const l of lines) {
    for (const c of l.conj) {
      if (c.kind !== 'rel' || c.op !== '=') continue;
      for (const [lhs, rhs] of [
        [c.left, c.right],
        [c.right, c.left],
      ]) {
        if (lhs.kind === 'name' && ctx.primed.has(lhs.name) && !mentions(rhs, ctx.primed) && !defs.has(lhs.name)) {
          defs.set(lhs.name, { e: rhs, text: printTerm(c) });
        }
      }
    }
  }
  return defs;
}

interface Step {
  rel: '=' | '⇔';
  expr: string;
  reason: string;
  term: Term;
}

interface Effect {
  start: string;
  steps: Step[];
  result: Term;
  /** Explicit definitions substituted into the chain. */
  used: Def[];
}

/**
 * Derive `v′ = e` (e without after-state variables): an equation for v′ from the
 * invariant after, substitution of the explicitly specified after-state variables,
 * simplification, folding back with the invariant before.
 */
function deriveEffect(ctx: Ctx, vP: string, defs: Map<string, Def>): Effect | null {
  for (const c of ctx.invP) {
    const e0 = eqSide(c, vP);
    if (!e0 || freeVars(e0).has(vP)) continue;
    const steps: Step[] = [];
    const push = (term: Term, reason: string) => steps.push({ rel: '=', expr: printTerm(term), reason, term });
    push(e0, 'invariant after');
    let cur = e0;
    const sub = new Map<string, Term>();
    const used: Def[] = [];
    for (const n of freeVars(cur)) {
      const d = defs.get(n);
      if (d && n !== vP) {
        sub.set(n, d.e);
        used.push(d);
      }
    }
    if (sub.size) {
      cur = substitute(cur, sub);
      push(cur, [...new Set(used.map((d) => d.reason ?? `spec of ${ctx.s.name}`))].join(', '));
    }
    for (const st of simplify(cur, lawEnv(ctx))) {
      cur = st.term;
      push(cur, st.law.reason);
    }
    if (mentions(cur, ctx.primed)) continue;
    cur = foldBack(ctx, cur, push);
    return { start: vP, steps, result: cur, used };
  }
  return null;
}

/** Replace `e` by `w` wherever the invariant before says `w = e` (e.g. dom borrower → onLoan). */
function foldBack(ctx: Ctx, t: Term, push: (t: Term, reason: string) => void): Term {
  let cur = t;
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const c of ctx.inv) {
      if (c.kind !== 'rel' || c.op !== '=') continue;
      for (const [w, F] of [
        [c.left, c.right],
        [c.right, c.left],
      ]) {
        if (w.kind !== 'name' || !ctx.stateVars.includes(w.name) || F.kind === 'name') continue;
        const fv = freeVars(F);
        if (fv.has(w.name) || !ctx.stateVars.some((v) => fv.has(v))) continue;
        const r = replaceSub(cur, key(F), mk.name(w.name));
        if (r) {
          cur = r;
          push(cur, 'invariant before');
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return cur;
}

function chainOf(start: string, steps: Step[]): Derivation {
  return { kind: 'chain', start, steps: steps.map(({ rel, expr, reason }) => ({ rel, expr, reason })) };
}

function opFacts(ctx: Ctx): InferredFact[] {
  const out: InferredFact[] = [];
  const schemaId = ctx.s.id;
  if (ctx.s.imports === 'Ξ') {
    for (const v of ctx.stateVars) {
      out.push({
        schemaId,
        kind: 'unchanged',
        text: `${v}′ = ${v}`,
        derivation: { kind: 'chain', start: `${v}′`, steps: [{ rel: '=', expr: v, reason: `Ξ${ctx.stateName}` }] },
      });
    }
  }
  if (ctx.s.imports === 'Δ' && ctx.frame.length) {
    const text = printTerm(ctx.frame.reduce((a, b) => ({ kind: 'logic', op: '∧', left: a, right: b, span: a.span })));
    out.push({
      schemaId,
      kind: 'unchanged',
      text,
      derivation: { kind: 'facts', premises: ctx.frame.map((t) => ({ text: printTerm(t), reason: NOT_MENTIONED })), conclusion: text },
    });
  }
  if (ctx.s.imports === 'Δ') {
    const defs = frameDefs(ctx, explicitDefs(ctx, ctx.lines));
    for (const v of ctx.stateVars) {
      const vP = v + '′';
      if (defs.has(vP)) continue;
      const eff = deriveEffect(ctx, vP, defs);
      if (!eff) continue;
      out.push({
        schemaId,
        kind: 'effect',
        text: printTerm(mk.rel('=', mk.name(vP), eff.result)),
        derivation: chainOf(vP, eff.steps),
      });
    }
  }
  out.push(...definedFacts(ctx));
  if (ctx.s.imports === 'Δ') out.push(...guaranteedFacts(ctx));
  return out;
}

/** Applications f(x) with f a name and no bound variables in f(x). */
function collectApps(t: Term, bound: ReadonlySet<string>, out: Extract<Term, { kind: 'apply' }>[]): void {
  if (t.kind === 'apply' && t.fn.kind === 'name' && ![...freeVars(t)].some((n) => bound.has(n))) out.push(t);
  if (t.kind === 'quant' || t.kind === 'setComp') {
    const b = new Set(bound);
    for (const d of t.decls) {
      collectApps(d.type, b, out);
      for (const n of d.names) b.add(n.name);
    }
    if (t.pred) collectApps(t.pred, b, out);
    if (t.kind === 'quant') collectApps(t.body, b, out);
    else if (t.expr) collectApps(t.expr, b, out);
    return;
  }
  for (const c of children(t)) collectApps(c, bound, out);
}

function definedFacts(ctx: Ctx): InferredFact[] {
  const apps: Extract<Term, { kind: 'apply' }>[] = [];
  for (const l of ctx.lines) collectApps(l.term, new Set(), apps);
  const out: InferredFact[] = [];
  const seen = new Set<string>();
  for (const app of apps) {
    const dom = mk.unop('dom', app.fn);
    const goal = mk.rel('∈', app.arg, dom);
    const gk = key(goal);
    if (seen.has(gk)) continue;
    seen.add(gk);
    // Premises: the preconditions and the invariant before (plus the after state if
    // the application itself is about it), never a line that uses f(x) itself.
    const after = mentions(app, ctx.post);
    const ak = key(app);
    const atoms = [
      ...ownAtoms(ctx, ctx.lines, !after).filter((a) => !containsKey(a.term, ak)),
      ...invAtoms(ctx, false),
      ...(after ? [...invAtoms(ctx, true), ...xiAtoms(ctx)] : []),
    ];
    const proof = new Prover({ atoms, decls: ctx.decls, givenSets: ctx.given, laws: lawEnv(ctx) }).mem(app.arg, dom);
    if (!proof || proof.length === 0) continue;
    const text = printTerm(goal);
    const premises = explainForced(ctx, proof).premises;
    out.push({ schemaId: ctx.s.id, kind: 'defined', text, derivation: { kind: 'facts', premises: strip(premises), conclusion: text } });
  }
  return out;
}

// ── guarantees: what the invariant after demands where the state changes ──────
//
// A Δ operation must keep the invariant. Where it changes the state, the invariant
// after therefore imposes a condition on the before-state and inputs — an implicit
// precondition. Two shapes, with sound steps only:
//
//   ∀ x ∈ dom f′ . P (or ∀ x ∈ S′ . P), and the operation sets f′(x₀) = e (or adds x₀
//   to S′): P at x₀, with f′(x₀) = e and the unchanged variables put in.
//
//   an invariant without ∀ (prescribed′ ∩ allergic′ = ∅): put in the new values, split
//   along ∪ / displays (each step an equivalence) and drop what the invariant before
//   already says. What remains is the condition.

interface Known {
  /** What the primed variable equals, and the premise saying so. */
  e: Term;
  premise: Premise;
}
interface Point {
  /** The primed variable (f′ or S′). */
  v: string;
  x: Term;
  /** f′(x) = e, for a function; undefined for a set S′ that gets the element x. */
  e?: Term;
  /** Where the point comes from. */
  premise: Premise;
}

const SPAN = { from: 0, to: 0 };
const unionOperands = (t: Term): Term[] => (t.kind === 'binop' && t.op === '∪' ? [...unionOperands(t.left), ...unionOperands(t.right)] : [t]);
const andOf = (ts: Term[]): Term => ts.reduce((a, b) => ({ kind: 'logic', op: '∧', left: a, right: b, span: SPAN }));
const apply = (fn: string, arg: Term): Term => ({ kind: 'apply', fn: mk.name(fn), arg, span: SPAN });

/** The after-state values the operation fixes: whole variables and single points. */
function afterState(ctx: Ctx): { whole: Map<string, Known>; points: Point[] } {
  const spec = `spec of ${ctx.s.name}`;
  const whole = new Map<string, Known>();
  for (const [v, d] of explicitDefs(ctx, ctx.lines)) whole.set(v, { e: d.e, premise: { text: d.text, reason: spec, src: 'own' } });
  for (const t of [...ctx.frame, ...ctx.xi]) {
    if (t.kind !== 'rel' || t.left.kind !== 'name' || whole.has(t.left.name)) continue;
    const reason = ctx.frame.includes(t) ? NOT_MENTIONED : `Ξ${ctx.stateName}`;
    whole.set(t.left.name, { e: t.right, premise: { text: printTerm(t), reason, src: 'frame' } });
  }
  // effects the invariant determines (onLoan′ = onLoan ∪ {book?}), as in the effect facts
  const defs = frameDefs(ctx, explicitDefs(ctx, ctx.lines));
  for (const v of ctx.stateVars) {
    const vP = v + '′';
    if (whole.has(vP)) continue;
    const eff = deriveEffect(ctx, vP, defs);
    if (eff) whole.set(vP, { e: eff.result, premise: { text: printTerm(mk.rel('=', mk.name(vP), eff.result)), reason: 'effect', src: 'inv' } });
  }
  const points: Point[] = [];
  const env = lawEnv(ctx);
  for (const [v, w] of whole) {
    for (const op of unionOperands(w.e)) {
      if (op.kind !== 'setDisplay') continue;
      for (const el of op.elems) {
        const pp = pairParts(el);
        // f′ = A ∪ {x ↦ e} with f′ a function: (x ↦ e) ∈ f′, so f′(x) = e and x ∈ dom f′
        if (pp && env.isFunction(v.slice(0, -1))) points.push({ v, x: pp[0], e: pp[1], premise: w.premise });
        else if (!pp) points.push({ v, x: el, premise: w.premise });
      }
    }
  }
  // lines f′(x) = e (pointwise updates)
  for (const l of ctx.lines) {
    for (const c of l.conj) {
      if (c.kind !== 'rel' || c.op !== '=') continue;
      for (const [a, e] of [
        [c.left, c.right],
        [c.right, c.left],
      ]) {
        if (a.kind === 'apply' && a.fn.kind === 'name' && ctx.primed.has(a.fn.name) && !mentions(e, ctx.primed) && !mentions(a.arg, ctx.primed)) {
          points.push({ v: a.fn.name, x: a.arg, e, premise: { text: printTerm(c), reason: spec, src: 'own' } });
        }
      }
    }
  }
  return { whole, points };
}

/**
 * Replace the after-state variables of `t` by what the operation says about them
 * (values at points first, then whole variables); null if some remain open.
 */
function intoBefore(ctx: Ctx, t: Term, after: ReturnType<typeof afterState>, used: Premise[]): Term | null {
  let cur = t;
  for (const p of after.points) {
    if (!p.e) continue;
    const app = apply(p.v, p.x);
    const r = replaceSub(cur, key(app), p.e);
    if (!r) continue;
    cur = r;
    used.push({ text: printTerm(mk.rel('=', app, p.e)), reason: p.premise.reason, src: p.premise.src });
  }
  for (const n of freeVars(cur)) {
    if (!ctx.primed.has(n)) continue;
    const w = after.whole.get(n);
    if (!w) return null;
    // an unchanged function used at single points: show f′(x) = f(x) rather than f′ = f
    const apps: Term[] = [];
    collectApps(cur, new Set(), apps as Extract<Term, { kind: 'apply' }>[]);
    const atN = apps.filter((a) => a.kind === 'apply' && a.fn.kind === 'name' && a.fn.name === n);
    const unchanged = w.e.kind === 'name' && w.e.name + '′' === n;
    cur = substitute(cur, new Map([[n, w.e]]));
    if (unchanged && atN.length && !mentionsBare(t, n)) {
      for (const a of atN) {
        if (a.kind !== 'apply') continue;
        const text = printTerm(mk.rel('=', a, apply(w.e.kind === 'name' ? w.e.name : n, a.arg)));
        used.push({ text, reason: 'unchanged', src: w.premise.src });
      }
    } else used.push(w.premise);
  }
  return mentions(cur, ctx.primed) ? null : cur;
}

/** Does `name` occur other than as the function of an application? */
function mentionsBare(t: Term, name: string): boolean {
  if (t.kind === 'name') return t.name === name;
  if (t.kind === 'apply' && t.fn.kind === 'name' && t.fn.name === name) return mentionsBare(t.arg, name);
  return children(t).some((c) => mentionsBare(c, name));
}

function guaranteedFacts(ctx: Ctx): InferredFact[] {
  const after = afterState(ctx);
  const out: InferredFact[] = [];
  const seen = new Set<string>();
  const add = (text: string, derivation: Derivation) => {
    if (seen.has(text)) return;
    seen.add(text);
    out.push({ schemaId: ctx.s.id, kind: 'guaranteed', text, derivation });
  };
  const invBefore = new Set(ctx.inv.map(key));

  for (const c of ctx.invP) {
    if (!mentions(c, ctx.primed)) continue;
    if (c.kind === 'quant') {
      // ∀ x ∈ D . P (one variable), taken at a point where the operation changes the state
      if (c.q !== '∀' || c.decls.length !== 1 || c.decls[0].names.length !== 1) continue;
      const x = c.decls[0].names[0].name;
      const D = c.decls[0].type;
      const body: Term = c.pred ? { kind: 'logic', op: '⇒', left: c.pred, right: c.body, span: SPAN } : c.body;
      for (const { p, at } of quantPoints(ctx, after, x, D, body)) {
        const used: Premise[] = [];
        const res = intoBefore(ctx, substitute(body, new Map([[x, p.x]])), after, used);
        if (!res || invBefore.has(key(res))) continue;
        // split along ∪ / displays and drop what the invariant before already says there
        const known = beforeAt(ctx, p.x);
        const simple = splitAndDrop(res, known, beforeProver(ctx));
        if (!simple) continue;
        const text = printTerm(simple.result);
        const premises: Premise[] = [{ text: printTerm(c), reason: 'invariant after', src: 'inv' }, at, ...used];
        if (simple.changed) premises.push({ text: printTerm(res), reason: `so, at ${printTerm(p.x)}`, src: 'inv' }, ...simple.dropped);
        add(text, { kind: 'facts', premises: strip(dedupe(premises)), conclusion: text });
      }
      continue;
    }
    // an invariant without ∀: put in the after state, split, drop the invariant before
    const used: Premise[] = [];
    const sub = intoBefore(ctx, c, { whole: after.whole, points: [] }, used);
    if (!sub || invBefore.has(key(sub))) continue;
    const steps: Step[] = [];
    const push = (term: Term, reason: string) => steps.push({ rel: '⇔', expr: printTerm(term), reason, term });
    push(sub, [...new Set(used.map((u) => u.reason))].join(', '));
    let cur = sub;
    for (const st of simplify(cur, lawEnv(ctx))) {
      cur = st.term;
      push(cur, st.law.reason);
    }
    let list = conjuncts(cur);
    let split = false;
    for (let round = 0; round < 6; round++) {
      let reason: string | null = null;
      const next: Term[] = [];
      for (const t of list) {
        const r = splitStep(t);
        if (r) {
          next.push(...r.parts);
          reason = r.reason;
          split = true;
        } else next.push(t);
      }
      if (!reason) break;
      list = next;
      push(andOf(list), reason);
    }
    if (!split) continue;
    const fromBefore = beforeProver(ctx);
    const kept = list.filter((t) => !invBefore.has(key(t)) && !followsFrom(fromBefore, t));
    if (!kept.length || mentions(andOf(kept), ctx.primed)) continue;
    if (kept.length < list.length) push(andOf(kept), 'invariant before');
    const text = printTerm(andOf(kept));
    add(text, { kind: 'chain', start: printTerm(c), steps: steps.map(({ rel, expr, reason }) => ({ rel, expr, reason })) });
  }
  return out;
}

/**
 * The points at which to take `∀ x ∈ D . P`, with the premise that the point is in D:
 * points where the operation changes D itself (dom f′ / S′), and points where it changes
 * a function the body applies at x, if the point is in D by the preconditions, the
 * invariant before and the unchanged variables.
 */
function quantPoints(ctx: Ctx, after: ReturnType<typeof afterState>, x: string, D: Term, body: Term): { p: Point; at: Premise }[] {
  const out: { p: Point; at: Premise }[] = [];
  const seen = new Set<string>();
  const onDom = D.kind === 'unop' && D.op === 'dom' && D.arg.kind === 'name' && ctx.primed.has(D.arg.name);
  const target = onDom ? (D as Extract<Term, { kind: 'unop' }>).arg : D;
  const atText = (p: Point) => printTerm(mk.rel('∈', p.x, D));
  if (target.kind === 'name' && ctx.primed.has(target.name)) {
    for (const p of after.points) {
      if (p.v !== target.name || (onDom ? !p.e : !!p.e) || seen.has(key(p.x))) continue;
      seen.add(key(p.x));
      out.push({ p, at: { text: atText(p), reason: p.premise.reason, src: p.premise.src } });
    }
  }
  const applied = new Set<string>();
  const apps: Extract<Term, { kind: 'apply' }>[] = [];
  collectApps(body, new Set(), apps);
  for (const a of apps) if (a.fn.kind === 'name' && a.arg.kind === 'name' && a.arg.name === x) applied.add(a.fn.name);
  let prover: Prover | null = null;
  for (const p of after.points) {
    if (!p.e || !applied.has(p.v) || seen.has(key(p.x))) continue;
    prover ??= new Prover({
      atoms: [...ownAtoms(ctx, ctx.lines), ...invAtoms(ctx, false), ...xiAtoms(ctx)],
      decls: ctx.decls,
      givenSets: ctx.given,
      laws: lawEnv(ctx),
    });
    const proof = prover.mem(p.x, D);
    if (!proof) continue;
    seen.add(key(p.x));
    const reason = proof.map((q) => `${q.text} (${q.src === 'frame' ? 'unchanged' : q.reason})`).join(', ') || 'by its type';
    out.push({ p, at: { text: atText(p), reason, src: 'own' } });
  }
  return out;
}

/** A prover over the invariant before only (what is already true, not what the operation demands). */
const beforeProver = (ctx: Ctx) =>
  new Prover({ atoms: invAtoms(ctx, false), decls: ctx.decls, givenSets: ctx.given, laws: lawEnv(ctx) });

/** Does an atomic predicate (∈, ∉, ⊆) follow from what the prover knows? */
function followsFrom(prover: Prover, t: Term): boolean {
  const v = view(t);
  if (!v) return false;
  if (v.k === 'mem') return !!prover.mem(v.x, v.s);
  if (v.k === 'notmem') return !!prover.notMem(v.x, v.s);
  if (v.k === 'sub' && !v.strict) return !!prover.sub(v.a, v.b);
  return false;
}

/** What the invariant before says at the point x₀ (∀ instances, if x₀ is in the set), by key. */
function beforeAt(ctx: Ctx, x0: Term): Map<string, Premise> {
  const known = new Map<string, Premise>();
  const prover = new Prover({
    atoms: [...ownAtoms(ctx, ctx.lines, true), ...invAtoms(ctx, false)],
    decls: ctx.decls,
    givenSets: ctx.given,
    laws: lawEnv(ctx),
  });
  for (const c of ctx.inv) {
    known.set(key(c), { text: printTerm(c), reason: 'invariant before', src: 'inv' });
    if (c.kind !== 'quant' || c.q !== '∀' || c.pred || c.decls.length !== 1 || c.decls[0].names.length !== 1) continue;
    if (!prover.mem(x0, c.decls[0].type)) continue;
    const inst = substitute(c.body, new Map([[c.decls[0].names[0].name, x0]]));
    for (const k of conjuncts(inst)) {
      known.set(key(k), { text: printTerm(k), reason: `invariant before, at ${printTerm(x0)}`, src: 'inv' });
    }
  }
  return known;
}

/**
 * Split a condition along ∪ / displays (equivalences) and drop the parts that are known
 * already. Null if nothing is left.
 */
function splitAndDrop(t: Term, known: Map<string, Premise>, prover?: Prover): { result: Term; changed: boolean; dropped: Premise[] } | null {
  let list = conjuncts(t);
  let changed = false;
  for (let round = 0; round < 6; round++) {
    let any = false;
    list = list.flatMap((c) => {
      const r = splitStep(c);
      if (r) any = true;
      return r ? r.parts : [c];
    });
    if (!any) break;
    changed = true;
  }
  const dropped = list.flatMap((c) => (known.has(key(c)) ? [known.get(key(c))!] : []));
  const kept = list.filter((c) => !known.has(key(c)) && !(prover && followsFrom(prover, c)));
  if (!kept.length) return null;
  if (!changed && !dropped.length) return { result: t, changed: false, dropped: [] };
  return { result: andOf(kept), changed: true, dropped };
}

/**
 * One equivalence that splits a predicate into simpler ones:
 *   A ∪ B ⊆ C ⇔ A ⊆ C ∧ B ⊆ C        {a, b} ⊆ C ⇔ a ∈ C ∧ b ∈ C
 *   (A ∪ B) ∩ C = ∅ ⇔ A ∩ C = ∅ ∧ B ∩ C = ∅   {a} ∩ C = ∅ ⇔ a ∉ C   (also with C first)
 */
function splitStep(t: Term): { parts: Term[]; reason: string } | null {
  if (t.kind !== 'rel') return null;
  if (t.op === '⊆') {
    const ops = unionOperands(t.left);
    if (ops.length > 1) return { parts: ops.map((a) => mk.rel('⊆', a, t.right)), reason: 'fact about ⊆' };
    if (t.left.kind === 'setDisplay' && t.left.elems.length) return { parts: t.left.elems.map((e) => mk.rel('∈', e, t.right)), reason: 'fact about ⊆' };
    return null;
  }
  if (t.op === '=' && (isEmptySet(t.left) || isEmptySet(t.right))) {
    const inter = isEmptySet(t.right) ? t.left : t.right;
    if (inter.kind !== 'binop' || inter.op !== '∩') return null;
    for (const [A, C, rebuild] of [
      [inter.left, inter.right, (a: Term) => mk.bin('∩', a, inter.right)],
      [inter.right, inter.left, (a: Term) => mk.bin('∩', inter.left, a)],
    ] as [Term, Term, (a: Term) => Term][]) {
      const ops = unionOperands(A);
      if (ops.length > 1) return { parts: ops.map((a) => mk.rel('=', rebuild(a), mk.empty())), reason: 'fact about ∩' };
      if (A.kind === 'setDisplay' && A.elems.length) return { parts: A.elems.map((e) => mk.rel('∉', e, C)), reason: 'fact about ∩' };
    }
  }
  return null;
}

// ── equalities forced by total functions (the → vs ⇸ slip) ──────────────────────

/** "every patient is in patients" */
const everyIn = (X: string, S: string) => `every ${X.toLowerCase()} is in ${S}`;

interface Forced {
  f: string;
  X: string;
  S: string;
  /** The invariant conjunct `dom f ⊆ S` (or `dom f = S`), printed. */
  via: string;
}

/**
 * State sets the invariant forces to be a whole given set through a total function:
 * f : X → Y and dom f ⊆ S (or dom f = S) with S : ℙ X give S = X. Usually a modelling
 * slip (→ instead of ⇸), so it is worth showing.
 */
function forcedEqualities(ctx: Ctx): Forced[] {
  const out: Forced[] = [];
  const conjs = ctx.s.role === 'state' ? ctx.lines.flatMap((l) => l.conj) : ctx.inv;
  for (const c of conjs) {
    if (c.kind !== 'rel' || (c.op !== '⊆' && c.op !== '=')) continue;
    for (const [D, S] of c.op === '=' ? [[c.left, c.right], [c.right, c.left]] : [[c.left, c.right]]) {
      if (D.kind !== 'unop' || D.op !== 'dom' || D.arg.kind !== 'name' || S.kind !== 'name') continue;
      const df = ctx.decls.get(D.arg.name);
      const dS = ctx.decls.get(S.name);
      if (!df || df.kind !== 'binop' || df.op !== '→' || df.left.kind !== 'name' || !ctx.given.has(df.left.name)) continue;
      if (!dS || dS.kind !== 'unop' || dS.op !== 'ℙ' || key(dS.arg) !== key(df.left)) continue;
      if (!out.some((o) => o.S === S.name)) out.push({ f: D.arg.name, X: df.left.name, S: S.name, via: printTerm(c) });
    }
  }
  return out;
}

/** State step: show `S = X` when a total function forces it. */
function forcedFacts(ctx: Ctx): InferredFact[] {
  if (ctx.s.role !== 'state') return [];
  return forcedEqualities(ctx).map((fc) => {
    const text = `${fc.S} = ${fc.X}`;
    return {
      schemaId: ctx.s.id,
      kind: 'implied' as const,
      text,
      note: everyIn(fc.X, fc.S),
      derivation: {
        kind: 'facts' as const,
        premises: [
          { text: `dom ${fc.f} = ${fc.X}`, reason: `${fc.f} is total (→)` },
          { text: fc.via, reason: 'invariant' },
          { text: `${fc.S} ⊆ ${fc.X}`, reason: `declaration of ${fc.S}` },
        ],
        conclusion: text,
      },
    };
  });
}

/**
 * Make a proof that went through a total function readable: `dom f = X` [f is total],
 * `dom f ⊆ S` [invariant], then the step `S = X` it implies, then the rest.
 */
function explainForced(ctx: Ctx, premises: Premise[]): { premises: Premise[]; forced?: Forced } {
  for (const fc of forcedEqualities(ctx)) {
    const total = premises.find((p) => p.text === `dom ${fc.f} = ${fc.X}` && p.src === 'decl');
    const via = premises.find((p) => p.text === fc.via);
    if (!total || !via) continue;
    const eq: Premise = { text: `${fc.S} = ${fc.X}`, reason: `so ${everyIn(fc.X, fc.S)}`, src: 'inv' };
    const rest = premises.filter((p) => p !== total && p !== via);
    return { premises: [total, via, eq, ...rest], forced: fc };
  }
  return { premises };
}

// ── Init ───────────────────────────────────────────────────────────────────────

interface InitVal {
  value: Term;
  premises: Premise[];
  /** Stated by an Init line itself. */
  direct: boolean;
}

/** `w`, `dom w` or `ran w` for a state variable w. */
function initTarget(t: Term, names: ReadonlySet<string>): { name: string; wrap: 'none' | 'dom' | 'ran' } | null {
  if (t.kind === 'name' && names.has(t.name)) return { name: t.name, wrap: 'none' };
  if (t.kind === 'unop' && (t.op === 'dom' || t.op === 'ran') && t.arg.kind === 'name' && names.has(t.arg.name)) {
    return { name: t.arg.name, wrap: t.op };
  }
  return null;
}

/** `dom ∅ = ∅` is a special case of `dom R = ∅ ⇔ R = ∅`; show only the latter. */
function dropSubsumed(ps: Premise[]): Premise[] {
  const texts = new Set(ps.map((p) => p.text));
  return ps.filter((p) => !(p.src === 'law' && /^(dom|ran) ∅ = ∅$/.test(p.text) && texts.has(`${p.text.slice(0, 3)} R = ∅ ⇔ R = ∅`)));
}

/**
 * Values of state variables in the initial state: stated by Init (`onLoan = ∅`) or
 * derived with the invariant (`onLoan = dom borrower` ⇒ `borrower = ∅`).
 */
function initValues(ctx: Ctx, lines: Line[]): Map<string, InitVal> {
  const names = new Set(ctx.initNames ?? []);
  const own = ownAtoms(ctx, lines);
  const atoms = [...own, ...invAtoms(ctx, false), ...invAtoms(ctx, true)];
  const V = new Map<string, InitVal>();
  for (const a of own) {
    const v = view(a.term);
    if (v?.k !== 'eq') continue;
    for (const [l, r] of [
      [v.a, v.b],
      [v.b, v.a],
    ]) {
      if (l.kind === 'name' && names.has(l.name) && !mentions(r, names) && !V.has(l.name)) {
        V.set(l.name, { value: r, premises: [premiseOf(a)], direct: true });
      }
    }
  }
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const a of atoms) {
      const v = view(a.term);
      if (!v || (v.k !== 'eq' && v.k !== 'sub')) continue;
      const sides: [Term, Term][] = v.k === 'eq' ? [[v.a, v.b], [v.b, v.a]] : [[v.a, v.b]];
      for (const [tgt, val] of sides) {
        const t = initTarget(tgt, names);
        if (!t || V.has(t.name)) continue;
        const used = [...freeVars(val)].filter((n) => names.has(n));
        if (!used.every((n) => V.has(n))) continue;
        if (a.src !== 'own' && used.length === 0) continue; // always true, not about Init
        let cur = used.length ? substitute(val, new Map(used.map((n) => [n, V.get(n)!.value]))) : val;
        const laws: Law[] = [];
        for (const st of simplify(cur, lawEnv(ctx))) {
          cur = st.term;
          laws.push(st.law);
        }
        let concl: Premise | null = null;
        if (v.k === 'eq') {
          if (t.wrap !== 'none') {
            if (!isEmptySet(cur)) continue;
            concl = lawPremise(`${t.wrap} R = ∅ ⇔ R = ∅`, `fact about ${t.wrap}`);
          }
        } else {
          if (!isEmptySet(cur)) continue;
          concl =
            t.wrap === 'none'
              ? lawPremise('A ⊆ ∅ ⇔ A = ∅', 'fact about ⊆')
              : lawPremise(`${t.wrap} R ⊆ ∅ ⇔ R = ∅`, `fact about ${t.wrap}`);
        }
        const premises = [
          ...used.flatMap((n) => V.get(n)!.premises),
          premiseOf(a),
          ...laws.map((l) => lawPremise(l.statement, l.reason)),
          ...(concl ? [concl] : []),
        ];
        V.set(t.name, { value: concl ? mk.empty() : cur, premises: dropSubsumed(dedupe(premises)), direct: false });
        changed = true;
      }
    }
    if (!changed) break;
  }
  return V;
}

function initFacts(ctx: Ctx): InferredFact[] {
  const V = initValues(ctx, ctx.lines);
  const out: InferredFact[] = [];
  for (const name of ctx.initNames ?? []) {
    const val = V.get(name);
    if (!val || val.direct) continue;
    const text = printTerm(mk.rel('=', mk.name(name), val.value));
    out.push({ schemaId: ctx.s.id, kind: 'initial', text, derivation: { kind: 'facts', premises: strip(val.premises), conclusion: text } });
  }
  return out;
}

// ── redundancy ─────────────────────────────────────────────────────────────────

interface Flag {
  message: string;
  derivation: Derivation;
}

const q = (s: string) => `‘${s}’`;

function listText(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "Already follows from ‘book? ∉ onLoan’ and the state invariant." */
function followsMessage(ctx: Ctx, premises: Premise[]): string {
  const own = premises.filter((p) => p.src === 'own').map((p) => q(p.text));
  const decls = premises.filter((p) => p.src === 'decl');
  const parts: string[] = own.length <= 2 ? own : ['the other predicates'];
  if (premises.some((p) => p.src === 'xi')) parts.push(ctx.importText);
  if (premises.some((p) => p.src === 'frame')) parts.push('that unmentioned variables stay unchanged');
  if (premises.some((p) => p.src === 'inv')) parts.push('the state invariant');
  if (decls.length === 1 && parts.length === 0) return `The declaration ${q(decls[0].text)} already says this.`;
  if (decls.length === 1) parts.push(`the declaration ${q(decls[0].text)}`);
  if (decls.length > 1) parts.push('the declarations');
  return `Already follows from ${listText(parts)}.`;
}

function factsFlag(ctx: Ctx, l: Line, premises: Premise[], message?: string): Flag {
  const ex = explainForced(ctx, premises);
  const forcedMsg = ex.forced && `Already true: ${ex.forced.f} is total, so ${everyIn(ex.forced.X, ex.forced.S)} (${ex.forced.S} = ${ex.forced.X}).`;
  return {
    message: message ?? forcedMsg ?? followsMessage(ctx, premises),
    derivation: { kind: 'facts', premises: strip(ex.premises), conclusion: printTerm(l.term) },
  };
}

function redundancy(ctx: Ctx): ZDiagnostic[] {
  const out: ZDiagnostic[] = [];
  const flagged = new Set<number>();
  // Later lines first: of two lines that imply each other, the later one is marked,
  // and every marked line follows from the unmarked ones.
  for (let i = ctx.lines.length - 1; i >= 0; i--) {
    const l = ctx.lines[i];
    const avail = ctx.lines.filter((o) => o.i !== l.i && !flagged.has(o.i));
    const f =
      checkDuplicate(ctx, l, avail) ??
      checkInvariant(ctx, l) ??
      checkXi(ctx, l, avail) ??
      checkDeclaration(ctx, l) ??
      checkEffect(ctx, l, avail) ??
      checkInit(ctx, l, avail) ??
      checkMembership(ctx, l, avail);
    if (!f) continue;
    flagged.add(l.i);
    const note = frameNote(ctx, l);
    out.push(diagnostic(ctx, l, note ? { ...f, message: `${f.message} ${note}` } : f));
  }
  return out.reverse();
}

/**
 * A redundant line of a Δ operation that is the only one mentioning v′: deleting it
 * would add v′ = v (frame convention), keeping it lets v change. Say so. (Variables that
 * the invariant determines from the other mentioned ones are not frozen by the frame
 * convention, as in index.ts framePreds; see frame.ts.)
 */
function frameNote(ctx: Ctx, l: Line): string | null {
  if (ctx.s.role !== 'operation' || ctx.s.imports !== 'Δ' || !ctx.doc) return null;
  const text = ctx.doc.preds;
  const { from, to } = lineSpan(text, l.term.span);
  if (to > text.length) return null;
  const here = namesIn(text.slice(from, to));
  const rest = namesIn(text.slice(0, from) + '\n' + text.slice(to));
  const decls = new Map(ctx.stateVars.flatMap((v) => (ctx.decls.has(v) ? [[v, ctx.decls.get(v)!] as const] : [])));
  const frozen = new Set(frozenVars(ctx.stateVars, (v) => rest.has(v + '′'), determinations(ctx.inv, decls)));
  const vars = ctx.stateVars.filter((v) => here.has(v + '′') && frozen.has(v));
  if (!vars.length) return null;
  return `It is also the only line with ${listText(vars.map((v) => v + '′'))}, so ${listText(vars)} may change here.`;
}

const namesIn = (text: string) => new Set(lex(text).flatMap((t) => (t.kind === 'ident' ? [t.value] : [])));

function diagnostic(ctx: Ctx, l: Line, f: Flag): ZDiagnostic {
  const { from, to } = lineSpan(ctx.doc?.preds, l.term.span);
  return {
    section: l.info.section ?? { schemaId: ctx.s.id, part: 'preds' },
    from,
    to,
    severity: 'info',
    kind: 'redundant',
    message: f.message,
    derivation: f.derivation,
  };
}

/** The whole line(s) of a predicate, without surrounding white space. */
function lineSpan(text: string | undefined, span: Span): Span {
  if (text === undefined || span.to > text.length) return span;
  let from = text.lastIndexOf('\n', span.from - 1) + 1;
  while (from < span.from && /\s/.test(text[from])) from++;
  let to = text.indexOf('\n', span.to);
  if (to < 0) to = text.length;
  while (to > span.to && /\s/.test(text[to - 1])) to--;
  return { from, to };
}

/** (d) The same predicate (or each of its conjuncts) appears in an earlier line. */
function checkDuplicate(ctx: Ctx, l: Line, avail: Line[]): Flag | null {
  const earlier = avail.filter((o) => o.i < l.i);
  const k = key(l.term);
  const same = earlier.find((o) => key(o.term) === k);
  if (same) {
    const text = printTerm(same.term);
    const message = text === printTerm(l.term) ? 'Already stated above.' : `Already stated above, as ${q(text)}.`;
    return factsFlag(ctx, l, [{ text, reason: ownReason(ctx, same.term), src: 'own' }], message);
  }
  // every conjunct already appears in earlier lines
  const used: Line[] = [];
  for (const c of l.conj) {
    const kc = key(c);
    const o = earlier.find((e) => e.conj.some((ec) => key(ec) === kc));
    if (!o) return null;
    if (!used.includes(o)) used.push(o);
  }
  const texts = used.map((o) => printTerm(o.term));
  return factsFlag(
    ctx,
    l,
    used.map((o, i) => ({ text: texts[i], reason: ownReason(ctx, o.term), src: 'own' as const })),
    `Already stated above, in ${listText(texts.map(q))}.`,
  );
}

/** (a) Lines of the state invariant (as imported by Δ / Ξ / Init). */
function checkInvariant(ctx: Ctx, l: Line): Flag | null {
  if (ctx.s.role === 'state') return null;
  const inv = [...invAtoms(ctx, false), ...invAtoms(ctx, true)];
  const premises: Premise[] = [];
  for (const c of l.conj) {
    const kc = key(c);
    const a = inv.find((x) => key(x.term) === kc);
    if (!a) return null;
    premises.push(premiseOf(a));
  }
  return factsFlag(ctx, l, dedupe(premises), `Already part of the state invariant (included by ${ctx.importText}).`);
}

const isReflexive = (t: Term): boolean =>
  conjuncts(t).every(
    (c) =>
      ((c.kind === 'rel' && (c.op === '=' || c.op === '⊆' || c.op === '≤')) || (c.kind === 'logic' && (c.op === '⇔' || c.op === '⇒'))) &&
      key(c.left) === key(c.right),
  );

/** (b) Ξ: the line only says (part of) what Ξ says, possibly together with the invariant / another line. */
function checkXi(ctx: Ctx, l: Line, avail: Line[]): Flag | null {
  if (ctx.s.role !== 'operation' || ctx.s.imports !== 'Ξ' || !mentions(l.term, ctx.primed)) return null;
  const fv = freeVars(l.term);
  const vars = ctx.stateVars.filter((v) => fv.has(v + '′'));
  const unprimed = rename(l.term, new Map(vars.map((v) => [v + '′', v])));
  const xi: Premise[] = vars.map((v) => ({ text: `${v}′ = ${v}`, reason: `Ξ${ctx.stateName}`, src: 'xi' }));
  if (isReflexive(unprimed)) return factsFlag(ctx, l, xi, `${ctx.importText} already says the state does not change.`);
  const k = key(unprimed);
  const inv = invAtoms(ctx, false).find((a) => key(a.term) === k);
  if (inv) return factsFlag(ctx, l, [...xi, premiseOf(inv)]);
  const other = ownAtoms(ctx, avail).find((a) => key(a.term) === k);
  if (other) return factsFlag(ctx, l, [premiseOf(other), ...xi]);
  return null;
}

const NUM_FACTS: Record<string, [string, number][]> = {
  'ℕ': [['≥', 0]],
  'ℕ₁': [
    ['≥', 0],
    ['>', 0],
    ['≥', 1],
    ['≠', 0],
  ],
};

/** (e) Follows from a declaration alone: x ∈ X, S ⊆ X, dom f ⊆ X, dom f = X (total), x > 0 (ℕ₁). */
function checkDeclaration(ctx: Ctx, l: Line): Flag | null {
  const p = declarationPremise(ctx, l.term);
  return p ? factsFlag(ctx, l, [p]) : null;
}

function declarationPremise(ctx: Ctx, t: Term): Premise | null {
  const decl = (name: string): Premise | null => {
    const d = ctx.decls.get(name);
    return d ? { text: `${name} : ${printTerm(d)}`, reason: 'declaration', src: 'decl' } : null;
  };
  const v = view(t);
  if (v?.k === 'mem' && v.x.kind === 'name') {
    const d = ctx.decls.get(v.x.name);
    if (d) {
      const ks = key(v.s);
      // x : ℕ₁ gives x ∈ ℕ₁, ℕ, ℤ (ℕ₁ ⊆ ℕ ⊆ ℤ)
      const rank = (s: string) => ['ℕ₁', 'ℕ', 'ℤ'].indexOf(s);
      const wider = d.kind === 'builtinSet' && rank(d.set) >= 0 && rank(ks) >= rank(d.set);
      if (key(d) === ks || wider) return decl(v.x.name);
    }
  }
  if (v?.k === 'sub' && !v.strict) {
    const p = new Prover({ atoms: [], decls: ctx.decls, givenSets: ctx.given }).declSub(v.a, key(v.b));
    if (p) return p;
  }
  if (v?.k === 'eq') {
    for (const [A, B] of [
      [v.a, v.b],
      [v.b, v.a],
    ]) {
      if (A.kind === 'unop' && A.op === 'dom' && A.arg.kind === 'name') {
        const d = ctx.decls.get(A.arg.name);
        if (d && d.kind === 'binop' && d.op === '→' && key(d.left) === key(B)) return decl(A.arg.name);
      }
    }
  }
  if (t.kind === 'rel') {
    for (const side of [t.left, t.right]) {
      if (side.kind !== 'name') continue;
      const d = ctx.decls.get(side.name);
      if (d?.kind !== 'builtinSet') continue;
      const k = key(t);
      if ((NUM_FACTS[d.set] ?? []).some(([op, n]) => key(mk.rel(op as '≥', side, mk.num(n))) === k)) return decl(side.name);
    }
  }
  return null;
}

/** (c) `v′ = e` that the invariant already derives from the other lines (see the chain above). */
function checkEffect(ctx: Ctx, l: Line, avail: Line[]): Flag | null {
  if (ctx.s.role !== 'operation' || ctx.s.imports !== 'Δ' || l.conj.length !== 1) return null;
  const t = l.term;
  if (t.kind !== 'rel' || t.op !== '=') return null;
  for (const [lhs, rhs] of [
    [t.left, t.right],
    [t.right, t.left],
  ]) {
    if (lhs.kind !== 'name' || !ctx.primed.has(lhs.name) || mentions(rhs, ctx.primed)) continue;
    const defs = explicitDefs(ctx, avail);
    defs.delete(lhs.name);
    const eff = deriveEffect(ctx, lhs.name, defs);
    if (!eff) continue;
    const k = key(rhs);
    const j = eff.steps.findIndex((s) => key(s.term) === k);
    if (j < 0) continue;
    const parts = [...eff.used.map((d) => q(d.text)), 'the state invariant'];
    return { message: `Already follows from ${listText(parts)}.`, derivation: chainOf(eff.start, eff.steps.slice(0, j + 1)) };
  }
  return null;
}

/**
 * (h) Init: `w = c` (or `dom w = c`, `ran w = c`) that the other Init lines and the
 * invariant already imply. Both directions are checked, so that of two equivalent lines
 * (`owner = ∅`, `dom owner = ∅`) the later one is marked.
 */
function checkInit(ctx: Ctx, l: Line, avail: Line[]): Flag | null {
  if (ctx.s.role !== 'init' || l.conj.length !== 1) return null;
  const names = new Set(ctx.initNames ?? []);
  const v = view(l.term);
  if (v?.k !== 'eq') return null;
  for (const [lhs, rhs] of [
    [v.a, v.b],
    [v.b, v.a],
  ]) {
    const t = initTarget(lhs, names);
    if (!t || mentions(rhs, names)) continue;
    const val = initValues(ctx, avail).get(t.name);
    if (!val) continue;
    if (t.wrap === 'none') {
      if (!val.direct && key(val.value) === key(rhs)) return factsFlag(ctx, l, val.premises);
      continue;
    }
    // dom w / ran w from the value of w
    let cur = mk.unop(t.wrap, val.value);
    const laws: Premise[] = [];
    for (const st of simplify(cur, lawEnv(ctx))) {
      cur = st.term;
      laws.push(lawPremise(st.law.statement, st.law.reason));
    }
    if (key(cur) === key(rhs)) return factsFlag(ctx, l, dedupe([...val.premises, ...laws]));
  }
  return null;
}

/**
 * (f) x ∈ S, x ∉ S, A ⊆ B that follow from the other lines. Preconditions only from
 * other preconditions + the invariant before (+ declarations); never from the after
 * state, so safety preconditions like `(p? ↦ drug?) ∉ allergic` stay unmarked.
 */
function checkMembership(ctx: Ctx, l: Line, avail: Line[]): Flag | null {
  if (l.conj.length !== 1) return null;
  const v = view(l.term);
  if (!v || v.k === 'eq' || (v.k === 'sub' && v.strict)) return null;
  let atoms: Atom[];
  if (ctx.s.role !== 'operation') {
    atoms = [...ownAtoms(ctx, avail), ...invAtoms(ctx, false), ...invAtoms(ctx, true)];
  } else if (isPre(ctx, l.term)) {
    atoms = [...ownAtoms(ctx, avail, true), ...invAtoms(ctx, false)];
  } else {
    atoms = [...ownAtoms(ctx, avail), ...invAtoms(ctx, false), ...invAtoms(ctx, true), ...xiAtoms(ctx)];
  }
  const prover = new Prover({ atoms, decls: ctx.decls, givenSets: ctx.given, laws: lawEnv(ctx) });
  const proof = v.k === 'mem' ? prover.mem(v.x, v.s) : v.k === 'notmem' ? prover.notMem(v.x, v.s) : prover.sub(v.a, v.b);
  if (!proof || proof.length === 0) return null;
  return factsFlag(ctx, l, proof);
}

// ── proving step goals (used by the goal checker) ──────────────────────────────

/** A proof of a goal in one step, and whether it only needs the step's own content. */
export interface GoalProof {
  derivation: Derivation;
  /**
   * Only own lines, declarations and Ξ were used (no state invariant, frame convention,
   * or facts derived from them).
   */
  stated: boolean;
}

interface Supported {
  term: Term;
  /** What supports it (a single premise for a written line). */
  premises: Premise[];
}

/**
 * Try to prove `goal` (in the spec's own names) in the schema `schemaId` from the
 * step's premises: own lines and declarations, Ξ, the state invariant before / after,
 * the frame convention, and what the inference derives from them (effects, initial
 * values, guarantees). Conjunct by conjunct; null if some conjunct is not proven.
 */
export function proveGoal(spec: SpecDoc, an: Analysis, schemaId: string, goal: Term): GoalProof | null {
  const s = an.byId[schemaId];
  if (!s) return null;
  const doc = [spec.state, ...(spec.init ? [spec.init] : []), ...spec.operations].find((d) => d.id === schemaId);
  try {
    const ctx = context(an, s, doc);
    const known = knownFacts(ctx);
    const atoms: Atom[] = known.map((k) => ({ term: k.term, reason: k.premises[0].reason, src: k.premises[0].src }));
    const prover = new Prover({ atoms, decls: ctx.decls, givenSets: ctx.given, laws: lawEnv(ctx) });
    const byKey = new Map<string, Supported>();
    for (const k of known) if (!byKey.has(key(k.term))) byKey.set(key(k.term), k);
    const premises: Premise[] = [];
    for (const c of conjuncts(goal)) {
      const p = proveConjunct(ctx, c, byKey, prover);
      if (!p) return null;
      premises.push(...p);
    }
    const all = dedupe(premises);
    return {
      derivation: explained(all, printTerm(goal)),
      stated: all.every((p) => p.src === 'own' || p.src === 'decl' || p.src === 'xi' || p.src === 'law'),
    };
  } catch {
    return null;
  }
}

function proveConjunct(ctx: Ctx, c: Term, byKey: Map<string, Supported>, prover: Prover): Premise[] | null {
  const direct = byKey.get(key(c)) ?? weakerKnown(c, byKey);
  if (direct) return direct.premises;
  // A ∨ B from A (or from B)
  if (c.kind === 'logic' && c.op === '∨') {
    for (const side of [c.left, c.right]) {
      const ps: Premise[] = [];
      let ok = true;
      for (const sc of conjuncts(side)) {
        const p = proveConjunct(ctx, sc, byKey, prover);
        if (!p) {
          ok = false;
          break;
        }
        ps.push(...p);
      }
      if (ok) return ps;
    }
    return null;
  }
  if (c.kind === 'quant') {
    // pairs of a function: (x ↦ y) ∈ f means y = f(x)
    const red = reduceByFunctions(c, (n) => {
      const d = ctx.decls.get(n);
      return d?.kind === 'binop' && (d.op === '⇸' || d.op === '→');
    });
    if (red) {
      const declared = red.used.map((f) => declPremise(f, ctx.decls.get(f)!));
      if (red.trivial) return declared;
      for (const r of red.rest) {
        const known = byKey.get(key(r)) ?? weakerKnown(r, byKey);
        if (known) return [...declared, ...known.premises];
        if (r.kind !== 'quant' && !(r.kind === 'logic' && r.op === '⇒')) {
          const ps: Premise[] = [];
          for (const rc of conjuncts(r)) {
            const p = proveConjunct(ctx, rc, byKey, prover);
            if (!p) return null;
            ps.push(...p);
          }
          return [...declared, ...ps];
        }
      }
    }
  }
  if (c.kind === 'rel' && c.op === '=' && key(c.left) === key(c.right)) return [];
  const v = view(c);
  if (v?.k === 'mem') {
    const proof = prover.mem(v.x, v.s);
    if (proof) return proof;
    // (x ↦ y) ∈ f from y = f(x): the application is defined, and f(x) is the image of x
    const pp = pairParts(v.x);
    if (pp && v.s.kind === 'name') {
      const app: Term = { kind: 'apply', fn: v.s, arg: pp[0], span: SPAN };
      const eq = byKey.get(key(mk.rel('=', pp[1], app)));
      const dom = eq && proveConjunct(ctx, mk.rel('∈', pp[0], mk.unop('dom', v.s)), byKey, prover);
      if (eq && dom) return [...eq.premises, ...dom];
    }
    return null;
  }
  if (v?.k === 'notmem') return prover.notMem(v.x, v.s);
  if (v?.k === 'sub' && !v.strict) return prover.sub(v.a, v.b);
  if (v?.k === 'eq') {
    // both sides become the same once the unchanged variables (v′ = v) are put in
    const same: Premise[] = [];
    const sub = new Map<string, Term>();
    for (const k of byKey.values()) {
      const t = k.term;
      if (t.kind === 'rel' && t.op === '=' && t.left.kind === 'name' && t.right.kind === 'name' && t.left.name === t.right.name + '′') {
        if (!sub.has(t.left.name)) {
          sub.set(t.left.name, t.right);
          if (mentions(c, new Set([t.left.name]))) same.push(...k.premises);
        }
      }
    }
    if (sub.size && key(substitute(v.a, sub)) === key(substitute(v.b, sub))) return same;
    // A = B from A ⊆ B and B ⊆ A
    const ab = prover.sub(v.a, v.b);
    const ba = ab && prover.sub(v.b, v.a);
    if (ab && ba) return [...ab, ...ba];
  }
  return null;
}

/**
 * ∀ x . A ∧ B ⇒ C from a known ∀ x . A ⇒ C: extra assumptions only make the statement
 * weaker. Tries the goal with some of its assumptions left out (at most 4 of them).
 */
function weakerKnown(c: Term, byKey: Map<string, Supported>): Supported | undefined {
  if (c.kind !== 'quant' || c.q !== '∀') return undefined;
  const body: Term = c.pred ? { kind: 'logic', op: '⇒', left: c.pred, right: c.body, span: SPAN } : c.body;
  if (body.kind !== 'logic' || body.op !== '⇒') return undefined;
  const ante = conjuncts(body.left);
  if (ante.length > 4) return undefined;
  for (let mask = (1 << ante.length) - 2; mask >= 0; mask--) {
    const kept = ante.filter((_, i) => mask & (1 << i));
    const weaker: Term = kept.length
      ? { ...body, left: kept.reduce((a, b) => ({ kind: 'logic', op: '∧', left: a, right: b, span: SPAN })) }
      : body.right;
    const known = byKey.get(key({ kind: 'quant', q: '∀', decls: c.decls, body: weaker, span: c.span }));
    if (known) return known;
  }
  return undefined;
}

/**
 * A goal's derivation from its premises. An inferred premise (a guarantee, a derived
 * effect) is replaced by how it was inferred: the goal itself, if it is that fact, by
 * the fact's derivation (not "p? ∈ patients ⊢ p? ∈ patients"); otherwise by the premises
 * of that derivation, where it lists them.
 */
function explained(ps: Premise[], conclusion: string): Derivation {
  if (ps.length === 1 && ps[0].derivation) {
    const d = ps[0].derivation;
    if (d.kind === 'facts') return { kind: 'facts', premises: d.premises, conclusion };
    if (ps[0].text === conclusion) return d;
  }
  const flat = ps.flatMap((p) => (p.derivation?.kind === 'facts' ? p.derivation.premises : [{ text: p.text, reason: p.reason }]));
  const seen = new Set<string>();
  const premises = flat.filter((p) => {
    const k = `${p.text}\u0000${p.reason}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { kind: 'facts', premises, conclusion };
}

/** Everything known in a step, with its support. Own lines first. */
function knownFacts(ctx: Ctx): Supported[] {
  const one = (term: Term, reason: string, src: PremiseSource): Supported => ({ term, premises: [{ text: printTerm(term), reason, src }] });
  const out: Supported[] = [];
  for (const a of ownAtoms(ctx, ctx.lines)) out.push(one(a.term, a.reason, 'own'));
  for (const t of ctx.xi) out.push(one(t, `Ξ${ctx.stateName}`, 'xi'));
  if (ctx.s.role !== 'state') {
    for (const a of invAtoms(ctx, false)) out.push(one(a.term, a.reason, 'inv'));
    for (const a of invAtoms(ctx, true)) out.push(one(a.term, a.reason, 'inv'));
  }
  for (const t of ctx.frame) out.push(one(t, NOT_MENTIONED, 'frame'));
  if (ctx.s.role === 'init' && ctx.initNames) {
    // initial values the invariant implies (allergic = ∅ from patients = ∅)
    for (const [name, iv] of initValues(ctx, ctx.lines)) {
      if (iv.direct) continue;
      out.push({ term: mk.rel('=', mk.name(name), iv.value), premises: iv.premises.map((p) => (p.src === 'own' ? p : { ...p, src: p.src === 'law' ? 'law' : 'inv' })) });
    }
  }
  if (ctx.s.role === 'operation' && ctx.s.imports === 'Δ') {
    // effects derived from the invariant, and the guarantees
    const defs = frameDefs(ctx, explicitDefs(ctx, ctx.lines));
    for (const v of ctx.stateVars) {
      const vP = v + '′';
      if (defs.has(vP)) continue;
      const eff = deriveEffect(ctx, vP, defs);
      if (eff) {
        const s = one(mk.rel('=', mk.name(vP), eff.result), 'derived from the invariant', 'inv');
        s.premises[0].derivation = chainOf(vP, eff.steps);
        out.push(s);
      }
    }
    for (const f of guaranteedFacts(ctx)) {
      const t = parseTerm(f.text).term;
      const cs = t ? conjuncts(t) : [];
      for (const c of cs) {
        const s = one(c, 'guaranteed by the invariant', 'inv');
        // its derivation explains it (for the whole guarantee only: a conjunct is a weaker claim)
        if (cs.length === 1 && f.derivation) s.premises[0].derivation = f.derivation;
        out.push(s);
      }
    }
  }
  return out;
}
