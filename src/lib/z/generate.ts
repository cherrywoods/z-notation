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
import { memberOfDeclared, type Universe } from './eval';
import type { Analysis, PredInfo, SchemaInfo, VarInfo } from './index';
import { parseTerm } from './parser';
import { children, freeVars, nameTerm, printTerm } from './print';
import type { OpExample, PredCheck, ShownVar, StateExample, TypesExample } from './results';
import type { ZType } from './types';
import { EMPTY, atom, int, mkSet, printValue, tuple, valueEquals, type Value } from './values';
import { compileDom, intScaleFor, isEmptyDom, type Dom } from './gen/dom';
import { truth } from './gen/dist';
import { makeRng, type Rng } from './gen/rng';
import { buildPlan, findWitness, isDetermined, now, solve, type Con, type Problem, type SolveResult, type Unknown } from './gen/solver';

/** Time budget per call (ms). Most calls finish far earlier. */
const BUDGET = 45;
/** Integer bounds for enumerating ℕ / ℤ (quantifiers, comprehensions). */
const INT_MIN = -5;
const INT_MAX = 20;

// ── universe ───────────────────────────────────────────────────────────────────

/**
 * Example carriers of the given sets: 4–6 values of each pool (in pool order), always
 * including the values used by `spec.fixed`; sets without a pool get name1 … name5
 * (TRAIN → train1, train2, …).
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

  const carriers: Record<string, Value[]> = {};
  for (const set of an.givenSets) {
    const rng = makeRng(seed, `carrier:${set}`);
    const req = required.get(set) ?? new Set<string>();
    const pool = cleanPool(spec, set);
    if (pool.length) {
      let chosen: Set<string>;
      if (exact.has(set) && req.size) chosen = new Set(req);
      else {
        const k = Math.min(pool.length, 4 + rng.int(3));
        const others = pool.filter((n) => !req.has(n));
        chosen = new Set([...req, ...rng.sample(others, k - req.size)]);
      }
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

function prepare(spec: SpecDoc, an: Analysis, seed: number): Prepared {
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
  return { u, fixed, givens: new Set(an.givenSets), deadline: start + BUDGET, consts: specConstants(an) };
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

function check(p: PredInfo, env: ReadonlyMap<string, Value>, u: Universe): PredCheck {
  const { result, message, bounded } = truth(p.term, new Map(env), u);
  const c: PredCheck = { origin: p.origin, text: printTerm(p.term), result };
  if (bounded) c.bounded = true;
  if (p.section) c.section = p.section;
  if (p.index !== undefined) c.index = p.index;
  if (message) c.message = message;
  return c;
}

const q = (s: string) => `‘${s}’`;

// ── state and initial state ────────────────────────────────────────────────────

/** A state satisfying the invariant (fixed data from spec.fixed where possible). */
export function exampleState(spec: SpecDoc, an: Analysis, seed: number): StateExample {
  return guard(
    () => stateExample(spec, an, seed),
    () => ({ kind: 'state', ok: false, message: NO_EXAMPLE }),
  );
}

function stateExample(spec: SpecDoc, an: Analysis, seed: number): StateExample {
  const prep = prepare(spec, an, seed);
  const st = stateSchema(an);
  if (!st) return { kind: 'state', ok: true, vars: [], checks: [] };
  return schemaExample(prep, st, makeRng(seed, 'state'), {
    penalizeEmpty: true,
    statuses: false,
    fixedName: (v) => (v.role === 'state' ? v.base : null),
    fail: NOT_FOUND,
  });
}

/**
 * The initial state: the variables of the Init schema (state imported with or without ′).
 * Like an after-state, each value is 'computed' or 'free' (Init does not fix it).
 */
export function exampleInit(spec: SpecDoc, an: Analysis, seed: number): StateExample {
  return guard(
    () => initExample(spec, an, seed),
    () => ({ kind: 'state', ok: false, message: NO_EXAMPLE }),
  );
}

function initExample(spec: SpecDoc, an: Analysis, seed: number): StateExample {
  const prep = prepare(spec, an, seed);
  const init = an.schemas.find((s) => s.role === 'init');
  if (!init) return { kind: 'state', ok: false, message: 'There is no Init schema.' };
  if (!init.initImport) return { kind: 'state', ok: false, message: 'Init does not import the state yet.' };
  return schemaExample(prep, init, makeRng(seed, 'init'), {
    penalizeEmpty: false,
    statuses: true,
    fixedName: (v) => (v.role === 'state' || v.role === 'state′' ? v.base : null),
    fail: 'No initial state found with small values.',
  });
}

function schemaExample(
  prep: Prepared,
  schema: SchemaInfo,
  rng: Rng,
  opts: { penalizeEmpty: boolean; statuses: boolean; fixedName: (v: VarInfo) => string | null; fail: string },
): StateExample {
  const vars = usableVars(schema, prep);
  const preds = usablePreds(schema.preds, vars, prep);
  let problem: Problem | null = null;
  const { res, fixedNames } = withFixed(prep, (useFixed) => {
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
        initValue: fx,
        initProb: fx ? 0.9 : undefined,
        penalizeEmpty: opts.penalizeEmpty,
      });
    }
    const pr: Problem = { u: prep.u, known, unknowns, cons: preds.map((p) => hard(p)) };
    const res = solve(pr, rng, { maxSteps: 3000, deadline: prep.deadline, softSteps: 40 });
    if (res.ok || !problem) problem = pr;
    return { res, fixedNames };
  });
  const plan = opts.statuses && res.ok && problem ? buildPlan(problem) : null;
  const statusOf = (name: string): Partial<ShownVar> => {
    if (fixedNames.has(name)) return { fixed: true };
    if (!plan || !problem) return {};
    if (!isDetermined(plan, name) && now() < prep.deadline) {
      const w = findWitness(problem, name, res.env, rng, prep.deadline);
      if (w) return { status: 'free', alternative: printValue(w), alternativeValue: w };
    }
    return { status: 'computed' };
  };
  const shownVars = vars.map((v) => shown(v.info.name, res.env.get(v.info.name), statusOf(v.info.name)));
  const checks = preds.map((p) => check(p, res.env, prep.u));
  if (res.ok) return { kind: 'state', ok: true, vars: shownVars, checks };
  return { kind: 'state', ok: false, message: opts.fail, best: { vars: shownVars, failed: checks.filter((c) => c.result !== true) } };
}

function unknownOf(v: UVar): Unknown {
  return { name: v.info.name, dom: v.dom, declared: v.info.declared, rank: RANK[v.info.role] };
}

/** Try with fixed data first; if that fails, again with fixed data only as a starting point. */
function withFixed<T extends { res: SolveResult; fixedNames: Set<string> }>(prep: Prepared, attempt: (useFixed: boolean) => T): T {
  const first = attempt(true);
  if (first.res.ok || !first.fixedNames.size || now() > prep.deadline) return first;
  const second = attempt(false);
  return second.res.ok ? second : first;
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
}

/**
 * One run of an operation. 'applicable': a before-state and inputs for which the
 * operation works, with the after-state and outputs solved from the predicates
 * (statuses say whether each is computed, unchanged, or not determined by the spec).
 * 'blocked': a valid before-state and inputs for which a precondition is false.
 */
export function exampleOperation(spec: SpecDoc, an: Analysis, opId: string, seed: number, mode: 'applicable' | 'blocked'): OpExample {
  return guard(
    () => operationExample(spec, an, opId, seed, mode),
    () => ({ kind: 'op', ok: false, reason: mode === 'blocked' ? 'no-blocked' : 'no-input', message: NO_EXAMPLE }),
  );
}

function operationExample(spec: SpecDoc, an: Analysis, opId: string, seed: number, mode: 'applicable' | 'blocked'): OpExample {
  const prep = prepare(spec, an, seed);
  const op = an.byId[opId];
  if (!op || op.role !== 'operation') return { kind: 'op', ok: false, reason: 'no-input', message: 'Unknown operation.' };
  const vars = usableVars(op, prep);
  const preds = usablePreds(op.preds, vars, prep);
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
  };
  const rng = makeRng(seed, `op:${opId}:${mode}`);
  return mode === 'blocked' ? blockedCase(parts, rng) : applicableCase(parts, rng);
}

/** Before-state variables: fixed data as known values (or as a start value only). */
function beforeUnknowns(x: OpParts, useFixed: boolean, known: Map<string, Value>, fixedNames: Set<string>): Unknown[] {
  const out: Unknown[] = [];
  for (const v of x.before) {
    const fx = x.prep.fixed.get(v.info.base);
    if (fx && useFixed) {
      known.set(v.info.name, fx);
      fixedNames.add(v.info.name);
    } else out.push({ ...unknownOf(v), initValue: fx, initProb: fx ? 0.9 : undefined, penalizeEmpty: true });
  }
  return out;
}

const afterUnknowns = (x: OpParts): Unknown[] => [
  ...x.after.map((v) => ({ ...unknownOf(v), initFrom: v.info.base, initProb: 0.9 })),
  ...x.outputs.map(unknownOf),
];

function applicableCase(x: OpParts, rng: Rng): OpExample {
  const { prep } = x;
  const jointDeadline = Math.min(prep.deadline, now() + BUDGET * 0.6);
  const joint = withFixed(prep, (useFixed) => {
    const known = new Map<string, Value>();
    const fixedNames = new Set<string>();
    const unknowns = [...beforeUnknowns(x, useFixed, known, fixedNames), ...x.inputs.map(unknownOf), ...afterUnknowns(x)];
    const problem: Problem = { u: prep.u, known, unknowns, cons: x.preds.map((p) => hard(p)) };
    const change = changePreference(x, problem);
    if (change) problem.cons.push(change);
    const res = solve(problem, rng, { maxSteps: 2500, deadline: jointDeadline, softSteps: 40 });
    return { res, fixedNames };
  });
  if (joint.res.ok) return applicableResult(x, joint.res.env, joint.fixedNames, rng);

  // Diagnose: is there a valid before-state + inputs at all? (invariant first)
  const phaseA = withFixed(prep, (useFixed) => {
    const known = new Map<string, Value>();
    const fixedNames = new Set<string>();
    const unknowns = [...beforeUnknowns(x, useFixed, known, fixedNames), ...x.inputs.map(unknownOf)];
    const cons = [...x.inv.map((p) => hard(p, 5)), ...x.pres.map((p) => hard(p))];
    const res = solve({ u: prep.u, known, unknowns, cons }, rng, {
      maxSteps: 1500,
      deadline: Math.min(prep.deadline, now() + BUDGET * 0.2),
      softSteps: 20,
    });
    return { res, fixedNames };
  });
  const A = phaseA.res;
  const beforeShown = () => x.before.map((v) => shown(v.info.name, A.env.get(v.info.name), phaseA.fixedNames.has(v.info.name) ? { fixed: true } : {}));
  const inputsShown = () => x.inputs.map((v) => shown(v.info.name, A.env.get(v.info.name)));
  if (!A.ok) {
    const failed = A.violated.map(tagOf);
    const invBad = failed.filter((p) => p.origin === 'invariant');
    if (invBad.length || !x.pres.length) {
      return {
        kind: 'op',
        ok: false,
        reason: 'no-before',
        message: 'No example state found with small values.',
        failed: invBad.map((p) => check(p, A.env, prep.u)),
      };
    }
    return {
      kind: 'op',
      ok: false,
      reason: 'no-input',
      message: `No example found with small values in which the precondition${x.pres.length > 1 ? 's hold' : ' holds'}.`,
      before: beforeShown(),
      inputs: inputsShown(),
      failed: failed.map((p) => check(p, A.env, prep.u)),
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
  let message: string;
  // (only the Ξ conflict is certain; otherwise larger values might still work)
  if (xi) message = `No after-state fits: Ξ keeps ${q(printTerm(xi.term))}.`;
  else if (broken) message = `No after-state found with small values: ${q(printTerm(broken.term))} fails.`;
  else if (failedPreds.length) message = `No after-state found with small values: ${q(printTerm(failedPreds[0].term))} fails.`;
  else if (B.badDecls.length) {
    const v = [...x.after, ...x.outputs].find((w) => w.info.name === B.badDecls[0]);
    message = v
      ? `No after-state found with small values: ${v.info.name} would not be in ${printTerm(v.info.declared)}.`
      : 'No after-state found with small values.';
  } else message = 'No after-state found with small values.';
  return {
    kind: 'op',
    ok: false,
    reason: 'no-after',
    message,
    before: beforeShown(),
    inputs: inputsShown(),
    failed: failedPreds.map((p) => check(p, B.env, prep.u)),
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
    const name = v.info.name;
    if (!isDetermined(plan, name) && now() < prep.deadline) {
      const w = findWitness(problem, name, env, rng, prep.deadline);
      if (w) return { status: 'free', alternative: printValue(w), alternativeValue: w };
    }
    const val = env.get(name);
    const old = env.get(v.info.base);
    return { status: isAfter && val && old && valueEquals(val, old) ? 'unchanged' : 'computed' };
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

function blockedCase(x: OpParts, rng: Rng): OpExample {
  const { prep, pres } = x;
  if (!pres.length) {
    const name = x.op.name || 'This operation';
    return { kind: 'op', ok: false, reason: 'no-blocked', message: `${name} has no precondition, so it is never blocked.` };
  }
  const start = rng.int(pres.length);
  for (let k = 0; k < pres.length; k++) {
    if (now() > prep.deadline) break;
    const target = pres[(start + k) % pres.length];
    const others = pres.filter((p) => p !== target);
    const negated: Term = { kind: 'not', arg: target.term, span: target.term.span };
    const share = Math.min(prep.deadline, now() + BUDGET / pres.length);
    const { res, fixedNames } = withFixed(prep, (useFixed) => {
      const known = new Map<string, Value>();
      const fixedNames = new Set<string>();
      const unknowns = [...beforeUnknowns(x, useFixed, known, fixedNames), ...x.inputs.map(unknownOf)];
      const cons: Con[] = [
        ...x.inv.map((p) => hard(p)),
        { term: negated, hard: true, weight: 1, tag: target },
        ...others.map((p) => ({ term: p.term, hard: false, weight: 0.3, tag: p })),
      ];
      const res = solve({ u: prep.u, known, unknowns, cons }, rng, { maxSteps: 1200, deadline: share, softSteps: 30 });
      return { res, fixedNames };
    });
    if (!res.ok) continue;
    const env = res.env;
    const shownPreds = x.preds.filter((p) => p.origin === 'invariant' || pres.includes(p));
    return {
      kind: 'op',
      ok: true,
      status: 'blocked',
      before: x.before.map((v) => shown(v.info.name, env.get(v.info.name), fixedNames.has(v.info.name) ? { fixed: true } : {})),
      inputs: x.inputs.map((v) => shown(v.info.name, env.get(v.info.name))),
      after: [],
      outputs: [],
      checks: shownPreds.map((p) => check(p, env, prep.u)),
      failed: pres.map((p) => check(p, env, prep.u)).filter((c) => c.result !== true),
    };
  }
  return { kind: 'op', ok: false, reason: 'no-blocked', message: 'No blocked case found with small values.' };
}
