// Step goals (docs/design.md, "Step goals"): short, system-specific goals per step whose
// status dot turns green once the student's spec achieves them. Goals are written with
// the names of the template's reference spec and checked independently of names:
//
//   given  the student declared a given set with that name (case-insensitive, a
//          trailing S ignored)
//   var    the reference variable(s) can be matched to student variables of the same
//          type (state variables; inputs ? and outputs ! of the operation)
//   holds  under that matching, the predicate holds in every sampled example of the
//          student's spec (valid states, initial states, or operation runs; values
//          the spec leaves open are also tried with their alternatives). At least one
//          example must exist. A bounded check, fine for a progress indicator.
//
// The matching is one injective, type-preserving map for the state variables of the
// whole spec and one per operation for its inputs and outputs, chosen to achieve the
// most goals (ties: declaration order).
//
// Cost: the examples dominate. They are sampled once per step (independently of the
// matching) and memoised by the step's text, so after an edit only the changed step
// is sampled again. A whole template spec takes ~50–100 ms the first time.

import type { SchemaDoc, SpecDoc } from '../spec/model';
import type { Term } from './ast';
import { evalPred, type Env, type Universe } from './eval';
import { exampleInit, exampleOperation, exampleState, universeFor } from './generate';
import { analyseSpec, type Analysis, type SchemaInfo, type VarInfo } from './index';
import { parseTerm } from './parser';
import { freeVars, rename } from './print';
import type { ShownVar } from './results';
import { power, product, typeEquals, type ZType } from './types';
import type { Value } from './values';

// ── public types ───────────────────────────────────────────────────────────────

/** How a goal is checked (names refer to the template's reference spec). */
export interface GoalCheck {
  given?: string;
  var?: string | string[];
  holds?: string;
}
export interface Goal {
  text: string;
  check: GoalCheck;
}
/** Goals per step, as in templates/*.json: operations by their template name. */
export interface TemplateGoals {
  types?: Goal[];
  state?: Goal[];
  init?: Goal[];
  ops?: Record<string, Goal[]>;
}
export interface GoalStatus {
  text: string;
  achieved: boolean;
}
export interface GoalOptions {
  /** Examples sampled per state / operation step (default 10). */
  seeds?: number;
  /** Examples sampled for Init (default 6). */
  initSeeds?: number;
}

/**
 * Check all goals of a template against the student's spec.
 * `reference` is the template's full spec with the same operation ids as `spec`.
 * Result keys: 'types', 'state', 'init' and operation ids (for the steps that have goals).
 */
export function checkGoals(
  spec: SpecDoc,
  an: Analysis,
  reference: SpecDoc,
  goals: TemplateGoals,
  opts: GoalOptions = {},
): Record<string, GoalStatus[]> {
  const ref = refAnalysis(reference);
  const givenMap = matchGivens(ref.givenSets, an.givenSets);
  const out: Record<string, GoalStatus[]> = {};
  if (goals.types) out.types = goals.types.map((g) => ({ text: g.text, achieved: givenAchieved(g.check, an) }));

  // the steps with goals, and their samples (examples of the student's spec)
  const steps: Step[] = [];
  const nSeeds = opts.seeds ?? 10;
  const stateSamples = goals.state || goals.init || goals.ops ? samplesFor(spec, an, 'state', nSeeds) : [];
  if (goals.state) steps.push({ key: 'state', kind: 'state', goals: goals.state, samples: stateSamples });
  if (goals.init) {
    // without valid states there are no valid initial states either
    const samples = stateSamples.length ? samplesFor(spec, an, 'init', opts.initSeeds ?? 6) : [];
    steps.push({ key: 'init', kind: 'init', goals: goals.init, samples });
  }
  for (const [name, gs] of Object.entries(goals.ops ?? {})) {
    const id = reference.operations.find((o) => o.name === name)?.id;
    if (!id) continue;
    const student = an.byId[id];
    if (!student || student.role !== 'operation') {
      out[id] = gs.map((g) => ({ text: g.text, achieved: false }));
      continue;
    }
    const samples = stateSamples.length ? samplesFor(spec, an, id, nSeeds) : [];
    steps.push({ key: id, kind: 'op', goals: gs, samples, student, refOp: ref.byId[id] });
  }

  const typeOf = translator(givenMap);
  const refState = ref.byId.state?.vars.filter((v) => v.role === 'state') ?? [];
  const stuState = an.byId.state?.vars.filter((v) => v.role === 'state') ?? [];
  const initPrimed = an.byId.init?.initImport === 'primed';
  const ctx: Ctx = { givenMap, initPrimed };

  // Choose the state matching (and per operation the input/output matching) that
  // achieves the most goals; the first candidate is the declaration-order one.
  let best: { score: number; results: Map<string, boolean[]> } | null = null;
  const total = steps.reduce((n, s) => n + s.goals.length, 0);
  for (const sm of matchings(refState, stuState, typeOf)) {
    const results = new Map<string, boolean[]>();
    let score = 0;
    for (const step of steps) {
      let stepBest: boolean[] | null = null;
      const opMaps = step.kind === 'op' ? ioMatchings(step.refOp, step.student, typeOf) : [new Map<string, string>()];
      for (const om of opMaps) {
        const r = step.goals.map((g) => achieved(g, step, sm, om, ctx));
        if (!stepBest || count(r) > count(stepBest)) stepBest = r;
        if (count(r) === r.length) break;
      }
      results.set(step.key, stepBest ?? step.goals.map(() => false));
      score += count(results.get(step.key)!);
    }
    if (!best || score > best.score) best = { score, results };
    if (score === total) break;
  }
  for (const step of steps) {
    const r = best?.results.get(step.key) ?? step.goals.map(() => false);
    out[step.key] = step.goals.map((g, i) => ({ text: g.text, achieved: r[i] }));
  }
  return out;
}

// ── steps and samples ──────────────────────────────────────────────────────────

interface Sample {
  env: Env;
  u: Universe;
}

type Step =
  | { key: string; kind: 'state' | 'init'; goals: Goal[]; samples: Sample[] }
  | { key: string; kind: 'op'; goals: Goal[]; samples: Sample[]; student: SchemaInfo; refOp?: SchemaInfo };

interface Ctx {
  givenMap: Map<string, string>;
  /** The student's Init imports the state as `State′` (its variables are primed). */
  initPrimed: boolean;
}

const sampleCache = new Map<string, Sample[]>();
const CACHE_SIZE = 64;

/**
 * Examples of one step ('state', 'init' or an operation id), memoised by everything
 * the examples depend on. Sampling stops at the first seed without an example (a
 * failing search costs the most and the next seeds would most likely fail too).
 */
function samplesFor(spec: SpecDoc, an: Analysis, stepId: string, n: number): Sample[] {
  const doc: SchemaDoc | null | undefined =
    stepId === 'state' ? spec.state : stepId === 'init' ? spec.init : spec.operations.find((o) => o.id === stepId);
  if (!doc) return [];
  const key = JSON.stringify([
    stepId,
    n,
    spec.given,
    spec.pools,
    spec.infinite,
    spec.fixed,
    spec.state.name,
    spec.state.decls,
    spec.state.preds,
    doc.decls,
    doc.preds,
    // numbers written anywhere in the spec are example candidates
    allText(spec).match(/\d+/g)?.join(','),
  ]);
  const hit = sampleCache.get(key);
  if (hit) return hit;

  const schema = an.byId[stepId];
  const samples: Sample[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const u = universeFor(spec, an, seed);
    let vars: ShownVar[] | null = null;
    if (stepId === 'state') {
      const ex = exampleState(spec, an, seed);
      vars = ex.ok ? ex.vars : null;
    } else if (stepId === 'init') {
      const ex = exampleInit(spec, an, seed);
      vars = ex.ok ? ex.vars : null;
    } else {
      const ex = exampleOperation(spec, an, stepId, seed, 'applicable');
      vars = ex.ok && ex.status === 'applicable' ? [...ex.before, ...ex.inputs, ...ex.after, ...ex.outputs] : null;
    }
    if (!vars) break;
    const env = new Map(vars.map((v) => [v.name, v.value] as [string, Value]));
    samples.push({ env, u });
    // values the spec leaves open: also try their alternatives (if still a valid example)
    for (const v of vars) {
      if (v.status !== 'free' || !v.alternativeValue) continue;
      const alt = new Map(env);
      alt.set(v.name, v.alternativeValue);
      if (schema && valid(schema, alt, u)) samples.push({ env: alt, u });
    }
  }
  sampleCache.set(key, samples);
  if (sampleCache.size > CACHE_SIZE) sampleCache.delete(sampleCache.keys().next().value!);
  return samples;
}

const allText = (spec: SpecDoc) =>
  [spec.state, spec.init, ...spec.operations].map((d) => (d ? `${d.decls}\n${d.preds}` : '')).join('\n');

/** All usable predicates of the schema hold in `env`. */
function valid(schema: SchemaInfo, env: Env, u: Universe): boolean {
  return schema.preds.every((p) => {
    if (!p.ok || [...freeVars(p.term)].some((n) => !env.has(n) && !(n in u.carriers))) return true;
    try {
      return evalPred(p.term, env, u);
    } catch {
      return false;
    }
  });
}

// ── goals ──────────────────────────────────────────────────────────────────────

const normGiven = (n: string) => n.toLowerCase().replace(/s$/, '');

function givenAchieved(check: GoalCheck, an: Analysis): boolean {
  if (!check.given) return false;
  const want = normGiven(check.given);
  return an.givenSets.some((g) => normGiven(g) === want);
}

/** Reference given set → the student's given set with the same normalised name. */
function matchGivens(refSets: string[], stuSets: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of refSets) {
    const s = stuSets.find((x) => normGiven(x) === normGiven(r));
    if (s) m.set(r, s);
  }
  return m;
}

const termCache = new Map<string, Term | null>();
function goalTerm(text: string): Term | null {
  if (!termCache.has(text)) termCache.set(text, parseTerm(text).term);
  return termCache.get(text)!;
}

/**
 * Is the goal achieved under the state matching `sm` (reference → student, unprimed
 * names) and the operation's input/output matching `om`?
 */
function achieved(g: Goal, step: Step, sm: Map<string, string>, om: Map<string, string>, ctx: Ctx): boolean {
  const c = g.check;
  if (c.given) return false; // given goals belong to the Types step
  const names = new Map<string, string>(); // reference name → student name for this step
  for (const [r, s] of sm) {
    if (step.kind === 'init') {
      const t = ctx.initPrimed ? s + '′' : s;
      names.set(r, t);
      names.set(r + '′', t);
    } else {
      names.set(r, s);
      if (step.kind === 'op') names.set(r + '′', s + '′');
    }
  }
  for (const [r, s] of om) names.set(r, s);
  if (c.var !== undefined) {
    const vars = Array.isArray(c.var) ? c.var : [c.var];
    if (!vars.every((v) => names.has(v))) return false;
  }
  if (c.holds === undefined) return c.var !== undefined;
  const t = goalTerm(c.holds);
  if (!t || !step.samples.length) return false;
  for (const [r, s] of ctx.givenMap) names.set(r, s);
  for (const n of freeVars(t)) if (!names.has(n)) return false;
  const translated = rename(t, names);
  return step.samples.every(({ env, u }) => {
    try {
      return evalPred(translated, env, u);
    } catch {
      return false;
    }
  });
}

// ── matchings ──────────────────────────────────────────────────────────────────

const MAX_MATCHINGS = 48;
const count = (r: boolean[]) => r.filter(Boolean).length;

/** Reference type → the same type over the student's given sets (null if one is missing). */
function translator(givenMap: Map<string, string>): (t: ZType) => ZType | null {
  const tr = (t: ZType): ZType | null => {
    switch (t.k) {
      case 'given': {
        const n = givenMap.get(t.name);
        return n ? { k: 'given', name: n } : null;
      }
      case 'power': {
        const e = tr(t.elem);
        return e && power(e);
      }
      case 'product': {
        const es = t.elems.map(tr);
        return es.every((e) => e) ? product(es as ZType[]) : null;
      }
      default:
        return t;
    }
  };
  return tr;
}

/**
 * Injective, type-preserving matchings of reference variables to student variables,
 * in declaration order (so the first one is the tie-breaker). Each reference variable
 * is matched whenever a compatible student variable is still free.
 */
function matchings(refs: VarInfo[], stus: VarInfo[], typeOf: (t: ZType) => ZType | null): Map<string, string>[] {
  const cands = refs.map((r) => {
    const t = typeOf(r.type);
    return t ? stus.filter((s) => typeEquals(t, s.type)) : [];
  });
  const out: Map<string, string>[] = [];
  const cur = new Map<string, string>();
  const used = new Set<string>();
  const go = (i: number) => {
    if (out.length >= MAX_MATCHINGS) return;
    if (i === refs.length) {
      out.push(new Map(cur));
      return;
    }
    const free = cands[i].filter((s) => !used.has(s.name));
    if (!free.length) return go(i + 1);
    for (const s of free) {
      cur.set(refs[i].name, s.name);
      used.add(s.name);
      go(i + 1);
      cur.delete(refs[i].name);
      used.delete(s.name);
    }
  };
  go(0);
  return out;
}

/** Matchings of an operation's inputs to inputs and outputs to outputs. */
function ioMatchings(refOp: SchemaInfo | undefined, stu: SchemaInfo, typeOf: (t: ZType) => ZType | null): Map<string, string>[] {
  if (!refOp) return [new Map()];
  const pick = (s: SchemaInfo, role: VarInfo['role']) => s.vars.filter((v) => v.role === role);
  const ins = matchings(pick(refOp, 'input'), pick(stu, 'input'), typeOf);
  const outs = matchings(pick(refOp, 'output'), pick(stu, 'output'), typeOf);
  const all: Map<string, string>[] = [];
  for (const a of ins) for (const b of outs) if (all.length < MAX_MATCHINGS) all.push(new Map([...a, ...b]));
  return all;
}

// ── reference analysis (cached) ────────────────────────────────────────────────

const refCache = new Map<string, Analysis>();
function refAnalysis(reference: SpecDoc): Analysis {
  const key = JSON.stringify(reference);
  let a = refCache.get(key);
  if (!a) {
    a = analyseSpec(reference);
    refCache.set(key, a);
    if (refCache.size > 8) refCache.delete(refCache.keys().next().value!);
  }
  return a;
}

/** For tests: forget memoised examples. */
export function clearGoalCache(): void {
  sampleCache.clear();
  refCache.clear();
}
