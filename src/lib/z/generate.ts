// Example generator ("testing the spec"): concrete examples in Z set notation for the
// given sets, the state, the initial state and operations, as on the lecture slides
// (`onLoan = {Dune, Emma, Hamlet}`, `borrower = {Dune ↦ Ada, …}`).
//
// All functions are pure and deterministic for a given seed (a new seed = "regenerate")
// and stay within a small time budget, so the UI can call them on every edit.
// Predicates with scope/type errors are skipped; they never make this module throw.
//
// The search itself lives in ./gen (domains, graded predicate distance, solver).

import type { SpecDoc } from '../spec/model';
import type { Term } from './ast';
import { evalPred, memberOfDeclared, type Universe } from './eval';
import type { Analysis, PredInfo, SchemaInfo, VarInfo } from './index';
import { parseTerm } from './parser';
import { children, freeVars, nameTerm, printTerm } from './print';
import { frameConflictMessage, framesIn } from './frame';
import type { OpExample, PredCheck, ShownVar, StateExample, TypesExample } from './results';
import type { ZType } from './types';
import { EMPTY, atom, int, mkSet, printValue, tuple, valueEquals, type Value } from './values';
import { compileDom, completeEnum, emptyValue, intScaleFor, isEmptyDom, type Dom } from './gen/dom';
import { truth } from './gen/dist';
import { makeRng, type Rng } from './gen/rng';
import { Search, buildPlan, findWitness, isDetermined, now, solve, type Con, type Problem, type SolveResult, type Unknown } from './gen/solver';

/** Time budget per call (ms). Most calls finish far earlier. */
const BUDGET = 45;
/** Integer bounds for enumerating ℕ / ℤ (quantifiers, comprehensions). */
const INT_MIN = -5;
const INT_MAX = 20;

// ── universe ───────────────────────────────────────────────────────────────────

/**
 * Example carriers of the given sets: the whole pool, in pool order (the values the
 * student sees and edits in the Types panel); sets without a pool get name1 … name5
 * (TRAIN → train1, train2, …) plus the values used by `spec.fixed`. The carriers do not
 * depend on the seed, so every step of the example lives in the same world.
 */
export function universeFor(spec: SpecDoc, an: Analysis, seed: number): Universe {
  return guard(
    () => buildUniverse(spec, an, seed).u,
    () => ({ carriers: {}, intMin: INT_MIN, intMax: INT_MAX }),
  );
}

export function exampleTypes(spec: SpecDoc, an: Analysis, seed: number): TypesExample {
  return guard(
    () => {
      const u = universeFor(spec, an, seed);
      return {
        kind: 'types',
        carriers: an.givenSets.map((name) => ({ name, values: (u.carriers[name] ?? []).map(printValue) })),
      };
    },
    () => ({ kind: 'types', carriers: [] }),
  );
}

/** Last line of defence: the live editor must never break because of an example. */
function guard<T>(f: () => T, fallback: () => T): T {
  try {
    return f();
  } catch (e) {
    console.error('[example]', e);
    return fallback();
  }
}

const NO_EXAMPLE = 'No example right now.';
/** The search is limited to small values, so failing to find an example proves nothing. */
const NOT_FOUND = 'No example found with small values.';

interface Prepared {
  u: Universe;
  /** Validated fixed values, by state variable name. */
  fixed: Map<string, Value>;
  givens: Set<string>;
  deadline: number;
  /** The whole time budget (ms); phases get shares of it. */
  budget: number;
  /** Numbers written in the predicates (extra candidates for numeric variables). */
  consts: number[];
}

interface RawFixed {
  value: Value;
  info: VarInfo;
}

const cleanPool = (spec: SpecDoc, set: string): string[] => {
  const pool = spec.pools?.[set];
  if (!Array.isArray(pool)) return [];
  return [...new Set(pool.filter((n): n is string => typeof n === 'string' && n.trim() !== ''))];
};

function buildUniverse(spec: SpecDoc, an: Analysis, seed: number): { u: Universe; fixedRaw: Map<string, RawFixed> } {
  const state = stateSchema(an);
  const fixedRaw = new Map<string, RawFixed>();
  const required = new Map<string, Set<string>>();
  const exact = new Set<string>();
  for (const [name, text] of Object.entries(spec.fixed ?? {})) {
    const info = state?.vars.find((v) => v.name === name && v.role === 'state');
    if (!info || typeof text !== 'string') continue;
    const { term } = parseTerm(text);
    if (!term) continue;
    const atoms: { set: string; name: string }[] = [];
    const value = termToValue(term, info.type, spec, atoms);
    if (!value) continue;
    fixedRaw.set(name, { value, info });
    for (const a of atoms) {
      if (!required.has(a.set)) required.set(a.set, new Set());
      required.get(a.set)?.add(a.name);
    }
    // a fixed total function X → Y needs exactly its domain as the carrier of X
    const d = info.declared;
    if (d.kind === 'binop' && d.op === '→' && d.left.kind === 'name') exact.add(d.left.name);
  }

  void seed; // the carriers are the same for every seed
  const carriers: Record<string, Value[]> = {};
  for (const set of an.givenSets) {
    const req = required.get(set) ?? new Set<string>();
    const pool = cleanPool(spec, set);
    if (pool.length) {
      // a fixed total function X → Y fixes the carrier of X to exactly its domain
      const chosen = exact.has(set) && req.size ? req : new Set(pool);
      carriers[set] = pool.flatMap((n, i) => (chosen.has(n) ? [atom(set, n, i)] : []));
    } else {
      const lower = set.toLowerCase();
      const names = new Set<string>(exact.has(set) && req.size ? [] : [1, 2, 3, 4, 5].map((i) => lower + i));
      for (const r of req) names.add(r);
      carriers[set] = [...names]
        .map((n) => atom(set, n, defaultOrd(set, n) ?? 0))
        .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
    }
  }
  const infinite = (spec.infinite ?? []).filter((n) => an.givenSets.includes(n));
  // numbers of the spec and their neighbours are tried when ℕ / ℤ are listed
  const probes = [...new Set(specConstants(an).flatMap((n) => [n - 1, n, n + 1]))];
  return { u: { carriers, intMin: INT_MIN, intMax: INT_MAX, infinite, probes }, fixedRaw };
}

/** Position of `train3` in the default carrier of TRAIN (2), or null. */
function defaultOrd(set: string, name: string): number | null {
  const lower = set.toLowerCase();
  if (!name.startsWith(lower)) return null;
  const rest = name.slice(lower.length);
  return /^[1-9][0-9]*$/.test(rest) ? Number(rest) - 1 : null;
}

/** A fixed value written as a Z set display, read with the variable's type (atoms by pool). */
function termToValue(t: Term, type: ZType, spec: SpecDoc, atoms: { set: string; name: string }[]): Value | null {
  switch (type.k) {
    case 'given': {
      if (t.kind !== 'name') return null;
      const pool = cleanPool(spec, type.name);
      const ord = pool.length ? pool.indexOf(t.name) : defaultOrd(type.name, t.name);
      if (ord === null || ord < 0) return null;
      atoms.push({ set: type.name, name: t.name });
      return atom(type.name, t.name, ord);
    }
    case 'int':
      if (t.kind === 'num') return int(t.value);
      if (t.kind === 'unop' && t.op === 'neg' && t.arg.kind === 'num') return int(-t.arg.value);
      return null;
    case 'power': {
      if (t.kind === 'emptyset') return EMPTY;
      if (t.kind !== 'setDisplay') return null;
      const elems: Value[] = [];
      for (const e of t.elems) {
        const v = termToValue(e, type.elem, spec, atoms);
        if (!v) return null;
        elems.push(v);
      }
      return mkSet(elems);
    }
    case 'product': {
      const parts =
        t.kind === 'tuple' ? t.elems : t.kind === 'binop' && t.op === '↦' ? [t.left, t.right] : null;
      if (!parts || parts.length !== type.elems.length) return null;
      const elems: Value[] = [];
      for (let i = 0; i < parts.length; i++) {
        const v = termToValue(parts[i], type.elems[i], spec, atoms);
        if (!v) return null;
        elems.push(v);
      }
      return tuple(elems);
    }
    default:
      return null;
  }
}

function prepare(spec: SpecDoc, an: Analysis, seed: number, budgetMs = BUDGET): Prepared {
  const start = now();
  const { u, fixedRaw } = buildUniverse(spec, an, seed);
  const fixed = new Map<string, Value>();
  for (const [name, { value, info }] of fixedRaw) {
    try {
      if (memberOfDeclared(value, info.declared, new Map(), u)) fixed.set(name, value);
    } catch {
      /* ignore unusable fixed data */
    }
  }
  return { u, fixed, givens: new Set(an.givenSets), deadline: start + budgetMs, budget: budgetMs, consts: specConstants(an) };
}

// ── shared helpers ─────────────────────────────────────────────────────────────

/** Numeric literals of all (well-typed) predicates, most frequent first. */
function specConstants(an: Analysis): number[] {
  const count = new Map<number, number>();
  const walk = (t: Term) => {
    if (t.kind === 'num') count.set(t.value, (count.get(t.value) ?? 0) + 1);
    children(t).forEach(walk);
  };
  for (const s of an.schemas) for (const p of s.preds) if (p.ok && p.origin === 'own') walk(p.term);
  return [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([n]) => n);
}

const stateSchema = (an: Analysis): SchemaInfo | undefined => an.schemas.find((s) => s.role === 'state');

interface UVar {
  info: VarInfo;
  dom: Dom;
}

/** Variables whose declared set we can generate values for. */
function usableVars(s: SchemaInfo, prep: Prepared): UVar[] {
  const out: UVar[] = [];
  const seen = new Set<string>();
  for (const info of s.vars) {
    if (seen.has(info.name)) continue;
    const dom = compileDom(info.declared, prep.u, intScaleFor(info.base), prep.consts);
    if (!dom || isEmptyDom(dom)) continue;
    seen.add(info.name);
    out.push({ info, dom });
  }
  return out;
}

/** Predicates without errors that only mention usable variables and given sets. */
function usablePreds(preds: PredInfo[], vars: UVar[], prep: Prepared): PredInfo[] {
  const names = new Set(vars.map((v) => v.info.name));
  return preds.filter((p) => p.ok && [...freeVars(p.term)].every((n) => names.has(n) || prep.givens.has(n)));
}

const RANK: Record<VarInfo['role'], number> = { output: 5, local: 5, 'state′': 4, input: 2, state: 1 };

const hard = (p: PredInfo, weight = 1): Con => ({ term: p.term, hard: true, weight, tag: p });
const tagOf = (c: Con) => c.tag as PredInfo;

function shown(name: string, value: Value | undefined, extra: Partial<ShownVar> = {}): ShownVar {
  const v = value ?? EMPTY;
  return { name, value: v, text: printValue(v), ...extra };
}

/** For checks that are undefined: the reason in terms of the spec (`cleared(a₁) is undefined when a₁ ∉ dom cleared`). */
const generalOf = new WeakMap<PredCheck, string>();

function check(p: PredInfo, env: ReadonlyMap<string, Value>, u: Universe): PredCheck {
  const { result, message, general, bounded } = truth(p.term, new Map(env), u);
  const c: PredCheck = { origin: p.origin, text: printTerm(p.term), result };
  if (bounded) c.bounded = true;
  if (p.section) c.section = p.section;
  if (p.index !== undefined) c.index = p.index;
  if (message) c.message = message;
  if (general) generalOf.set(c, general);
  return c;
}

/**
 * A "no example found" message; if a failing predicate is undefined in the best try,
 * with the reason, which is often the cause (an unguarded f(x)).
 */
function why(base: string, failed: readonly PredCheck[]): string {
  for (const c of failed) {
    const g = c.result === 'undefined' ? generalOf.get(c) : undefined;
    if (g) return `${base.replace(/\.$/, '')}: ${g}.`;
  }
  return base;
}

const q = (s: string) => `‘${s}’`;

/**
 * Status of a value from the search for another one: 'computed' / 'unchanged' only
 * when the predicates are known to fix it, 'free' with another possible value, and
 * 'chosen' when neither was established (e.g. no time left).
 */
function statusFrom(w: Value | 'unique' | 'unknown', same: boolean): Partial<ShownVar> {
  if (w === 'unique') return { status: same ? 'unchanged' : 'computed' };
  if (w === 'unknown') return { status: 'chosen' };
  return { status: 'free', alternative: printValue(w), alternativeValue: w };
}

/** Deadline of one search for another value (a share of the budget, so that one variable cannot use it all). */
const witnessDeadline = (prep: Prepared) => Math.min(prep.deadline, now() + prep.budget * 0.15);

// ── state and initial state ────────────────────────────────────────────────────

/** A state satisfying the invariant (fixed data from spec.fixed where possible). */
export function exampleState(spec: SpecDoc, an: Analysis, seed: number, search?: SearchOptions): StateExample {
  return guard(
    () => stateExample(spec, an, seed, search),
    () => ({ kind: 'state', ok: false, message: NO_EXAMPLE }),
  );
}

function stateExample(spec: SpecDoc, an: Analysis, seed: number, search?: SearchOptions): StateExample {
  const prep = prepare(spec, an, seed, search?.budgetMs);
  const st = stateSchema(an);
  if (!st) return { kind: 'state', ok: true, vars: [], checks: [] };
  return schemaExample(prep, st, makeRng(seed, 'state'), {
    penalizeEmpty: true,
    statuses: false,
    fixedName: (v) => (v.role === 'state' ? v.base : null),
    fail: NOT_FOUND,
    search,
  });
}

/**
 * The initial state: the variables of the Init schema (state imported with or without ′).
 * Like an after-state, each value is 'computed' or 'free' (Init does not fix it).
 */
export function exampleInit(spec: SpecDoc, an: Analysis, seed: number, search?: SearchOptions): StateExample {
  return guard(
    () => initExample(spec, an, seed, search),
    () => ({ kind: 'state', ok: false, message: NO_EXAMPLE }),
  );
}

function initExample(spec: SpecDoc, an: Analysis, seed: number, search?: SearchOptions): StateExample {
  const prep = prepare(spec, an, seed, search?.budgetMs);
  const init = an.schemas.find((s) => s.role === 'init');
  if (!init) return { kind: 'state', ok: false, message: 'There is no Init schema.' };
  if (!init.initImport) return { kind: 'state', ok: false, message: 'Init does not import the state yet.' };
  return schemaExample(prep, init, makeRng(seed, 'init'), {
    penalizeEmpty: false,
    startEmpty: true, // initial states are usually (mostly) empty
    statuses: !(search?.extra || search?.relaxed),
    fixedName: (v) => (v.role === 'state' || v.role === 'state′' ? v.base : null),
    fail: 'No initial state found with small values.',
    search,
  });
}

function schemaExample(
  prep: Prepared,
  schema: SchemaInfo,
  rng: Rng,
  opts: {
    penalizeEmpty: boolean;
    startEmpty?: boolean;
    statuses: boolean;
    fixedName: (v: VarInfo) => string | null;
    fail: string;
    search?: SearchOptions;
  },
): StateExample {
  const vars = usableVars(schema, prep);
  const all = usablePreds(schema.preds, vars, prep);
  const preds = opts.search?.relaxed ? relaxedOnly(all) : all;
  let problem: Problem | null = null;
  const fixedVals = new Map<string, Value>();
  for (const v of vars) {
    const base = opts.fixedName(v.info);
    const fx = base !== null ? prep.fixed.get(base) : undefined;
    if (fx) fixedVals.set(v.info.name, fx);
  }
  const { res, fixedNames } = withFixed(true, fixedFits(prep, preds, fixedVals), (useFixed) => {
    const known = new Map<string, Value>();
    const fixedNames = new Set<string>();
    const unknowns: Unknown[] = [];
    for (const v of vars) {
      const base = opts.fixedName(v.info);
      const fx = base !== null ? prep.fixed.get(base) : undefined;
      if (fx && useFixed) {
        known.set(v.info.name, fx);
        fixedNames.add(v.info.name);
        continue;
      }
      unknowns.push({
        ...unknownOf(v),
        ...(fx ? { initValue: fx, initProb: 0.9 } : opts.startEmpty ? { initValue: emptyValue(v.dom) ?? undefined, initProb: 0.85 } : {}),
        penalizeEmpty: opts.penalizeEmpty,
      });
    }
    const pr: Problem = { u: prep.u, known, unknowns, cons: [...preds.map((p) => hard(p)), ...extraCons(opts.search)] };
    const res = solve(pr, rng, { maxSteps: 3000, deadline: prep.deadline, softSteps: opts.search ? 0 : 40 });
    if (res.ok || !problem) problem = pr;
    return { res, fixedNames };
  });
  const plan = opts.statuses && res.ok && problem ? buildPlan(problem) : null;
  const statusOf = (name: string): Partial<ShownVar> => {
    if (fixedNames.has(name)) return { fixed: true };
    if (!plan || !problem) return {};
    if (isDetermined(plan, name)) return { status: 'computed' };
    return statusFrom(findWitness(problem, name, res.env, rng, witnessDeadline(prep)), false);
  };
  const shownVars = vars.map((v) => shown(v.info.name, res.env.get(v.info.name), statusOf(v.info.name)));
  const checks = preds.map((p) => check(p, res.env, prep.u));
  if (res.ok) return { kind: 'state', ok: true, vars: shownVars, checks };
  const failed = checks.filter((c) => c.result !== true);
  return { kind: 'state', ok: false, message: why(opts.fail, failed), best: { vars: shownVars, failed } };
}

function unknownOf(v: UVar): Unknown {
  return { name: v.info.name, dom: v.dom, declared: v.info.declared, rank: RANK[v.info.role] };
}

/**
 * Try with fixed data first. Only if the fixed data cannot work — it breaks a predicate
 * about the fixed variables alone (`fits` false), or the search with it ran all its
 * steps without success — try again (if `retry`) with fixed data only as a starting
 * point. Running out of time is no reason to drop fixed data: then the example fails
 * rather than showing made-up values instead of, e.g., a compatibility table.
 */
function withFixed<T extends { res: SolveResult; fixedNames: Set<string> }>(
  retry: boolean,
  fits: boolean,
  attempt: (useFixed: boolean) => T,
): T {
  if (retry && !fits) return attempt(false);
  const first = attempt(true);
  if (first.res.ok || !retry || !first.fixedNames.size || first.res.timedOut) return first;
  const second = attempt(false);
  return second.res.ok ? second : first;
}

/** Do the fixed values satisfy the predicates that mention only fixed variables (and given sets)? */
function fixedFits(prep: Prepared, preds: PredInfo[], fixedVals: ReadonlyMap<string, Value>): boolean {
  if (!fixedVals.size) return true;
  return preds.every((p) => {
    const fv = [...freeVars(p.term)];
    if (!fv.some((n) => fixedVals.has(n)) || !fv.every((n) => fixedVals.has(n) || prep.givens.has(n))) return true;
    try {
      return evalPred(p.term, fixedVals, prep.u);
    } catch {
      return false;
    }
  });
}

// ── operations ─────────────────────────────────────────────────────────────────

interface OpParts {
  op: SchemaInfo;
  prep: Prepared;
  before: UVar[];
  inputs: UVar[];
  after: UVar[];
  outputs: UVar[];
  preds: PredInfo[];
  /** Invariant on the before-state. */
  inv: PredInfo[];
  /** Explicit preconditions: own predicates without after-state / outputs. */
  pres: PredInfo[];
  /** Extra constraints of a targeted search. */
  extra: Con[];
  /** Targeted search: no statuses, no failure diagnosis. */
  quick: boolean;
}

/**
 * One run of an operation. 'applicable': a before-state and inputs for which the
 * operation works, with the after-state and outputs solved from the predicates
 * (statuses say whether each is computed, unchanged, or not determined by the spec).
 * 'blocked': a valid before-state and inputs for which a precondition is false.
 */
/**
 * Options for targeted searches (used by the goal checker): find a valid example that
 * also satisfies `extra`. In this mode no statuses or failure diagnosis are computed.
 */
export interface SearchOptions {
  /** An extra predicate the example must satisfy (in the spec's own names). */
  extra?: Term;
  /** Only the schema's own lines and Ξ: without the state invariant and the frame convention. */
  relaxed?: boolean;
  /** Time budget in ms (default: the normal example budget). */
  budgetMs?: number;
}

/** Predicates a relaxed search keeps: the schema's own lines and Ξ's v′ = v. */
const relaxedOnly = (preds: PredInfo[]) => preds.filter((p) => p.origin === 'own' || p.origin === 'xi');

/** The extra predicate of a search as a hard constraint. */
const extraCons = (search?: SearchOptions): Con[] => (search?.extra ? [{ term: search.extra, hard: true, weight: 1 }] : []);

export interface OpExampleOptions extends SearchOptions {
  /**
   * The before-state to use: the unprimed state variables of the current state
   * example, by name. Only the inputs, after-state and outputs then vary with the seed.
   * Variables it lacks (or whose value no longer fits the declaration) are generated
   * to fit the invariant; if the state no longer fits the spec at all, a fresh one is
   * used (`freshBefore`).
   */
  before?: Readonly<Record<string, Value>>;
}

export function exampleOperation(
  spec: SpecDoc,
  an: Analysis,
  opId: string,
  seed: number,
  mode: 'applicable' | 'blocked',
  opts: OpExampleOptions = {},
): OpExample {
  return guard(
    () => operationExample(spec, an, opId, seed, mode, opts.before, opts),
    () => ({ kind: 'op', ok: false, reason: mode === 'blocked' ? 'no-blocked' : 'no-input', message: NO_EXAMPLE }),
  );
}

function operationExample(
  spec: SpecDoc,
  an: Analysis,
  opId: string,
  seed: number,
  mode: 'applicable' | 'blocked',
  given?: Readonly<Record<string, Value>>,
  search?: SearchOptions,
): OpExample {
  const prep = prepare(spec, an, seed, search?.budgetMs);
  const op = an.byId[opId];
  if (!op || op.role !== 'operation') return { kind: 'op', ok: false, reason: 'no-input', message: 'Unknown operation.' };
  const vars = usableVars(op, prep);
  const all = usablePreds(op.preds, vars, prep);
  const preds = search?.relaxed ? relaxedOnly(all) : all;
  const quick = !!(search?.extra || search?.relaxed);
  const role = (...roles: VarInfo['role'][]) => vars.filter((v) => roles.includes(v.info.role));
  const before = role('state');
  const inputs = role('input');
  const phaseA = new Set([...before, ...inputs].map((v) => v.info.name));
  const parts: OpParts = {
    op,
    prep,
    before,
    inputs,
    after: role('state′'),
    outputs: role('output', 'local'),
    preds,
    inv: preds.filter((p) => p.origin === 'invariant'),
    pres: preds.filter((p) => p.origin === 'own' && [...freeVars(p.term)].every((n) => phaseA.has(n) || prep.givens.has(n))),
    extra: extraCons(search),
    quick,
  };
  const run = (src: BeforeSource) =>
    mode === 'blocked' ? blockedCase(parts, makeRng(seed, `op:${opId}:${mode}`), src) : applicableCase(parts, makeRng(seed, `op:${opId}:${mode}`), src);
  if (given) {
    const r = run(givenBefore(parts, given));
    if (r) return r;
    // the given state does not fit the spec any more: use a fresh one
    const fresh = run(searchedBefore(parts))!;
    return fresh.ok ? { ...fresh, freshBefore: true } : fresh;
  }
  return run(searchedBefore(parts))!;
}

/**
 * Where an operation's before-state comes from. `vars` puts the known before values
 * into `known` (names of fixed data into `fixedNames`) and returns the before
 * variables still to be searched.
 */
interface BeforeSource {
  given: boolean;
  vars(useFixed: boolean, known: Map<string, Value>, fixedNames: Set<string>): Unknown[];
}

/** A before-state found by the search (fixed data first). */
const searchedBefore = (x: OpParts): BeforeSource => ({
  given: false,
  vars: (useFixed, known, fixedNames) => beforeUnknowns(x, useFixed, known, fixedNames),
});

/** The caller's before-state; variables it lacks or whose value no longer fits are searched. */
function givenBefore(x: OpParts, given: Readonly<Record<string, Value>>): BeforeSource {
  return {
    given: true,
    vars: (_useFixed, known, fixedNames) => {
      const missing: Unknown[] = [];
      for (const v of x.before) {
        const val = Object.prototype.hasOwnProperty.call(given, v.info.name) ? given[v.info.name] : undefined;
        let fits = false;
        try {
          fits = !!val && memberOfDeclared(val, v.info.declared, new Map(), x.prep.u);
        } catch {
          fits = false;
        }
        if (!fits) {
          missing.push({ ...unknownOf(v), penalizeEmpty: true });
          continue;
        }
        known.set(v.info.name, val!);
        const fx = x.prep.fixed.get(v.info.base);
        if (fx && valueEquals(fx, val!)) fixedNames.add(v.info.name);
      }
      return missing;
    },
  };
}

/** Can the given before-state (with its missing variables searched) satisfy the invariant? */
function stateFits(x: OpParts, src: BeforeSource, rng: Rng): boolean {
  const known = new Map<string, Value>();
  const unknowns = src.vars(true, known, new Set());
  const res = solve({ u: x.prep.u, known, unknowns, cons: x.inv.map((p) => hard(p)) }, rng, {
    maxSteps: 800,
    deadline: Math.min(x.prep.deadline, now() + x.prep.budget * 0.2),
    softSteps: 0,
  });
  return res.ok;
}

/** Before-state variables: fixed data as known values (or as a start value only). */
function beforeUnknowns(x: OpParts, useFixed: boolean, known: Map<string, Value>, fixedNames: Set<string>): Unknown[] {
  const out: Unknown[] = [];
  for (const v of x.before) {
    const fx = x.prep.fixed.get(v.info.base);
    if (fx && useFixed) {
      known.set(v.info.name, fx);
      fixedNames.add(v.info.name);
    } else if (fx) out.push({ ...unknownOf(v), initValue: fx, initProb: 0.9, penalizeEmpty: true });
    // sometimes start from the empty state: helps invariants like "outside S, f(x) = ∅"
    else out.push({ ...unknownOf(v), initValue: emptyValue(v.dom) ?? undefined, initProb: 0.3, penalizeEmpty: true });
  }
  return out;
}

/** The fixed values of the before-state, by variable name. */
function beforeFixed(x: OpParts): Map<string, Value> {
  const out = new Map<string, Value>();
  for (const v of x.before) {
    const fx = x.prep.fixed.get(v.info.base);
    if (fx) out.set(v.info.name, fx);
  }
  return out;
}

const afterUnknowns = (x: OpParts): Unknown[] => [
  ...x.after.map((v) => ({ ...unknownOf(v), initFrom: v.info.base, initProb: 0.9 })),
  ...x.outputs.map(unknownOf),
];

/** The applicable case; null if the given before-state does not fit the spec. */
function applicableCase(x: OpParts, rng: Rng, src: BeforeSource): OpExample | null {
  const { prep } = x;
  const jointDeadline = Math.min(prep.deadline, now() + prep.budget * 0.6);
  const fits = fixedFits(prep, x.preds, beforeFixed(x));
  const joint = withFixed(!src.given, fits, (useFixed) => {
    const known = new Map<string, Value>();
    const fixedNames = new Set<string>();
    const unknowns = [...src.vars(useFixed, known, fixedNames), ...x.inputs.map(unknownOf), ...afterUnknowns(x)];
    const problem: Problem = { u: prep.u, known, unknowns, cons: [...x.preds.map((p) => hard(p)), ...x.extra] };
    const change = x.quick ? null : changePreference(x, problem);
    if (change) problem.cons.push(change);
    const res = solve(problem, rng, { maxSteps: 2500, deadline: x.quick ? prep.deadline : jointDeadline, softSteps: x.quick ? 0 : 40 });
    return { res, fixedNames };
  });
  if (joint.res.ok) return applicableResult(x, joint.res.env, joint.fixedNames, rng);
  if (x.quick) return { kind: 'op', ok: false, reason: 'no-input', message: NOT_FOUND };

  // Diagnose: is there a valid before-state + inputs at all? (invariant first)
  const phaseA = withFixed(!src.given, fits, (useFixed) => {
    const known = new Map<string, Value>();
    const fixedNames = new Set<string>();
    const unknowns = [...src.vars(useFixed, known, fixedNames), ...x.inputs.map(unknownOf)];
    const cons = [...x.inv.map((p) => hard(p, 5)), ...x.pres.map((p) => hard(p))];
    const res = solve({ u: prep.u, known, unknowns, cons }, rng, {
      maxSteps: 1500,
      deadline: Math.min(prep.deadline, now() + prep.budget * 0.2),
      softSteps: 20,
    });
    return { res, fixedNames };
  });
  const A = phaseA.res;
  const beforeShown = () => x.before.map((v) => shown(v.info.name, A.env.get(v.info.name), phaseA.fixedNames.has(v.info.name) ? { fixed: true } : {}));
  const inputsShown = () => x.inputs.map((v) => shown(v.info.name, A.env.get(v.info.name)));
  if (!A.ok) {
    const failed = A.violated.map(tagOf);
    if (src.given) {
      if (!stateFits(x, src, rng)) return null;
      return {
        kind: 'op',
        ok: false,
        reason: 'no-input-for-state',
        message: `No input meets the precondition${x.pres.length > 1 ? 's' : ''} in this example state — try a new example state.`,
        before: beforeShown(),
        inputs: inputsShown(),
        failed: failed.filter((p) => p.origin !== 'invariant').map((p) => check(p, A.env, prep.u)),
      };
    }
    const invBad = failed.filter((p) => p.origin === 'invariant');
    if (invBad.length || !x.pres.length) {
      const checks = invBad.map((p) => check(p, A.env, prep.u));
      return { kind: 'op', ok: false, reason: 'no-before', message: why('No example state found with small values.', checks), failed: checks };
    }
    const checks = failed.map((p) => check(p, A.env, prep.u));
    return {
      kind: 'op',
      ok: false,
      reason: 'no-input',
      message: why(`No example found with small values in which the precondition${x.pres.length > 1 ? 's hold' : ' holds'}.`, checks),
      before: beforeShown(),
      inputs: inputsShown(),
      failed: checks,
    };
  }

  // A valid before-state exists: look for an after-state from there.
  const B = solve(
    {
      u: prep.u,
      known: A.env,
      unknowns: afterUnknowns(x),
      cons: x.preds.filter((p) => mentionsAny(p, [...x.after, ...x.outputs])).map((p) => hard(p)),
    },
    rng,
    { maxSteps: 1500, deadline: prep.deadline, softSteps: 0 },
  );
  if (B.ok) return applicableResult(x, B.env, phaseA.fixedNames, rng);
  const failedPreds = B.violated.map(tagOf);
  const broken = failedPreds.find((p) => p.origin === 'invariant′');
  const xi = failedPreds.find((p) => p.origin === 'xi');
  const frame = failedPreds.find((p) => p.origin === 'frame');
  // frame lines (v′ = v) in the broken invariant: to blame if dropping them lets it hold
  const frames = broken && !xi && !frame ? framesIn(x.op, broken.term) : [];
  const unframed =
    frames.length > 0 &&
    solve(
      { u: prep.u, known: A.env, unknowns: afterUnknowns(x), cons: x.preds.filter((p) => !frames.includes(p) && mentionsAny(p, [...x.after, ...x.outputs])).map((p) => hard(p)) },
      rng,
      { maxSteps: 1500, deadline: Math.max(prep.deadline, now() + prep.budget * 0.15), softSteps: 0 },
    ).ok;
  let message: string;
  // (only the Ξ / frame conflicts are certain; otherwise larger values might still work)
  if (xi) message = `No after-state fits: Ξ keeps ${q(printTerm(xi.term))}.`;
  else if (frame && frame.term.kind === 'rel') message = frameConflictMessage(x.op.name, [frame]);
  else if (unframed) message = frameConflictMessage(x.op.name, frames);
  else if (broken) message = `No after-state found with small values: ${q(printTerm(broken.term))} fails.`;
  else if (failedPreds.length) message = `No after-state found with small values: ${q(printTerm(failedPreds[0].term))} fails.`;
  else if (B.badDecls.length) {
    const v = [...x.after, ...x.outputs].find((w) => w.info.name === B.badDecls[0]);
    message = v
      ? `No after-state found with small values: ${v.info.name} would not be in ${printTerm(v.info.declared)}.`
      : 'No after-state found with small values.';
  } else message = 'No after-state found with small values.';
  const failedChecks = failedPreds.map((p) => check(p, B.env, prep.u));
  if (!xi && !frame) message = why('No after-state found with small values.', failedChecks.slice(0, 1)) === 'No after-state found with small values.' ? message : why('No after-state found with small values.', failedChecks.slice(0, 1));
  return {
    kind: 'op',
    ok: false,
    reason: 'no-after',
    message,
    before: beforeShown(),
    inputs: inputsShown(),
    failed: failedChecks,
  };
}

/**
 * For Δ operations: rather show a run in which the effect changes the state (adding a
 * pair that is already there is a dull example). Only after-state variables that
 * the predicates compute from the before-state and inputs count, so that values the
 * spec leaves open stay as they were.
 */
function changePreference(x: OpParts, problem: Problem): Con | null {
  if (x.op.imports !== 'Δ') return null;
  const plan = buildPlan(problem);
  const phaseA = new Set([...x.before, ...x.inputs].map((v) => v.info.name));
  const effect = x.after.filter((v) => {
    const i = plan.idx.get(v.info.name);
    return i !== undefined && plan.defs[i] && plan.rootsOf[i].every((r) => phaseA.has(plan.names[r]));
  });
  if (!effect.length) return null;
  const span = { from: 0, to: 0 };
  const same = effect
    .map((v): Term => ({ kind: 'rel', op: '=', left: nameTerm(v.info.name), right: nameTerm(v.info.base), span }))
    .reduce((a, b) => ({ kind: 'logic', op: '∧', left: a, right: b, span }));
  return { term: { kind: 'not', arg: same, span }, hard: false, weight: 0.3 };
}

const mentionsAny = (p: PredInfo, vars: UVar[]) => {
  const fv = freeVars(p.term);
  return vars.some((v) => fv.has(v.info.name));
};

/** Build the applicable example and work out how each after/output value came about. */
function applicableResult(x: OpParts, env: Map<string, Value>, fixedNames: Set<string>, rng: Rng): OpExample {
  const { prep } = x;
  const outs = [...x.after, ...x.outputs];
  const known = new Map<string, Value>();
  for (const [k, v] of env) if (!outs.some((o) => o.info.name === k)) known.set(k, v);
  const problem: Problem = {
    u: prep.u,
    known,
    unknowns: afterUnknowns(x),
    cons: x.preds.filter((p) => mentionsAny(p, outs)).map((p) => hard(p)),
  };
  const plan = buildPlan(problem);
  const statusOf = (v: UVar, isAfter: boolean): Partial<ShownVar> => {
    if (x.quick) return {}; // (targeted searches need no statuses)
    const name = v.info.name;
    const val = env.get(name);
    const old = env.get(v.info.base);
    const same = isAfter && !!val && !!old && valueEquals(val, old);
    if (isDetermined(plan, name)) return { status: same ? 'unchanged' : 'computed' };
    return statusFrom(findWitness(problem, name, env, rng, witnessDeadline(prep)), same);
  };
  return {
    kind: 'op',
    ok: true,
    status: 'applicable',
    before: x.before.map((v) => shown(v.info.name, env.get(v.info.name), fixedNames.has(v.info.name) ? { fixed: true } : {})),
    inputs: x.inputs.map((v) => shown(v.info.name, env.get(v.info.name))),
    after: x.after.map((v) => shown(v.info.name, env.get(v.info.name), statusOf(v, true))),
    outputs: x.outputs.map((v) => shown(v.info.name, env.get(v.info.name), statusOf(v, false))),
    checks: x.preds.map((p) => check(p, env, prep.u)),
  };
}

/**
 * The blocked case; null if the given before-state does not fit the spec.
 *
 * In Z an operation is blocked in a before-state with inputs when no after-state and
 * outputs satisfy its predicates (pre Op = ∃ State′; outputs! . Op). Two ways to find
 * such a case, both certain: an explicit precondition (a line about the before-state and
 * inputs only) is false; or the predicates compute the after-state (prescribed′ =
 * prescribed ∪ {p? ↦ drug?}, v′ = v, …) and it breaks a predicate, typically the
 * invariant after (so p? ∉ patients blocks Prescribe even if no line says p? ∈ patients).
 */
function blockedCase(x: OpParts, rng: Rng, src: BeforeSource): OpExample | null {
  const { prep, pres } = x;
  if (neverBlocked(x)) {
    const name = x.op.name || 'This operation';
    return { kind: 'op', ok: false, reason: 'no-blocked', message: `${name} has no precondition, so it is never blocked.` };
  }
  const fits = fixedFits(prep, x.preds, beforeFixed(x));
  const tester = blockedTester(x, rng);
  const shares = pres.length + (tester ? 1 : 0);
  /** Search a valid before-state + inputs that also satisfy `cons`. */
  const search = (cons: Con[], deadline: number, maxSteps: number) =>
    withFixed(!src.given, fits, (useFixed) => {
      const known = new Map<string, Value>();
      const fixedNames = new Set<string>();
      const unknowns = [...src.vars(useFixed, known, fixedNames), ...x.inputs.map(unknownOf)];
      const res = solve({ u: prep.u, known, unknowns, cons: [...x.inv.map((p) => hard(p)), ...cons] }, rng, {
        maxSteps,
        deadline,
        softSteps: 30,
      });
      return { res, fixedNames };
    });
  const result = (env: Map<string, Value>, fixedNames: Set<string>, failed: PredCheck[]): OpExample => ({
    kind: 'op',
    ok: true,
    status: 'blocked',
    before: x.before.map((v) => shown(v.info.name, env.get(v.info.name), fixedNames.has(v.info.name) ? { fixed: true } : {})),
    inputs: x.inputs.map((v) => shown(v.info.name, env.get(v.info.name))),
    after: [],
    outputs: [],
    checks: x.preds.filter((p) => p.origin === 'invariant' || pres.includes(p)).map((p) => check(p, env, prep.u)),
    failed,
  });

  // an explicit precondition is false
  const start = rng.int(Math.max(1, pres.length));
  for (let k = 0; k < pres.length; k++) {
    if (now() > prep.deadline) break;
    const target = pres[(start + k) % pres.length];
    const others = pres.filter((p) => p !== target);
    const negated: Term = { kind: 'not', arg: target.term, span: target.term.span };
    const share = Math.min(prep.deadline, now() + prep.budget / shares);
    const { res, fixedNames } = search(
      [{ term: negated, hard: true, weight: 1, tag: target }, ...others.map((p) => ({ term: p.term, hard: false, weight: 0.3, tag: p }))],
      share,
      1200,
    );
    if (res.ok) return result(res.env, fixedNames, pres.map((p) => check(p, res.env, prep.u)).filter((c) => c.result !== true));
  }

  // the after-state the predicates compute breaks a predicate
  if (tester && now() <= prep.deadline) {
    const reads = [...x.before, ...x.inputs].map((v) => v.info.name);
    const blockedCon: Con = {
      term: { kind: 'bool', value: true, span: { from: 0, to: 0 } },
      hard: true,
      weight: 1,
      test: { reads, dist: (env) => (tester(env)?.blocked ? 0 : 1) },
    };
    // (the explicit preconditions hold: the case shows a different reason)
    // (a blocked case of this kind is usually easy to hit: few steps, so that operations
    // that are never blocked do not take the whole budget)
    const { res, fixedNames } = search([blockedCon, ...pres.map((p) => ({ term: p.term, hard: false, weight: 0.3, tag: p }))], prep.deadline, 400);
    const t = res.ok ? tester(res.env) : null;
    if (t?.blocked && t.after) {
      const all = new Map([...t.after, ...res.env]);
      return result(res.env, fixedNames, (t.failed ?? []).map((p) => check(p, all, prep.u)).filter((c) => c.result !== true));
    }
  }

  if (src.given) {
    if (!stateFits(x, src, rng)) return null;
    return { kind: 'op', ok: false, reason: 'no-blocked', message: 'No input is blocked in this example state — try a new example state.' };
  }
  return { kind: 'op', ok: false, reason: 'no-blocked', message: 'No blocked case found.' };
}

/** The search problem of the after-state and outputs, given the before-state and inputs (`known`). */
function afterProblem(x: OpParts, known: ReadonlyMap<string, Value>): Problem {
  const outs = [...x.after, ...x.outputs];
  return {
    u: x.prep.u,
    known,
    unknowns: [...x.after.map(unknownOf), ...x.outputs.map(unknownOf)],
    cons: x.preds.filter((p) => mentionsAny(p, outs)).map((p) => hard(p)),
  };
}

/**
 * Decides whether the operation is blocked in a before-state with inputs, when that is
 * certain here: the predicates compute the after-state and outputs (definitions
 * v′ = e), apart from values with a few possible values each (all tried). Then
 * blocked means: the computed after-state breaks a predicate (`failed`, with the
 * after values in `after`). Null if the operation is not of this kind.
 */
function blockedTester(
  x: OpParts,
  rng: Rng,
): ((env: ReadonlyMap<string, Value>) => { blocked: boolean; after?: Map<string, Value>; failed?: PredInfo[] } | null) | null {
  if (!x.after.length && !x.outputs.length) return null;
  const problem = afterProblem(x, new Map());
  const plan = buildPlan(problem);
  const cands = plan.roots.map((r) => completeEnum(problem.unknowns[r].dom));
  if (cands.some((c) => !c) || cands.reduce((n, c) => n * c!.length, 1) > 64) return null;
  return (env) => {
    const s = new Search({ ...plan, p: { ...problem, known: env } }, rng);
    const first = s.run({ maxSteps: 0, deadline: Infinity, softSteps: 0 }); // computes the definitions
    if (first.ok) return { blocked: false };
    const failed = first.violated.map(tagOf);
    if (!plan.roots.length) return { blocked: true, after: first.env, failed };
    const r = s.exhaust(plan.roots, cands as Value[][], first.env, Infinity);
    if (r === 'none') return { blocked: true, after: first.env, failed };
    return r === 'timeout' ? null : { blocked: false };
  };
}

/**
 * Is it certain that the operation is never blocked? Only claimed in a simple case: no
 * explicit precondition, every after-state and output value is computed by a total
 * expression (no f(x), no div) and lies in its declared set whatever it is, and the
 * only other predicates about them are the invariant after on unchanged variables.
 */
function neverBlocked(x: OpParts): boolean {
  if (x.pres.length) return false;
  const outs = [...x.after, ...x.outputs];
  const problem = afterProblem(x, new Map());
  const plan = buildPlan(problem);
  const unchanged = new Set<string>();
  const defs = new Set<Term>();
  for (const v of outs) {
    const i = plan.idx.get(v.info.name);
    const def = i === undefined ? null : plan.defs[i];
    if (!def) {
      // a value no predicate mentions can be anything in its set
      if (problem.cons.some((c) => freeVars(c.term).has(v.info.name))) return false;
      continue;
    }
    if (def.deps.length) return false; // computed from another after-state value
    defs.add(def.expr);
    if (v.info.role === 'state′' && def.expr.kind === 'name' && def.expr.name === v.info.base) unchanged.add(v.info.name);
    else if (!totalExpr(def.expr, x.prep) || !maximalSet(v.info.declared, x.prep)) return false;
  }
  return problem.cons.every((c) => {
    const p = tagOf(c);
    const isDef = (t: Term): boolean =>
      t.kind === 'logic' && t.op === '∧'
        ? isDef(t.left) && isDef(t.right)
        : t.kind === 'rel' && t.op === '=' && (defs.has(t.left) || defs.has(t.right));
    if (isDef(p.term)) return true;
    return p.origin === 'invariant′' && outs.every((v) => !freeVars(p.term).has(v.info.name) || unchanged.has(v.info.name));
  });
}

/** An expression that is defined whatever the values of its names are. */
function totalExpr(t: Term, prep: Prepared): boolean {
  switch (t.kind) {
    case 'name':
      return !prep.givens.has(t.name);
    case 'num':
    case 'emptyset':
      return true;
    case 'setDisplay':
    case 'tuple':
      return t.elems.every((e) => totalExpr(e, prep));
    case 'binop':
      return ['↦', '∪', '∩', '∖', '+', '-', '*'].includes(t.op) && totalExpr(t.left, prep) && totalExpr(t.right, prep);
    case 'unop':
      return t.op !== 'ℙ' && totalExpr(t.arg, prep);
    default:
      return false;
  }
}

/** A declared set that contains every value of its type (BOOK, ℤ, ℙ BOOK, BOOK ↔ MEMBER, …). */
function maximalSet(t: Term, prep: Prepared): boolean {
  switch (t.kind) {
    case 'name':
      return prep.givens.has(t.name);
    case 'builtinSet':
      return t.set === 'ℤ';
    case 'unop':
      return t.op === 'ℙ' && maximalSet(t.arg, prep);
    case 'binop':
      return t.op === '↔' && maximalSet(t.left, prep) && maximalSet(t.right, prep);
    case 'cross':
      return t.elems.every((e) => maximalSet(e, prep));
    default:
      return false;
  }
}
