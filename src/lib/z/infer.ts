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
//   'unchanged'  Ξ operations: v′ = v
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
import { Prover, dedupe, premiseOf, type Atom, type Premise } from './infer/prove';
import { simplify, type Law, type LawEnv } from './infer/rewrite';
import { conjuncts, containsKey, eqSide, isEmptySet, key, mentions, mk, replaceSub, view } from './infer/terms';

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
      const f = s.role === 'init' ? initFacts(ctx) : s.role === 'operation' ? opFacts(ctx) : [];
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
  return ctx.xi.map((term) => ({ term, reason: `Ξ${ctx.stateName}`, src: 'xi' as const }));
}

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
  rel: '=';
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
      push(cur, `spec of ${ctx.s.name}`);
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
  if (ctx.s.imports === 'Δ') {
    const defs = explicitDefs(ctx, ctx.lines);
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
    out.push({ schemaId: ctx.s.id, kind: 'defined', text, derivation: { kind: 'facts', premises: strip(proof), conclusion: text } });
  }
  return out;
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
  if (premises.some((p) => p.src === 'inv')) parts.push('the state invariant');
  if (decls.length === 1 && parts.length === 0) return `The declaration ${q(decls[0].text)} already says this.`;
  if (decls.length === 1) parts.push(`the declaration ${q(decls[0].text)}`);
  if (decls.length > 1) parts.push('the declarations');
  return `Already follows from ${listText(parts)}.`;
}

function factsFlag(ctx: Ctx, l: Line, premises: Premise[], message?: string): Flag {
  return {
    message: message ?? followsMessage(ctx, premises),
    derivation: { kind: 'facts', premises: strip(premises), conclusion: printTerm(l.term) },
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
    out.push(diagnostic(ctx, l, f));
  }
  return out.reverse();
}

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

/** (h) Init: `w = c` that the other Init lines and the invariant already imply. */
function checkInit(ctx: Ctx, l: Line, avail: Line[]): Flag | null {
  if (ctx.s.role !== 'init' || l.conj.length !== 1) return null;
  const names = new Set(ctx.initNames ?? []);
  const v = view(l.term);
  if (v?.k !== 'eq') return null;
  for (const [lhs, rhs] of [
    [v.a, v.b],
    [v.b, v.a],
  ]) {
    if (lhs.kind !== 'name' || !names.has(lhs.name) || mentions(rhs, names)) continue;
    const val = initValues(ctx, avail).get(lhs.name);
    if (val && !val.direct && key(val.value) === key(rhs)) return factsFlag(ctx, l, val.premises);
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
