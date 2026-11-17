// Public API of the Z engine: `analyseSpec` parses and checks a whole specification
// (given sets, state, optional Init, operations) and returns, per schema, its
// variables (with roles and types) and the predicates that hold in it (own lines,
// the state invariant before/after, Ξ equalities), plus all diagnostics.
//
// Schema rules (see docs/design.md):
//   * the state schema declares undecorated state variables;
//   * Init imports the state as `State` (predicates on the unprimed state, as on the
//     lecture slides) or as `State′` (primed predicates);
//   * operations import `ΔState` (state may change) or `ΞState` (unchanged);
//     inputs end in ?, outputs in !.

import type { SchemaRole, SectionRef, SpecDoc, SchemaDoc, ZDiagnostic } from '../spec/model';
import { sectionKey } from '../spec/model';
import type { Decl, SchemaAst, Span, Term, VarDecl } from './ast';
import type { Decoration } from './lexer';
import { parseDecls, parseGiven, parsePredItems, type ParseDiagnostic } from './parser';
import { nameTerm, primeTerm, printTerm, splitName } from './print';
import { TypeChecker, type Binding, type NameTerm, type Scope } from './typecheck';
import { given, power, typeToString, type ZType } from './types';

export {
  parseGiven,
  parseDecls,
  parsePreds,
  parsePredItems,
  parseTerm,
  INFIX_OPS,
  type ParseDiagnostic,
  type GivenParse,
  type DeclsParse,
  type PredItem,
} from './parser';
export {
  printTerm,
  printDecl,
  printVarDecl,
  termEquals,
  declEquals,
  freeVars,
  rename,
  substitute,
  primeTerm,
  mapTerm,
  children,
  nameTerm,
  splitName,
  termPrec,
} from './print';
export { typeToString, describeType, typeEquals, relationParts, isGround, type ZType } from './types';
export { TypeChecker, quoteTerm, type Scope, type Binding, type NameTerm } from './typecheck';
export * from './values';
export * from './eval';

// ── result types ───────────────────────────────────────────────────────────────

export interface VarInfo {
  /** Full name with decoration: 'onLoan', 'onLoan′', 'book?', 'member!'. */
  name: string;
  base: string;
  decoration: Decoration;
  role: 'state' | 'state′' | 'input' | 'output' | 'local';
  /** Declared set expression, e.g. `BOOK ⇸ MEMBER` (for primed vars: the unprimed one's). */
  declared: Term;
  /** Type of the variable (element type of the declared set), e.g. ℙ (BOOK × MEMBER). */
  type: ZType;
  /** Where it is declared (imported state variables: the state schema's line). */
  section: SectionRef;
  span: Span;
}

export interface PredInfo {
  term: Term;
  /**
   * 'own': a line of this schema; 'invariant' / 'invariant′': the state invariant
   * (unprimed / primed copy); 'xi': `v′ = v` from Ξ.
   */
  origin: 'own' | 'invariant' | 'invariant′' | 'xi';
  /**
   * 'own': this schema's predicate section; invariants: the state schema's predicate
   * section (spans of primed copies still point at the original line). Absent for 'xi'.
   */
  section?: SectionRef;
  /** Ordinal of the predicate within `section` (counting lines that fail to parse). */
  index?: number;
  /** No scope/type errors in this predicate. */
  ok: boolean;
}

export interface SchemaInfo {
  id: string;
  role: SchemaRole;
  name: string;
  ast: SchemaAst;
  vars: VarInfo[];
  preds: PredInfo[];
  /** Operations: how the state is imported. */
  imports: 'Δ' | 'Ξ' | null;
  /** Init: whether the state is imported as `State` ('unprimed') or `State′` ('primed'). */
  initImport?: 'unprimed' | 'primed' | null;
  /** No errors in this schema, the given sets, and (if imported) the state schema. */
  ok: boolean;
}

export interface Analysis {
  givenSets: string[];
  schemas: SchemaInfo[];
  byId: Record<string, SchemaInfo>;
  diagnostics: ZDiagnostic[];
  /** No errors anywhere. */
  ok: boolean;
  /** Name of the state schema. */
  stateName: string;
  /** Unprimed state variable names, in declaration order. */
  stateVars: string[];
  /** Type of any checked (sub-)term of the spec (by object identity). */
  typeOf(t: Term): ZType | undefined;
}

// ── analysis ───────────────────────────────────────────────────────────────────

interface Ctx {
  globals: Map<string, Binding>;
  schemaNames: Set<string>;
  stateName: string;
  /** Unprimed state variables (filled once the state schema is analysed). */
  stateVars: VarInfo[];
  stateVarNames: Set<string>;
  report: (d: ZDiagnostic) => void;
  termTypes: WeakMap<Term, ZType>;
}

interface Parsed {
  decls: Decl[];
  items: { term: Term | null; span: Span }[];
  declSec: SectionRef;
  predSec: SectionRef;
  ast: SchemaAst;
  /** Span of the first line of the declaration text (for "missing import" messages). */
  firstLine: Span;
}

/** How the state is visible in a schema (for unknown-name messages). */
type StateView = 'all' | 'unprimed' | 'primed' | 'none';

const q = (s: string) => `‘${s}’`;
const isTypeLike = (name: string) => /^[A-Z]/.test(name);

export function analyseSpec(spec: SpecDoc): Analysis {
  const diagnostics: ZDiagnostic[] = [];
  const termTypes = new WeakMap<Term, ZType>();
  const report = (d: ZDiagnostic) => diagnostics.push(d);

  // given sets
  const givenSec: SectionRef = { schemaId: 'types', part: 'given' };
  const g = parseGiven(spec.given);
  addParse(report, g.diagnostics, givenSec);
  const givenSets: string[] = [];
  for (const n of g.names) {
    if (givenSets.includes(n.name)) report(err(givenSec, n.span, `${q(n.name)} is declared twice.`, 'scope'));
    else givenSets.push(n.name);
    const lookalike = NUMBER_SET_LOOKALIKES[n.name];
    if (lookalike) report(err(givenSec, n.span, lookalike, 'scope', 'warning'));
  }
  const globals = new Map<string, Binding>(givenSets.map((n) => [n, { kind: 'given', type: power(given(n)) }]));

  const docs: SchemaDoc[] = [spec.state, ...(spec.init ? [spec.init] : []), ...spec.operations];
  const ctx: Ctx = {
    globals,
    schemaNames: new Set(docs.map((d) => d.name).filter((n) => n)),
    stateName: spec.state.name,
    stateVars: [],
    stateVarNames: new Set(),
    report,
    termTypes,
  };

  const state = analyseState(spec.state, ctx);
  const init = spec.init ? analyseInit(spec.init, state, ctx) : null;
  const ops = spec.operations.map((op) => analyseOperation(op, state, ctx));
  const schemas = [state, ...(init ? [init] : []), ...ops];

  // ok flags: errors in the schema itself, the given sets, and the imported state
  const errorSections = new Set(diagnostics.filter((d) => d.severity === 'error').map((d) => sectionKey(d.section)));
  const clean = (id: string) => !errorSections.has(`${id}:decls`) && !errorSections.has(`${id}:preds`);
  const givenOk = !errorSections.has(sectionKey(givenSec));
  state.ok = givenOk && clean(state.id);
  for (const s of schemas) {
    if (s === state) continue;
    const importsState = s.role === 'init' ? s.initImport != null : s.imports != null || s.vars.some((v) => v.role === 'state');
    s.ok = givenOk && clean(s.id) && (!importsState || state.ok);
  }

  return {
    givenSets,
    schemas,
    byId: Object.fromEntries(schemas.map((s) => [s.id, s])),
    diagnostics,
    ok: !diagnostics.some((d) => d.severity === 'error'),
    stateName: spec.state.name,
    stateVars: ctx.stateVars.map((v) => v.name),
    typeOf: (t) => termTypes.get(t),
  };
}

function addParse(report: (d: ZDiagnostic) => void, ds: ParseDiagnostic[], section: SectionRef): void {
  for (const d of ds) report({ ...d, section });
}

function err(
  section: SectionRef,
  span: Span,
  message: string,
  kind: ZDiagnostic['kind'] = 'scope',
  severity: ZDiagnostic['severity'] = 'error',
): ZDiagnostic {
  return { section, from: span.from, to: span.to, severity, kind, message };
}

function parseSchema(doc: SchemaDoc, ctx: Ctx): Parsed {
  const declSec: SectionRef = { schemaId: doc.id, part: 'decls' };
  const predSec: SectionRef = { schemaId: doc.id, part: 'preds' };
  const d = parseDecls(doc.decls);
  addParse(ctx.report, d.diagnostics, declSec);
  const p = parsePredItems(doc.preds);
  addParse(ctx.report, p.diagnostics, predSec);
  const nl = doc.decls.indexOf('\n');
  return {
    decls: d.decls,
    items: p.items,
    declSec,
    predSec,
    ast: { name: doc.name, decls: d.decls, preds: p.items.flatMap((i) => (i.term ? [i.term] : [])) },
    firstLine: { from: 0, to: nl < 0 ? doc.decls.length : nl },
  };
}

/** Checker for this schema's predicates, with context-aware unknown-name messages. */
function predChecker(ctx: Ctx, section: SectionRef, role: SchemaRole, view: StateView): TypeChecker {
  return new TypeChecker({
    section,
    report: ctx.report,
    termTypes: ctx.termTypes,
    unknownName: (t, scope) => unknownNameMessage(t, scope, ctx, role, view),
  });
}

/**
 * Checker for declared sets (above the line). Only types may be used there:
 * given sets, ℕ, ℤ and constructions like ℙ / ⇸ from them.
 */
function declChecker(ctx: Ctx, section: SectionRef, role: SchemaRole, vars: () => Map<string, VarInfo>, decl: VarDecl): TypeChecker {
  return new TypeChecker({
    section,
    report: ctx.report,
    termTypes: ctx.termTypes,
    unknownName: (t, scope) => {
      const v = vars().get(t.name) ?? ctx.stateVars.find((s) => s.name === splitName(t.name).base);
      if (v) {
        // suggest the set the variable's elements come from: `counts : ℙ ℕ` → ℕ
        const d = v.declared;
        const el =
          d.kind === 'unop' && d.op === 'ℙ' ? printTerm(d.arg) : v.type.k === 'power' ? typeToString(v.type.elem, { relations: true }) : null;
        const declName = decl.names[0].name;
        if (el && decl.type === (t as Term) && decl.names.length === 1) {
          return `${q(t.name)} is a variable, not a type. Declare ${q(`${declName} : ${el}`)} and add ${q(`${declName} ∈ ${t.name}`)} below the line.`;
        }
        return `${q(t.name)} is a variable — above the line use types only (given sets, ℕ, ℤ, ℙ, ⇸ …) and state conditions below the line.`;
      }
      return unknownNameMessage(t, scope, ctx, role, 'none');
    },
  });
}

// ── messages for names that are not in scope ───────────────────────────────────

function unknownNameMessage(t: NameTerm, scope: Scope, ctx: Ctx, role: SchemaRole, view: StateView): string {
  const { name, base, decoration } = t;
  const S = ctx.stateName;
  if (ctx.schemaNames.has(name) || ctx.schemaNames.has(base)) {
    return `${q(name)} is a schema, not a variable (combining schemas is not part of this tutorial).`;
  }
  if (ctx.stateVarNames.has(base) && (decoration === '′' || decoration === '')) {
    if (decoration === '′') {
      if (role === 'state') {
        return `${q(name)} is the after-state of ${q(base)}; it only exists in operations (with Δ or Ξ). Here, write ${q(base)}.`;
      }
      if (role === 'init' && view === 'unprimed') {
        return `Init imports ${q(S)} (without ′), so write ${q(base)} here — or import ${q(S + '′')} instead.`;
      }
    } else if (role === 'init' && view === 'primed') {
      return `Init imports ${q(S + '′')}, so write ${q(base + '′')} here — or import ${q(S)} instead.`;
    }
    if (view === 'none') {
      if (role === 'init') return `Import the state by writing ${q(S)} in the first line of the declarations.`;
      return `${q(name)} belongs to the state — add ${q('Δ' + S)} or ${q('Ξ' + S)} to the declarations to use it.`;
    }
  }
  if ((decoration === '?' || decoration === '!') && role === 'state') {
    return `Inputs and outputs (like ${q(name)}) only exist in operations.`;
  }
  // the same name with another decoration (book → book?, member? → member!) is the most likely fix
  const names = [...scope.keys()];
  const special = OUT_OF_SCOPE_NAMES[name] ?? (decoration === '' && /^i?seq/.test(name) ? OUT_OF_SCOPE_NAMES.seq : undefined);
  if (special) return special;
  const sameBase = names.find((n) => n !== name && splitName(n).base === base);
  const suggestion = sameBase ?? closestName(name, names);
  if (suggestion) return `Unknown name ${q(name)} — did you mean ${q(suggestion)}?`;
  if (decoration === '?' || decoration === '!') {
    return `${q(name)} is not declared — add ${q(name + ' : …')} to the declarations.`;
  }
  if (/^[A-Z][A-Z0-9_]+$/.test(name)) {
    return `Unknown name ${q(name)} — if it is a type, add it to the given sets [ … ].`;
  }
  return `Unknown name ${q(name)}.`;
}

/**
 * Names that are not declared but mean something students know from elsewhere:
 * functions outside the tutorial, or ASCII spellings of ℕ / ℤ / ℙ.
 */
const OUT_OF_SCOPE_NAMES: Record<string, string> = {
  seq: 'Sequences (‘seq’, ‘⟨ ⟩’) are not part of this tutorial.',
  min: '‘min’ is not part of this tutorial — say it with ∀, e.g. m ∈ S ∧ (∀ x : S • m ≤ x).',
  max: '‘max’ is not part of this tutorial — say it with ∀, e.g. m ∈ S ∧ (∀ x : S • x ≤ m).',
  succ: '‘succ’ is not part of this tutorial — write ‘n + 1’.',
  N: 'Unknown name ‘N’ — did you mean ℕ (type NN)?',
  NN: 'Unknown name ‘NN’ — did you mean ℕ (type NN and a space)?',
  N1: 'Unknown name ‘N1’ — did you mean ℕ₁ (type NN1)?',
  NN1: 'Unknown name ‘NN1’ — did you mean ℕ₁ (type NN1 and a space)?',
  Z: 'Unknown name ‘Z’ — did you mean ℤ (type ZZ)?',
  ZZ: 'Unknown name ‘ZZ’ — did you mean ℤ (type ZZ and a space)?',
  R: 'Unknown name ‘R’ — real numbers are not part of this tutorial; use ℤ (type ZZ).',
  PP: 'Unknown name ‘PP’ — did you mean ℙ (type PP and a space)?',
};

/** Given sets that look like a misspelt number set. */
const NUMBER_SET_LOOKALIKES: Record<string, string> = {
  N: 'Did you mean ℕ (type NN)? ‘N’ is declared here as a new given set.',
  N1: 'Did you mean ℕ₁ (type NN1)? ‘N1’ is declared here as a new given set.',
  Z: 'Did you mean ℤ (type ZZ)? ‘Z’ is declared here as a new given set.',
  R: 'Real numbers are not part of this tutorial — did you mean ℤ (type ZZ)? ‘R’ is declared here as a new given set.',
};

/** Closest candidate by edit distance (small typos only), or null. */
function closestName(name: string, candidates: string[]): string | null {
  const limit = name.length <= 4 ? 1 : name.length <= 7 ? 2 : 3;
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = c.toLowerCase() === name.toLowerCase() ? 0.5 : editDistance(name, c);
    if (d <= limit && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/** Levenshtein distance with adjacent transpositions. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

// ── shared helpers for declarations ────────────────────────────────────────────

/**
 * A bare name in a declaration line (`S`): the state import for Init, otherwise a
 * mistake. Reports the problem for roles where it is not allowed.
 */
function badInclude(ctx: Ctx, sec: SectionRef, d: Extract<Decl, { kind: 'include' }>, role: SchemaRole): void {
  const base = splitName(d.schema).base;
  const S = ctx.stateName;
  if (!ctx.schemaNames.has(base) && !isTypeLike(base)) {
    ctx.report(err(sec, d.span, `Expected ‘:’ and a type after ${q(d.schema)}, e.g. ${q(d.schema + ' : …')}`, 'syntax'));
  } else if (role === 'operation' && base === S) {
    ctx.report(err(sec, d.span, `In an operation, import the state with ${q('Δ' + S)} (it may change) or ${q('Ξ' + S)} (it stays the same).`));
  } else if (role === 'operation' && !ctx.schemaNames.has(base)) {
    ctx.report(err(sec, d.span, `Unknown schema ${q(d.schema)} — import the state with ${q('Δ' + S)} or ${q('Ξ' + S)}.`));
  } else {
    ctx.report(err(sec, d.span, `Including other schemas (${q(d.schema)}) is not part of this tutorial.`));
  }
}

/** Check the declared set of a variable declaration and return the variables' type. */
function declaredType(ctx: Ctx, sec: SectionRef, role: SchemaRole, d: VarDecl, vars: () => Map<string, VarInfo>): ZType {
  return declChecker(ctx, sec, role, vars, d).checkDeclaredSet(d.type, ctx.globals);
}

function scopeOf(ctx: Ctx, vars: VarInfo[]): Scope {
  const s = new Map(ctx.globals);
  for (const v of vars) s.set(v.name, { kind: 'var', type: v.type });
  return s;
}

function primedCopy(v: VarInfo): VarInfo {
  return { ...v, name: v.base + '′', decoration: '′', role: 'state′' };
}

function ownPreds(ctx: Ctx, p: Parsed, role: SchemaRole, view: StateView, scope: Scope): PredInfo[] {
  const checker = predChecker(ctx, p.predSec, role, view);
  const out: PredInfo[] = [];
  p.items.forEach((item, index) => {
    if (!item.term) return;
    const ok = checker.checkPredicate(item.term, scope);
    out.push({ term: item.term, origin: 'own', section: p.predSec, index, ok });
  });
  return out;
}

/** Invariant predicates of the state (optionally primed), typed silently in `scope`. */
function invariantPreds(ctx: Ctx, state: SchemaInfo, primed: boolean, scope: Scope): PredInfo[] {
  const silent = new TypeChecker({ section: { schemaId: state.id, part: 'preds' }, termTypes: ctx.termTypes });
  return state.preds
    .filter((p) => p.origin === 'own')
    .map((p) => {
      if (!primed) return { ...p, origin: 'invariant' as const };
      const term = primeTerm(p.term, ctx.stateVarNames);
      silent.checkPredicate(term, scope);
      return { ...p, term, origin: 'invariant′' as const };
    });
}

function xiPreds(ctx: Ctx, scope: Scope): PredInfo[] {
  const silent = new TypeChecker({ section: { schemaId: 'state', part: 'preds' }, termTypes: ctx.termTypes });
  return ctx.stateVars.map((v) => {
    const term: Term = { kind: 'rel', op: '=', left: nameTerm(v.name + '′'), right: nameTerm(v.name), span: { from: 0, to: 0 } };
    silent.checkPredicate(term, scope);
    return { term, origin: 'xi' as const, ok: true };
  });
}

/**
 * Declare the schema's own (non-state) variables: inputs, outputs, locals.
 * `stateHint` names the import used in messages (e.g. 'ΔLibrary').
 */
function ownVars(ctx: Ctx, p: Parsed, role: 'init' | 'operation', stateHint: string): VarInfo[] {
  const vars = new Map<string, VarInfo>();
  for (const d of p.decls) {
    if (d.kind !== 'var') continue;
    const type = declaredType(ctx, p.declSec, role, d, () => vars);
    for (const n of d.names) {
      const report = (msg: string) => ctx.report(err(p.declSec, n.span, msg));
      const isState = ctx.stateVarNames.has(n.base);
      if (n.decoration === '′') {
        report(
          isState
            ? `${q(n.name)} is already part of ${q(stateHint)} — no need to declare it.`
            : `Only state variables have a primed (′) version — use ${q(n.base + '!')} for an output.`,
        );
        continue;
      }
      if (n.decoration === '' && isState) {
        report(`${q(n.name)} is already a state variable (from ${q(stateHint)}).`);
        continue;
      }
      if (vars.has(n.name)) {
        report(`${q(n.name)} is declared twice.`);
        continue;
      }
      if (ctx.globals.has(n.name)) {
        report(`${q(n.name)} is already a given set — choose another name.`);
        continue;
      }
      const roleOf = n.decoration === '?' ? 'input' : n.decoration === '!' ? 'output' : 'local';
      vars.set(n.name, {
        name: n.name,
        base: n.base,
        decoration: n.decoration,
        role: roleOf,
        declared: d.type,
        type,
        section: p.declSec,
        span: n.span,
      });
    }
  }
  return [...vars.values()];
}

// ── the three kinds of schemas ─────────────────────────────────────────────────

function analyseState(doc: SchemaDoc, ctx: Ctx): SchemaInfo {
  const p = parseSchema(doc, ctx);
  const vars = new Map<string, VarInfo>();
  for (const d of p.decls) {
    if (d.kind === 'delta' || d.kind === 'xi') {
      const sym = d.kind === 'delta' ? 'Δ' : 'Ξ';
      ctx.report(
        err(p.declSec, d.span, `${sym} is used in operations to import the state. The state schema declares its variables directly, e.g. ‘x : ℙ NAME’.`),
      );
      continue;
    }
    if (d.kind === 'include') {
      badInclude(ctx, p.declSec, d, 'state');
      continue;
    }
    const type = declaredType(ctx, p.declSec, 'state', d, () => vars);
    for (const n of d.names) {
      const report = (msg: string) => ctx.report(err(p.declSec, n.span, msg));
      if (n.decoration === '′') {
        report(`State variables are declared without ′ — write ${q(n.base)}. The after-state ${q(n.name)} comes automatically with ${q('Δ' + doc.name)} in operations.`);
        // still declare the unprimed variable, so that other schemas don't report it as unknown
        if (!vars.has(n.base) && !ctx.globals.has(n.base)) {
          vars.set(n.base, { name: n.base, base: n.base, decoration: '', role: 'state', declared: d.type, type, section: p.declSec, span: n.span });
        }
      } else if (n.decoration === '?' || n.decoration === '!') {
        report(`Inputs (?) and outputs (!) belong in operations, not in the state schema — write ${q(n.base)} for a state variable.`);
      } else if (vars.has(n.name)) {
        report(`${q(n.name)} is declared twice.`);
      } else if (ctx.globals.has(n.name)) {
        report(`${q(n.name)} is already a given set — choose another name.`);
      } else {
        vars.set(n.name, { name: n.name, base: n.base, decoration: '', role: 'state', declared: d.type, type, section: p.declSec, span: n.span });
      }
    }
  }
  ctx.stateVars = [...vars.values()];
  ctx.stateVarNames = new Set(vars.keys());
  const scope = scopeOf(ctx, ctx.stateVars);
  const preds = ownPreds(ctx, p, 'state', 'unprimed', scope);
  return { id: doc.id, role: 'state', name: doc.name, ast: p.ast, vars: ctx.stateVars, preds, imports: null, ok: true };
}

function analyseInit(doc: SchemaDoc, state: SchemaInfo, ctx: Ctx): SchemaInfo {
  const p = parseSchema(doc, ctx);
  const S = ctx.stateName;
  let imp: 'unprimed' | 'primed' | 'both' | null = null;
  for (const d of p.decls) {
    if (d.kind === 'include') {
      const { base, decoration } = splitName(d.schema);
      const isStateImport = base === S || (isTypeLike(base) && !ctx.schemaNames.has(base) && decoration !== '?' && decoration !== '!');
      if (!isStateImport) {
        badInclude(ctx, p.declSec, d, 'init');
        continue;
      }
      if (base !== S) ctx.report(err(p.declSec, d.span, `The state schema is called ${q(S)} — write ${q(S + decoration)} here.`));
      if (imp) ctx.report(err(p.declSec, d.span, 'The state is already imported.'));
      else imp = decoration === '′' ? 'primed' : 'unprimed';
    } else if (d.kind === 'delta' || d.kind === 'xi') {
      const sym = d.kind === 'delta' ? 'Δ' : 'Ξ';
      ctx.report(err(p.declSec, d.span, `Init describes the initial state: import it with ${q(S)} (or ${q(S + '′')}), not with ${sym}.`));
      imp ??= 'both'; // keep checking the predicates without follow-up errors
    }
  }
  if (!imp) {
    ctx.report(err(p.declSec, p.firstLine, `Start the declarations with the state schema name ${q(S)} to import the state.`));
  }
  const imported =
    imp === 'unprimed' ? ctx.stateVars : imp === 'primed' ? ctx.stateVars.map(primedCopy) : imp === 'both' ? [...ctx.stateVars, ...ctx.stateVars.map(primedCopy)] : [];
  const own = ownVars(ctx, p, 'init', imp === 'primed' ? S + '′' : S);
  const vars = [...imported, ...own];
  const scope = scopeOf(ctx, vars);
  const view: StateView = imp === 'unprimed' ? 'unprimed' : imp === 'primed' ? 'primed' : imp === 'both' ? 'all' : 'none';
  const preds = ownPreds(ctx, p, 'init', view, scope);
  if (imp === 'unprimed' || imp === 'both') preds.push(...invariantPreds(ctx, state, false, scope));
  if (imp === 'primed' || imp === 'both') preds.push(...invariantPreds(ctx, state, true, scope));
  return {
    id: doc.id,
    role: 'init',
    name: doc.name,
    ast: p.ast,
    vars,
    preds,
    imports: null,
    initImport: imp === 'both' ? null : imp,
    ok: true,
  };
}

function analyseOperation(doc: SchemaDoc, state: SchemaInfo, ctx: Ctx): SchemaInfo {
  const p = parseSchema(doc, ctx);
  const S = ctx.stateName;
  let imp: 'Δ' | 'Ξ' | null = null;
  let pseudo = false; // state imported in a wrong way; keep checking without follow-up errors
  type Include = Extract<Decl, { kind: 'include' }>;
  const plain: Include[] = []; // `S` lines
  const primed: Include[] = []; // `S′` lines
  for (const d of p.decls) {
    if (d.kind === 'delta' || d.kind === 'xi') {
      const sym = d.kind === 'delta' ? 'Δ' : 'Ξ';
      if (imp) {
        ctx.report(err(p.declSec, d.span, 'Only one Δ or Ξ line is needed.'));
        continue;
      }
      imp = sym;
      if (d.schema !== S) ctx.report(err(p.declSec, d.span, `The state schema is called ${q(S)} — write ${q(sym + S)}.`));
    } else if (d.kind === 'include') {
      const { base, decoration } = splitName(d.schema);
      if (base === S && decoration === '') plain.push(d);
      else if (base === S && decoration === '′') primed.push(d);
      else badInclude(ctx, p.declSec, d, 'operation');
    }
  }
  // `S` and `S′` on two lines import the state before and after: exactly ΔS.
  for (const d of [...plain.slice(1), ...primed.slice(1)]) ctx.report(err(p.declSec, d.span, 'The state is already imported.'));
  if (plain.length && primed.length) {
    if (imp) {
      const later = primed[0].span.from > plain[0].span.from ? primed[0] : plain[0];
      ctx.report(err(p.declSec, later.span, `${q(S)} and ${q(S + '′')} together already mean ${q('Δ' + S)} — remove one of the imports.`));
    } else imp = 'Δ';
  } else if (primed.length) {
    ctx.report(err(p.declSec, primed[0].span, `Write ${q('Δ' + S)} to import the state before and after.`));
    pseudo = true;
  } else if (plain.length) {
    badInclude(ctx, p.declSec, plain[0], 'operation');
    pseudo = true;
  }
  if (!imp && !pseudo) {
    ctx.report(
      err(
        p.declSec,
        p.firstLine,
        `Start with ${q('Δ' + S)} (the operation may change the state) or ${q('Ξ' + S)} (the state stays the same).`,
        'scope',
        'warning',
      ),
    );
  }
  const imported = imp || pseudo ? [...ctx.stateVars, ...ctx.stateVars.map(primedCopy)] : [];
  const own = ownVars(ctx, p, 'operation', (imp ?? 'Δ') + S);
  const vars = [...imported, ...own];
  const scope = scopeOf(ctx, vars);
  const preds = ownPreds(ctx, p, 'operation', imp || pseudo ? 'all' : 'none', scope);
  if (imp) {
    preds.push(...invariantPreds(ctx, state, false, scope), ...invariantPreds(ctx, state, true, scope));
    if (imp === 'Ξ') preds.push(...xiPreds(ctx, scope));
  }
  return { id: doc.id, role: 'operation', name: doc.name, ast: p.ast, vars, preds, imports: imp, ok: true };
}
