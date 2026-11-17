// Step goals (docs/design.md, "Step goals"): short, system-specific goals per step whose
// status dot turns green once the student's spec achieves them. Goals are written with
// the names of the template's reference spec and checked independently of names:
//
//   given  the reference's given set is matched to one of the student's (by how the
//          sets are used, see below; by name only when nothing uses them yet)
//   var    the reference variable(s) can be matched to student variables of the same
//          type (state variables; inputs ? and outputs ! of the operation)
//   holds  under that matching, in this order:
//          1. proof: the inference engine proves the predicate from the step's premises
//             (own lines, declarations, Ξ, the invariant before / after, the frame
//             convention, derived effects and guarantees) → achieved, with derivation;
//          2. counterexample: a sampled example, or a targeted search for a valid
//             example in which the predicate is false → not achieved, with the example;
//          3. examples: otherwise achieved if valid examples exist (a bounded check).
//          Achieved goals are 'stated' if the step's own content ensures them (own lines,
//          declarations, Ξ), else 'inferred' (the invariant or the frame convention).
//
// The matching: a bijection between the given sets and one injective, type-preserving
// map for the state variables of the whole spec (reference variables may stay
// unmatched), chosen by the State goals alone (most achieved; ties: more similar names,
// then identical types before other encodings before inverses, then declaration order),
// so that operations cannot pull same-typed variables their way. Each operation then
// gets the input/output matching achieving most of its goals. Other encodings of the
// same information also match: a relation X ↔ Y and a function to sets X → ℙ Y (or
// X ⇸ ℙ Y); a relation and its inverse (also X ↔ X read the other way round); numbers
// negated (a limit as the lowest balance for an overdraft). The student's values are
// converted to the reference's encoding before the reference predicate is evaluated on
// them. If the reference declares a function (⇸, →) and the student's encoding does not
// guarantee it, the reference declaration must hold in every example and survive a
// targeted search for a counterexample; otherwise the goals that apply the function are
// not achieved, with that counterexample. A var goal also needs the student's
// declaration to admit the reference's values (several allergies per patient). In
// "unchanged" goals (v′ = v ∧ …) unmatched variables are left out.
//
// Automatic goals, after the template's: "Allows every state the requirements allow"
// (State) and "Runs whenever it should" (each operation), checked the other way round:
// on the reference's examples, read in the student's encoding.
//
// Counterexamples are shrunk (set elements dropped, numbers nearer 0) while they stay
// valid and still break the goal. The matching also tells the generator which template
// pools and fixed data the student's sets and variables take (exampleBinding).
//
// Determinism: all searches count work instead of milliseconds (gen/clock), so the
// verdicts are the same on every machine and under any load.
//
// Cost: the examples dominate. They are sampled once per step (independently of the
// matching) and memoised by the step's text, so after an edit only the changed step
// is sampled again; proofs, searches and verdicts are memoised too. A whole template
// spec takes ~30–120 ms the first time and well under 1 ms when nothing changed.

import type { Derivation, SchemaDoc, SpecDoc } from '../spec/model';
import { proveGoal } from './infer';
import type { Term } from './ast';
import { enumerateSet, evalPred, evalTerm, memberOfDeclared, type Env, type Universe } from './eval';
import { exampleInit, exampleOperation, exampleState, universeFor } from './generate';
import { deterministically } from './gen/clock';
import { analyseSpec, type Analysis, type SchemaInfo, type VarInfo } from './index';
import { parseTerm } from './parser';
import { freeVars, nameTerm, printTerm, rename, substitute } from './print';
import type { ExampleBinding, ShownVar } from './results';
import { power, product, relationParts, typeEquals, type ZType } from './types';
import { int, isPair, isSetLike, mkSet, pair, printValue, valueKey, type Value } from './values';

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
/** Why a goal is (not) achieved. */
export type GoalEvidence =
  /** Proven from the step's premises. */
  | { kind: 'proof'; derivation: Derivation }
  /** No proof, but no counterexample either: it held in all examples tried. */
  | { kind: 'examples' }
  /** A valid example of the step in which the goal is false (the variables it mentions). */
  | { kind: 'counterexample'; vars: ShownVar[] };

export interface GoalStatus {
  text: string;
  achieved: boolean;
  /**
   * For achieved goals: 'stated' if the step's own content ensures it (its predicate
   * lines, declarations, and what Δ / Ξ say explicitly), 'inferred' if it needs the
   * state invariant or the frame convention.
   */
  via?: 'stated' | 'inferred';
  /** For 'holds' goals: the proof, the counterexample, or that it rests on examples. */
  evidence?: GoalEvidence;
}
export interface GoalOptions {
  /** Examples sampled per state / operation step (default 10). */
  seeds?: number;
  /** Examples sampled for Init (default 6). */
  initSeeds?: number;
  /** Time budget per sampled example in ms (default: the generator's). */
  sampleBudgetMs?: number;
  /**
   * Count work instead of milliseconds for all time budgets (gen/clock), so that the
   * verdicts are the same on every machine and under any load (default true).
   */
  deterministic?: boolean;
  /** The targeted counterexample search: budget per attempt (ms) and attempts (seeds). */
  search?: SearchEffort;
}

/** How hard the targeted search for a counterexample tries, per step kind. */
export interface SearchEffort {
  ms: number;
  seeds: number;
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
  const deterministic = opts.deterministic ?? true;
  const o = { ...opts, deterministic };
  return deterministic ? deterministically(() => check(spec, an, reference, goals, o)) : check(spec, an, reference, goals, o);
}

function check(spec: SpecDoc, an: Analysis, reference: SpecDoc, goals: TemplateGoals, opts: GoalOptions): Record<string, GoalStatus[]> {
  const ref = refAnalysis(reference);
  const out: Record<string, GoalStatus[]> = {};

  const nSeeds = opts.seeds ?? 10;
  const budget = opts.sampleBudgetMs;
  const mode = opts.deterministic ? 'work' : 'time';
  const initPrimed = an.byId.init?.initImport === 'primed';
  const search = opts.search ?? null;
  goalsByReference.set(referenceId(reference), goals);
  // the matching, chosen on examples of the student's state; if the student's names
  // differ from the template's, the examples are made again with the template's pools
  // and fixed data for what they stand for (the binding), and the matching chosen again
  const sampling = goals.state || goals.init || goals.ops;
  let stateSamples = sampling ? samplesFor(spec, an, 'state', nSeeds, mode, budget) : [];
  let { gm, sm } = chooseMatching(spec, an, ref, goals.state ? { key: 'state', kind: 'state', goals: goals.state, samples: stateSamples } : undefined, stateSamples, { initPrimed, mode, search });
  let binding: ExampleBinding | undefined = bindingOf(gm, sm);
  if (sameAsByName(binding, spec, an)) binding = undefined;
  else {
    stateSamples = sampling ? samplesFor(spec, an, 'state', nSeeds, mode, budget, binding) : [];
    ({ gm, sm } = chooseMatching(spec, an, ref, goals.state ? { key: 'state', kind: 'state', goals: goals.state, samples: stateSamples } : undefined, stateSamples, { initPrimed, mode, search, binding }));
  }

  // the steps with goals, and their samples (examples of the student's spec)
  const steps: Step[] = [];
  if (goals.state) steps.push({ key: 'state', kind: 'state', goals: goals.state, samples: stateSamples });
  if (goals.init) {
    // without valid states there are no valid initial states either
    const samples = stateSamples.length ? samplesFor(spec, an, 'init', opts.initSeeds ?? 6, mode, budget, binding) : [];
    steps.push({ key: 'init', kind: 'init', goals: goals.init, samples });
  }
  const missingOps = new Set<string>();
  for (const [name, gs] of Object.entries(goals.ops ?? {})) {
    const id = reference.operations.find((o) => o.name === name)?.id;
    if (!id) continue;
    const student = an.byId[id];
    if (!student || student.role !== 'operation') {
      missingOps.add(id);
      out[id] = gs.map((g) => ({ text: g.text, achieved: false }));
      continue;
    }
    const samples = stateSamples.length ? samplesFor(spec, an, id, nSeeds, mode, budget, binding) : [];
    steps.push({ key: id, kind: 'op', goals: gs, samples, student, refOp: ref.byId[id] });
  }

  const givenMap = gm;
  const typeOf = translator(givenMap);
  const ctx: Ctx = { givenMap, initPrimed, mode, search, binding };
  if (goals.types) {
    out.types = goals.types.map((g) => {
      const achieved = !!g.check.given && [...givenMap.keys()].some((r) => normGiven(r) === normGiven(g.check.given!));
      return achieved ? { text: g.text, achieved, via: 'stated' as const } : { text: g.text, achieved };
    });
  }
  // per step: the operation's input/output matching achieving the most of its goals
  // (ties: more similar names, then the natural order)
  const results = new Map<string, boolean[]>();
  const oms = new Map<string, Map<string, Match>>();
  for (const step of steps) {
    const fp = stepKey(spec, step.key, ctx.binding);
    let stepBest: boolean[] | null = null;
    let stepOm = new Map<string, Match>();
    let stepSim = 0;
    for (const om of step.kind === 'op' ? ioMatchings(step.refOp, step.student, typeOf, givenMap) : [new Map<string, Match>()]) {
      const r = sampledResults(fp, step, stepNames(step, sm, om, ctx), ctx);
      const sim = similarity(om);
      if (!stepBest || count(r) > count(stepBest) || (count(r) === count(stepBest) && sim > stepSim)) {
        stepBest = r;
        stepOm = om;
        stepSim = sim;
      }
      if (count(r) === r.length) break;
    }
    results.set(step.key, stepBest ?? step.goals.map(() => false));
    oms.set(step.key, stepOm);
  }
  // reference declarations the student's encoding does not guarantee (checked once, on the state)
  const stateStep: Step = steps.find((st) => st.kind === 'state') ?? { key: 'state', kind: 'state', goals: [], samples: stateSamples };
  const decls = declVerdicts(spec, an, stateStep, sm, ctx);
  const admits = admitVerdicts(reference, ref, an, sm, givenMap, goals.state ?? [], ctx);
  for (const step of steps) {
    const names = stepNames(step, sm, oms.get(step.key) ?? new Map(), ctx);
    out[step.key] = judged(spec, an, step, results.get(step.key)!, names, decls, step.kind === 'state' ? admits : new Map(), ctx);
  }
  // goals of every template: not stricter than the requirements
  const rs = refSide(reference, ref, an, sm, givenMap);
  if (goals.state && out.state) out.state = [...out.state, allowsStates(spec, rs, an, sm, stateStep, ctx)];
  for (const id of missingOps) out[id] = [...out[id], { text: RUNS_WHEN, achieved: false }];
  for (const step of steps) {
    if (step.kind !== 'op') continue;
    out[step.key] = [...out[step.key], runsWhen(spec, rs, an, step, sm, oms.get(step.key) ?? new Map(), ctx)];
  }
  return out;
}

/** The reference given sets and state variables, as the student's. */
interface Chosen {
  gm: Map<string, string>;
  sm: Map<string, Match>;
}

const MAX_GIVEN_MAPS = 24;

/**
 * The bijection between given sets and the state matching that achieve the most State
 * goals; ties: more similar names (given sets and variables), then the natural order
 * (identical types first, …). Only the State goals decide, so that operations cannot
 * pull the state matching their way (a QueryBalance outputting the overdraft must
 * not make `overdraft` the balance). Memoised.
 */
function chooseMatching(spec: SpecDoc, an: Analysis, ref: Analysis, stateStep: Step | undefined, stateSamples: Sample[], c: Omit<Ctx, 'givenMap'>): Chosen {
  const refState = ref.byId.state?.vars.filter((v) => v.role === 'state') ?? [];
  const stuState = an.byId.state?.vars.filter((v) => v.role === 'state') ?? [];
  const fp = stepKey(spec, 'state', c.binding);
  const key = JSON.stringify([fp, c.mode, stateSamples.length, stateStep?.goals ?? null, ref.givenSets, refState.map((v) => [v.name, printTerm(v.declared)]), c.initPrimed]);
  const hit = chosenCache.get(key);
  if (hit) return hit;
  let best: (Chosen & { score: number; sim: number }) | null = null;
  for (const g of givenBijections(ref.givenSets, an.givenSets)) {
    const ctx: Ctx = { ...c, givenMap: g.map };
    for (const sm of matchings(refState, stuState, translator(g.map), g.map)) {
      const score = stateStep ? count(sampledResults(fp, stateStep, stepNames(stateStep, sm, new Map(), ctx), ctx)) : 0;
      const sim = g.sim + similarity(sm);
      if (!best || score > best.score || (score === best.score && sim > best.sim)) best = { gm: g.map, sm, score, sim };
    }
  }
  const chosen = best ? { gm: best.gm, sm: best.sm } : { gm: new Map<string, string>(), sm: new Map<string, Match>() };
  chosenCache.set(key, chosen);
  if (chosenCache.size > CACHE_SIZE) chosenCache.delete(chosenCache.keys().next().value!);
  return chosen;
}
const chosenCache = new Map<string, Chosen>();

/**
 * Bijections between the reference's and the student's given sets (as many pairs as
 * possible), most similar names first.
 */
function givenBijections(refs: string[], stus: string[]): { map: Map<string, string>; sim: number }[] {
  const out: { map: Map<string, string>; sim: number }[] = [];
  const size = Math.min(refs.length, stus.length);
  const cur = new Map<string, string>();
  const go = (i: number) => {
    if (out.length >= 5040) return;
    if (cur.size === size) {
      out.push({ map: new Map(cur), sim: [...cur].reduce((n, [r, x]) => n + nameSimilarity(r, x), 0) });
      return;
    }
    if (i === refs.length || refs.length - i < size - cur.size) return;
    const used = new Set(cur.values());
    for (const x of stus) {
      if (used.has(x)) continue;
      cur.set(refs[i], x);
      go(i + 1);
      cur.delete(refs[i]);
    }
    go(i + 1);
  };
  go(0);
  return out.sort((a, b) => b.sim - a.sim).slice(0, MAX_GIVEN_MAPS);
}

/**
 * Which template given sets and state variables the student's stand for, so that the
 * examples use the template's value pools and fixed data for them (a renamed or reversed
 * compatibility table still gets the template's table, the right way round). Based on
 * the matching the goal check chooses (by the State goals given, or those of the last
 * goal check against this reference). Memoised.
 */
export function exampleBinding(spec: SpecDoc, an: Analysis, reference: SpecDoc, goals?: TemplateGoals): ExampleBinding {
  return deterministically(() => {
    const ref = refAnalysis(reference);
    const stateGoals = goals?.state ?? goalsByReference.get(referenceId(reference))?.state;
    const samples = stateGoals ? samplesFor(spec, an, 'state', 10, 'work') : [];
    const c = { initPrimed: an.byId.init?.initImport === 'primed', mode: 'work' as const, search: null };
    const { gm, sm } = chooseMatching(spec, an, ref, stateGoals ? { key: 'state', kind: 'state', goals: stateGoals, samples } : undefined, samples, c);
    return bindingOf(gm, sm);
  });
}

const goalsByReference = new Map<string, TemplateGoals>();
const referenceId = (reference: SpecDoc) => reference.topicId ?? JSON.stringify(reference);

function bindingOf(gm: Map<string, string>, sm: Map<string, Match>): ExampleBinding {
  const givens: Record<string, string> = {};
  for (const [r, x] of gm) givens[x] = r;
  const vars: ExampleBinding['vars'] = {};
  for (const [r, m] of sm) {
    if (m.kind === 'id') vars[m.stu] = { ref: r };
    else if (m.kind === 'inverse') vars[m.stu] = { ref: r, inverse: true };
  }
  return { givens, vars };
}

/** Does the binding give the same pools and fixed data as going by names? */
function sameAsByName(b: ExampleBinding, spec: SpecDoc, an: Analysis): boolean {
  if (Object.entries(b.givens).some(([x, r]) => x !== r)) return false;
  const fixed = spec.fixed ?? {};
  const stateVars = new Set(an.byId.state?.vars.filter((v) => v.role === 'state').map((v) => v.name) ?? []);
  for (const name of Object.keys(fixed)) {
    if (!stateVars.has(name)) continue;
    const v = b.vars[name];
    if (!v || v.ref !== name || v.inverse) return false;
  }
  return Object.entries(b.vars).every(([x, v]) => !(v.ref in fixed) || (x === v.ref && !v.inverse));
}

/** Whether a reference declaration holds for the student's (converted) values. */
type DeclVerdict = { ok: true } | { ok: false; evidence?: GoalEvidence };

/**
 * For each matched reference state variable whose declaration the student's encoding
 * does not guarantee (e.g. `cleared : AIRCRAFT ⇸ RUNWAY` matched by a relation
 * RUNWAY ⇸ AIRCRAFT): does the declaration hold in every example, and does a targeted
 * search find no example that breaks it ("an aircraft cleared for two runways")?
 */
function declVerdicts(spec: SpecDoc, an: Analysis, step: Step, sm: Map<string, Match>, ctx: Ctx): Map<string, DeclVerdict> {
  const out = new Map<string, DeclVerdict>();
  const names = stepNames(step, sm, new Map(), ctx);
  const open: { r: string; ref: Term; stu: Term }[] = [];
  for (const [r, m] of sm) {
    if (!m.decl) continue;
    const stu = inStudentNames(m.decl, names, ctx);
    const bad = step.samples.find((smp) => !holdsIn(m.decl!, names, ctx, smp));
    const fails = (smp: Sample) => shrink(smp, an.byId.state, (env) => !holdsIn(m.decl!, names, ctx, { ...smp, env }));
    if (!step.samples.length) out.set(r, { ok: false });
    else if (bad) out.set(r, { ok: false, evidence: counterexample(fails(bad), stu ?? m.decl, names) });
    else if (!stu) out.set(r, { ok: true });
    else open.push({ r, ref: m.decl, stu });
  }
  const found = refuteTerms(spec, step, open, names, ctx, false, an);
  open.forEach((c, i) => {
    const smp = found.get(i);
    const small = smp && shrink(smp, an.byId.state, (env) => !holdsIn(c.ref, names, ctx, { ...smp, env }));
    out.set(c.r, small ? { ok: false, evidence: counterexample(small, c.stu, names) } : { ok: true });
  });
  return out;
}

const judgeCache = new Map<string, GoalStatus[]>();

/** `judge`, memoised by everything its verdicts depend on. */
function judged(spec: SpecDoc, an: Analysis, step: Step, sampled: boolean[], names: Map<string, Match>, decls: Map<string, DeclVerdict>, admits: Map<string, DeclVerdict>, ctx: Ctx): GoalStatus[] {
  const key = JSON.stringify([
    stepKey(spec, step.key, ctx.binding),
    ctx.mode,
    step.samples.length,
    step.goals,
    sampled,
    namesKey(names),
    [...decls].map(([r, v]) => [r, v.ok, v.ok ? null : v.evidence]),
    [...admits].map(([r, v]) => [r, v.ok, v.ok ? null : v.evidence]),
  ]);
  const hit = judgeCache.get(key);
  if (hit) return hit;
  const r = judge(spec, an, step, sampled, names, decls, admits, ctx);
  judgeCache.set(key, r);
  if (judgeCache.size > CACHE_SIZE) judgeCache.delete(judgeCache.keys().next().value!);
  return r;
}

/**
 * The final verdicts of a step: var goals as matched; holds goals by proof, else by
 * counterexample (sampled or searched), else by examples.
 */
function judge(spec: SpecDoc, an: Analysis, step: Step, sampled: boolean[], names: Map<string, Match>, decls: Map<string, DeclVerdict>, admits: Map<string, DeclVerdict>, ctx: Ctx): GoalStatus[] {
  const out: GoalStatus[] = step.goals.map((g, i) => (sampled[i] && !g.check.holds ? { text: g.text, achieved: true, via: 'stated' } : { text: g.text, achieved: false }));
  const pending: number[] = [];
  const stuTerms = new Map<number, Term>();
  /** The verdicts on the declarations of reference variables (base names) a goal relies on. */
  const reliedOn = (bases: string[]) => bases.flatMap((b) => (decls.has(b) ? [decls.get(b)!] : []));
  const baseOf = (n: string) => n.replace(/′$/, '');
  // variables that a 'holds' goal of this step talks about: when their encoding misses the
  // reference declaration (one runway per aircraft), that goal fails and shows why, so the
  // "which runway each aircraft is cleared for" goal can stay achieved (the lecturer's call)
  const checkedElsewhere = new Set(
    step.goals.flatMap((g) => {
      const t = g.check.holds ? goalTerm(g.check.holds) : null;
      return t ? [...freeVars(t)].map(baseOf) : [];
    }),
  );
  step.goals.forEach((g, i) => {
    const vars = g.check.var === undefined ? [] : Array.isArray(g.check.var) ? g.check.var : [g.check.var];
    if (!g.check.holds) {
      // a variable matched by another encoding: only if the reference declaration holds
      // and only if the student's declaration admits the reference's values
      const admitted = vars.map(baseOf).flatMap((b) => (admits.has(b) ? [admits.get(b)!] : []));
      const vs = [...admitted, ...reliedOn(vars.map(baseOf).filter((b) => !checkedElsewhere.has(b)))];
      const broken = vs.find((v) => !v.ok);
      if (out[i].achieved && broken) out[i] = { text: g.text, achieved: false, ...(!broken.ok && broken.evidence ? { evidence: broken.evidence } : {}) };
      else if (out[i].achieved && vs.length) out[i] = { text: g.text, achieved: true, via: step.kind === 'state' ? 'stated' : 'inferred', evidence: { kind: 'examples' } };
      return;
    }
    if (!step.samples.length) return;
    if (!vars.every((v) => names.has(v))) return;
    const ref = holdsTerm(g, names, ctx);
    if (!ref) return;
    // it applies a function the student's encoding does not make a function
    const broken = reliedOn([...vars, ...applied(ref)].map(baseOf)).find((v) => !v.ok);
    if (broken && !broken.ok) {
      out[i] = { text: g.text, achieved: false, ...(broken.evidence ? { evidence: broken.evidence } : {}) };
      return;
    }
    const stu = inStudentNames(ref, names, ctx);
    if (stu) stuTerms.set(i, stu);
    // 1. a proof
    const proof = stu && proveGoal(spec, an, schemaIdOf(an, step), stu);
    if (proof) {
      out[i] = { text: g.text, achieved: true, via: proof.stated ? 'stated' : 'inferred', evidence: { kind: 'proof', derivation: proof.derivation } };
      return;
    }
    // 2a. an example already breaks it
    const bad = step.samples.find((smp) => !holdsIn(ref, names, ctx, smp));
    if (bad) {
      const small = shrink(bad, an.byId[schemaIdOf(an, step)], (env) => !holdsIn(ref, names, ctx, { ...bad, env }));
      out[i] = { text: g.text, achieved: false, evidence: counterexample(small, stu ?? ref, names) };
      return;
    }
    pending.push(i);
  });
  // 2b. a targeted search for a valid example in which the goal is false
  const found = refuted(spec, an, step, pending, names, ctx, false);
  for (const [i, smp] of found) {
    const ref = holdsTerm(step.goals[i], names, ctx)!;
    const small = shrink(smp, an.byId[schemaIdOf(an, step)], (env) => !holdsIn(ref, names, ctx, { ...smp, env }));
    out[i] = { text: step.goals[i].text, achieved: false, evidence: counterexample(small, stuTerms.get(i)!, names) };
  }
  // 3. no proof, no counterexample: it held in all examples tried
  const rest = pending.filter((i) => !found.has(i));
  const notStated = step.kind === 'state' ? new Map<number, Sample>() : refuted(spec, an, step, rest, names, ctx, true);
  for (const i of rest) {
    out[i] = { text: step.goals[i].text, achieved: true, via: notStated.has(i) ? 'inferred' : 'stated', evidence: { kind: 'examples' } };
  }
  return out;
}

const schemaIdOf = (an: Analysis, step: Step) =>
  step.kind === 'op' ? step.key : step.kind === 'init' ? (an.schemas.find((s) => s.role === 'init')?.id ?? 'init') : (an.byId.state?.id ?? 'state');

/** The variables of an example that the goal mentions (in the student's names). */
function counterexample(smp: Sample, goal: Term, names: Map<string, Match>): GoalEvidence {
  const wanted = new Set([...freeVars(goal), ...[...names.values()].map((m) => m.stu)].filter((n) => freeVars(goal).has(n)));
  const vars = smp.vars.filter((v) => wanted.has(v.name));
  return { kind: 'counterexample', vars: vars.length ? vars : smp.vars };
}

// ── not stricter than the requirements (checked on the reference's examples) ─────

const ALLOWS_STATES = 'Allows every state the requirements allow';
const RUNS_WHEN = 'Runs whenever it should';

/** The reference side: its spec, and how the student's names read in its vocabulary. */
interface RefSide {
  reference: SpecDoc;
  ref: Analysis;
  /** The student's state variables (also primed), inputs and outputs → terms over the reference's. */
  toRef: Map<string, Term>;
  /** The student's given sets → the reference's. */
  givens: Map<string, string>;
  /** Fingerprint of the matching (cache keys). */
  key: string;
}

function refSide(reference: SpecDoc, ref: Analysis, an: Analysis, sm: Map<string, Match>, givenMap: Map<string, string>): RefSide {
  const toRef = new Map<string, Term>();
  for (const [r, m] of sm) {
    // a function to sets has several readings of a relation (x ↦ ∅ or no x at all):
    // the student's predicates about it cannot be checked on the reference's examples
    if (m.kind === 'flatten') continue;
    toRef.set(m.stu, (m.backTerm && m.backTerm(r)) || nameTerm(r));
    toRef.set(m.stu + '′', (m.backTerm && m.backTerm(r + '′')) || nameTerm(r + '′'));
  }
  void an;
  return {
    reference,
    ref,
    toRef,
    givens: new Map([...givenMap].map(([a, b]) => [b, a])),
    key: JSON.stringify([[...givenMap], namesKey(sm)]),
  };
}

/** A predicate of the student's in the reference's vocabulary (null if it mentions something unmatched). */
function translate(t: Term, toRef: Map<string, Term>, givens: Map<string, string>): Term | null {
  for (const n of freeVars(t)) if (!toRef.has(n) && !givens.has(n)) return null;
  return substitute(rename(t, givens), toRef);
}

/** true / false, or null if the predicate is undefined there. */
function truthIn(t: Term, env: Env, u: Universe): boolean | null {
  try {
    return evalPred(t, env, u);
  } catch {
    return null;
  }
}

const refuteRefCache = new Map<string, [number, Sample][]>();

/**
 * Predicates over the reference's variables (indices) that are false in a valid example
 * of the reference's step (where `guard` holds): its sampled examples first, then a
 * targeted search, as for the goals.
 */
function refuteOnReference(rs: RefSide, stepId: string, preds: Term[], guard: Term[], ctx: Ctx): Map<number, Sample> {
  const out = new Map<number, Sample>();
  if (!preds.length) return out;
  const kind: Step['kind'] = stepId === 'state' ? 'state' : 'op';
  const key = JSON.stringify([stepKey(rs.reference, stepId), ctx.mode, ctx.search, preds.map(printTerm), guard.map(printTerm)]);
  const hit = refuteRefCache.get(key);
  if (hit) return new Map(hit);
  const samples = samplesFor(rs.reference, rs.ref, stepId, 10, ctx.mode);
  const guarded = (smp: Sample) => guard.every((g) => truthIn(g, smp.env, smp.u) === true);
  preds.forEach((p, i) => {
    const bad = samples.find((smp) => guarded(smp) && truthIn(p, smp.env, smp.u) === false);
    if (bad) out.set(i, bad);
  });
  let pending = preds.map((_, i) => i).filter((i) => !out.has(i));
  const step: Step = kind === 'state' ? { key: stepId, kind, goals: [], samples } : { key: stepId, kind, goals: [], samples, student: rs.ref.byId[stepId] };
  for (let round = 0; pending.length && round <= preds.length; round++) {
    const someFalse = pending.map((i) => negate(preds[i])).reduce((a, b) => orTerm(a, b));
    const extra = [...guard, someFalse].reduce((a, b) => ({ kind: 'logic', op: '∧', left: a, right: b, span: a.span }));
    const smp = search(rs.reference, rs.ref, step, extra, false, ctx.search ?? SEARCH[kind]);
    if (!smp) break;
    const failed = pending.filter((i) => truthIn(preds[i], smp.env, smp.u) === false);
    if (!failed.length) break;
    for (const i of failed) out.set(i, smp);
    pending = pending.filter((i) => !failed.includes(i));
  }
  refuteRefCache.set(key, [...out]);
  if (refuteRefCache.size > CACHE_SIZE) refuteRefCache.delete(refuteRefCache.keys().next().value!);
  return out;
}

/** A reference example, shown in the student's names and encoding. */
function shownFromReference(smp: Sample, show: [string, Match][]): ShownVar[] {
  return show.flatMap(([r, m]) => {
    const v = smp.env.get(r);
    if (!v) return [];
    const value = m.back ? m.back(v, smp.u) : v;
    return [{ name: m.stu, value, text: printValue(value) }];
  });
}

type Premises = { text: string; reason: string }[];

/** The premises proving `t` from the reference's step (its predicates and invariant), or null. Memoised. */
function provenOnReference(rs: RefSide, schemaId: string, t: Term): Premises | null {
  const key = JSON.stringify([stepKey(rs.reference, schemaId), printTerm(t)]);
  let r = refProofCache.get(key);
  if (r === undefined) {
    const p = proveGoal(rs.reference, rs.ref, schemaId, t);
    r = p && p.derivation.kind === 'facts' ? p.derivation.premises : null;
    refProofCache.set(key, r);
    if (refProofCache.size > 512) refProofCache.delete(refProofCache.keys().next().value!);
  }
  return r;
}
const refProofCache = new Map<string, Premises | null>();

/** One proof from several: all premises (each once), and what follows. */
function combined(premises: Premises[], conclusions: string[]): GoalEvidence {
  const seen = new Set<string>();
  const all = premises.flat().filter((p) => {
    const k = `${p.text}\u0000${p.reason}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { kind: 'proof', derivation: { kind: 'facts', premises: all, conclusion: conclusions.join('\n') } };
}

const autoCache = new Map<string, unknown>();
/** Memoised automatic checks (they only change when the student's step or the matching does). */
function memoAuto<T>(key: string, f: () => T): T {
  if (autoCache.has(key)) return autoCache.get(key) as T;
  const r = f();
  autoCache.set(key, r);
  if (autoCache.size > CACHE_SIZE) autoCache.delete(autoCache.keys().next().value!);
  return r;
}

/**
 * Var goals: the student's declaration must admit the reference's values (one allergy
 * per patient, `allergic : PATIENT ⇸ DRUG`, does not admit the reference's PATIENT ↔ DRUG).
 * Only for declarations that do not admit them by their form.
 */
function admitVerdicts(reference: SpecDoc, ref: Analysis, an: Analysis, sm: Map<string, Match>, givenMap: Map<string, string>, stateGoals: Goal[], ctx: Ctx): Map<string, DeclVerdict> {
  const key = JSON.stringify(['admit', stepKey(reference, 'state'), JSON.stringify(an.byId.state?.vars.map((v) => [v.name, printTerm(v.declared)])), [...givenMap], namesKey(sm), stateGoals, ctx.mode, ctx.search]);
  return memoAuto(key, () => admitVerdicts1(reference, ref, an, sm, givenMap, stateGoals, ctx));
}
function admitVerdicts1(reference: SpecDoc, ref: Analysis, an: Analysis, sm: Map<string, Match>, givenMap: Map<string, string>, stateGoals: Goal[], ctx: Ctx): Map<string, DeclVerdict> {
  const out = new Map<string, DeclVerdict>();
  const wanted = new Set(stateGoals.flatMap((g) => (g.check.holds || g.check.var === undefined ? [] : Array.isArray(g.check.var) ? g.check.var : [g.check.var])));
  const rs = refSide(reference, ref, an, sm, givenMap);
  const checks: { r: string; m: Match; t: Term }[] = [];
  for (const [r, m] of sm) {
    if (!wanted.has(r)) continue;
    const stu = an.byId.state?.vars.find((v) => v.name === m.stu);
    const refVar = ref.byId.state?.vars.find((v) => v.name === r);
    if (!stu || !refVar || admitsByForm(stu, refVar, m, givenMap)) continue;
    const t = translate({ kind: 'rel', op: '∈', left: nameTerm(m.stu), right: stu.declared, span: stu.declared.span }, rs.toRef, rs.givens);
    if (t) checks.push({ r, m, t });
  }
  const found = refuteOnReference(rs, 'state', checks.map((c) => c.t), [], ctx);
  checks.forEach((c, i) => {
    const smp = found.get(i);
    const small = smp && shrink(smp, ref.byId.state, (env) => truthIn(c.t, env, smp.u) === false);
    out.set(c.r, small ? { ok: false, evidence: { kind: 'counterexample', vars: shownFromReference(small, [[c.r, c.m]]) } } : { ok: true });
  });
  return out;
}

/** Does the student's declaration admit every value of the reference's by its form alone? */
function admitsByForm(stu: VarInfo, ref: VarInfo, m: Match, givenMap: Map<string, string>): boolean {
  const sd = stu.declared;
  const rd = rename(ref.declared, givenMap);
  // the whole type: a given set, ℤ, ℙ X, a relation X ↔ Y (over whole types)
  const whole = (t: Term): boolean =>
    (t.kind === 'name' && !t.name.endsWith('′')) || (t.kind === 'builtinSet' && t.set === 'ℤ') || (t.kind === 'unop' && t.op === 'ℙ' && whole(t.arg)) || (t.kind === 'binop' && t.op === '↔' && whole(t.left) && whole(t.right)) || (t.kind === 'cross' && t.elems.every(whole));
  if (whole(sd) && !(sd.kind === 'name' && stu.type.k === 'power')) return true;
  if (m.kind === 'id') return printTerm(sd) === printTerm(rd) || implies(rd, sd);
  // grouped into a function to sets: always a function (over the whole left set if total)
  if (m.kind === 'flatten') return sd.kind === 'binop' && (sd.op === '⇸' || sd.op === '→') && whole(sd.left) && whole(sd.right);
  return false;
}

/**
 * "Allows every state the requirements allow": every valid state of the reference
 * (in the student's encoding) satisfies the student's state predicates. Needs every
 * reference state variable matched.
 */
function allowsStates(spec: SpecDoc, rs: RefSide, an: Analysis, sm: Map<string, Match>, stateStep: Step, ctx: Ctx): GoalStatus {
  const key = JSON.stringify(['allows', stepKey(spec, 'state', ctx.binding), rs.key, stateStep.samples.length, ctx.mode, ctx.search]);
  return memoAuto(key, () => allowsStates1(rs, an, sm, stateStep, ctx));
}
function allowsStates1(rs: RefSide, an: Analysis, sm: Map<string, Match>, stateStep: Step, ctx: Ctx): GoalStatus {
  const refState = rs.ref.byId.state?.vars.filter((v) => v.role === 'state') ?? [];
  if (!refState.length || !refState.every((v) => sm.has(v.name)) || !stateStep.samples.length) return { text: ALLOWS_STATES, achieved: false };
  const own = (an.byId.state?.preds ?? []).filter((p) => p.origin === 'own' && p.ok);
  const proofs: Premises[] = [];
  const preds: Term[] = [];
  const lines: string[] = [];
  for (const p of own) {
    const t = translate(p.term, rs.toRef, rs.givens);
    if (!t) continue;
    lines.push(printTerm(p.term));
    const proof = provenOnReference(rs, rs.ref.byId.state!.id, t);
    if (proof) proofs.push(proof);
    else preds.push(t);
  }
  const found = refuteOnReference(rs, 'state', preds, [], ctx);
  const first = [...found][0];
  if (first) {
    const [i, smp] = first;
    const small = shrink(smp, rs.ref.byId.state, (env) => truthIn(preds[i], env, smp.u) === false);
    return { text: ALLOWS_STATES, achieved: false, evidence: { kind: 'counterexample', vars: shownFromReference(small, [...sm]) } };
  }
  // every line follows from the requirements' invariant: proven
  if (!preds.length) return { text: ALLOWS_STATES, achieved: true, via: 'stated', ...(lines.length ? { evidence: combined(proofs, lines) } : {}) };
  return { text: ALLOWS_STATES, achieved: true, via: 'stated', evidence: { kind: 'examples' } };
}

/**
 * "Runs whenever it should": wherever the reference operation applies, the student's
 * applies too. Checked on the reference's examples (before-state and inputs) where the
 * student's invariant holds: the student's preconditions, and the after-state values its
 * equations force (Ξ, the frame convention, v′ = …), must not rule them out. A targeted
 * search looks for a reference example that breaks one of the student's preconditions.
 */
function runsWhen(spec: SpecDoc, rs: RefSide, an: Analysis, step: Extract<Step, { kind: 'op' }>, sm: Map<string, Match>, om: Map<string, Match>, ctx: Ctx): GoalStatus {
  const key = JSON.stringify(['runs', stepKey(spec, step.key, ctx.binding), rs.key, namesKey(om), step.samples.length, ctx.mode, ctx.search]);
  return memoAuto(key, () => runsWhen1(rs, an, step, sm, om, ctx));
}
function runsWhen1(rs: RefSide, an: Analysis, step: Extract<Step, { kind: 'op' }>, sm: Map<string, Match>, om: Map<string, Match>, ctx: Ctx): GoalStatus {
  const refOp = step.refOp;
  const refState = rs.ref.byId.state?.vars.filter((v) => v.role === 'state') ?? [];
  const refIO = refOp?.vars.filter((v) => v.role === 'input' || v.role === 'output') ?? [];
  if (!refOp || !refState.every((v) => sm.has(v.name)) || !refIO.every((v) => om.has(v.name)) || !step.samples.length) return { text: RUNS_WHEN, achieved: false };
  const toRef = new Map(rs.toRef);
  for (const [r, m] of om) toRef.set(m.stu, (m.backTerm && m.backTerm(r)) || nameTerm(r));
  const tr = (t: Term) => translate(t, toRef, rs.givens);
  const preds = step.student.preds.filter((p) => p.ok);
  const before = preds.filter((p) => p.origin === 'invariant').flatMap((p) => (tr(p.term) ? [tr(p.term)!] : []));
  const rest = preds.filter((p) => p.origin !== 'invariant').flatMap((p) => (tr(p.term) ? [tr(p.term)!] : []));
  const refInputs = new Set(refIO.filter((v) => v.role === 'input').map((v) => v.name));
  const isBefore = (n: string) => refState.some((v) => v.name === n) || refInputs.has(n);
  const show = (smp: Sample): ShownVar[] => shownFromReference(smp, [...[...sm], ...[...om].filter(([r]) => refInputs.has(r))]);
  // 0. the reference's own outcome satisfies all of the student's lines: proven
  const own = preds.filter((p) => p.origin !== 'invariant');
  const proofs = own.map((p) => {
    const t = tr(p.term);
    return t && provenOnReference(rs, step.key, t);
  });
  if (own.length && proofs.every((p) => p)) {
    return { text: RUNS_WHEN, achieved: true, via: 'stated', evidence: combined(proofs as Premises[], own.filter((p) => p.origin === 'own').map((p) => printTerm(p.term))) };
  }
  // 1. the reference's sampled examples: the student's predicates with the forced values
  const samples = samplesFor(rs.reference, rs.ref, step.key, 10, ctx.mode);
  const blocked = (full: Env, u: Universe): boolean => {
    const env = new Map<string, Value>([...full].filter(([n]) => isBefore(n)));
    if (!before.every((p) => truthIn(p, env, u) !== false)) return false;
    forceValues(rest, env, u);
    return rest.some((p) => [...freeVars(p)].every((n) => env.has(n) || n in u.carriers) && truthIn(p, env, u) === false);
  };
  for (const smp of samples) {
    if (blocked(smp.env, smp.u)) return { text: RUNS_WHEN, achieved: false, evidence: { kind: 'counterexample', vars: show(shrink(smp, rs.ref.byId[step.key], (env) => blocked(env, smp.u))) } };
  }
  // 2. a targeted search for a reference example that breaks a precondition of the student's
  const pre = rest.filter((p) => [...freeVars(p)].every((n) => isBefore(n) || rs.ref.givenSets.includes(n)) && !provenOnReference(rs, step.key, p));
  void an;
  const found = refuteOnReference(rs, step.key, pre, before, ctx);
  const first = [...found][0];
  if (first) {
    const [i, smp] = first;
    const small = shrink(smp, rs.ref.byId[step.key], (env) => truthIn(pre[i], env, smp.u) === false && before.every((p) => truthIn(p, env, smp.u) === true));
    return { text: RUNS_WHEN, achieved: false, evidence: { kind: 'counterexample', vars: show(small) } };
  }
  return { text: RUNS_WHEN, achieved: true, via: 'stated', evidence: { kind: 'examples' } };
}

/** Values the equations force (x′ = E, x! = E with E known), added to `env` until none is left. */
function forceValues(preds: Term[], env: Map<string, Value>, u: Universe): void {
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of preds) {
      if (p.kind !== 'rel' || p.op !== '=') continue;
      for (const [a, b] of [
        [p.left, p.right],
        [p.right, p.left],
      ]) {
        if (a.kind !== 'name' || env.has(a.name) || a.name in u.carriers) continue;
        if (![...freeVars(b)].every((n) => env.has(n) || n in u.carriers)) continue;
        try {
          env.set(a.name, evalTerm(b, env, u));
          changed = true;
        } catch {
          /* undefined here: not forced */
        }
        break;
      }
    }
  }
}

// ── smaller counterexamples ────────────────────────────────────────────────────

const SHRINK_TRIES = 120;

/**
 * A smaller counterexample: set elements dropped (with the same element of v′ / v when
 * both have it) and numbers moved towards 0, one at a time, while the example stays
 * valid (the schema's predicates and declarations) and still `bad`. At most
 * SHRINK_TRIES candidates (deterministic).
 */
function shrink(smp: Sample, schema: SchemaInfo | undefined, bad: (env: Env) => boolean): Sample {
  if (!schema) return smp;
  let env = new Map(smp.env);
  let tries = 0;
  const accept = (e: Map<string, Value>) => ++tries <= SHRINK_TRIES && validWithDecls(schema, e, smp.u) && bad(e);
  for (let changed = true; changed && tries < SHRINK_TRIES; ) {
    changed = false;
    for (const n of [...env.keys()]) {
      const partner = n.endsWith('′') ? n.slice(0, -1) : n + '′';
      for (const [cand, removed] of smaller(env.get(n)!)) {
        if (tries >= SHRINK_TRIES) break;
        const e = new Map(env);
        e.set(n, cand);
        if (accept(e)) {
          env = e;
          changed = true;
          break;
        }
        const pv = env.get(partner);
        if (removed && pv?.k === 'set' && pv.index.has(valueKey(removed))) {
          e.set(partner, mkSet(pv.elems.filter((x) => valueKey(x) !== valueKey(removed))));
          if (accept(e)) {
            env = e;
            changed = true;
            break;
          }
        }
      }
    }
  }
  if (tries === 0) return smp;
  const vars = smp.vars.map((w) => {
    const v = env.get(w.name);
    if (!v || v === smp.env.get(w.name)) return w;
    return { ...w, value: v, text: printValue(v), alternative: undefined, alternativeValue: undefined, status: w.status === 'free' ? ('chosen' as const) : w.status };
  });
  return { env, u: smp.u, vars };
}

/** Smaller versions of a value: without one element; numbers (also in pairs) nearer to 0. */
function* smaller(v: Value): Generator<[Value, Value | null]> {
  if (v.k === 'set') {
    for (const e of v.elems) yield [mkSet(v.elems.filter((x) => x !== e)), e];
    for (const e of v.elems) {
      if (!isPair(e) || e.elems[1].k !== 'int' || e.elems[1].v === 0) continue;
      for (const n of nearerZero(e.elems[1].v)) yield [mkSet(v.elems.map((x) => (x === e ? pair(e.elems[0], int(n)) : x))), null];
    }
  }
  if (v.k === 'int' && v.v !== 0) for (const n of nearerZero(v.v)) yield [int(n), null];
}

const nearerZero = (n: number): number[] => [...new Set([0, Math.trunc(n / 2), n - Math.sign(n)])].filter((m) => Math.abs(m) < Math.abs(n));

/** The schema's predicates and declarations hold for the values in `env`. */
function validWithDecls(schema: SchemaInfo, env: Map<string, Value>, u: Universe): boolean {
  if (!valid(schema, env, u)) return false;
  return schema.vars.every((v) => {
    const x = env.get(v.name);
    if (!x) return true;
    try {
      return memberOfDeclared(x, v.declared, env, u);
    } catch {
      return false;
    }
  });
}

// ── steps and samples ──────────────────────────────────────────────────────────

interface Sample {
  env: Env;
  u: Universe;
  /** The example's variables as shown (for counterexamples). */
  vars: ShownVar[];
}

type Step =
  | { key: string; kind: 'state' | 'init'; goals: Goal[]; samples: Sample[] }
  | { key: string; kind: 'op'; goals: Goal[]; samples: Sample[]; student: SchemaInfo; refOp?: SchemaInfo };

interface Ctx {
  givenMap: Map<string, string>;
  /** Which template given sets and variables the student's stand for (pools, fixed data). */
  binding?: ExampleBinding;
  /** Effort of the counterexample search (null: the defaults per step kind). */
  search: SearchEffort | null;
  /** How the time budgets are counted ('work': deterministically). */
  mode: 'time' | 'work';
  /** The student's Init imports the state as `State′` (its variables are primed). */
  initPrimed: boolean;
}

const sampleCache = new Map<string, Sample[]>();
const CACHE_SIZE = 64;

/**
 * Examples of one step ('state', 'init' or an operation id), memoised by everything
 * the examples depend on. Sampling stops after two seeds in a row without an example
 * (a failing search costs the most and the next seeds would most likely fail too).
 */
function samplesFor(spec: SpecDoc, an: Analysis, stepId: string, n: number, mode: Ctx['mode'], budgetMs?: number, binding?: ExampleBinding): Sample[] {
  const doc: SchemaDoc | null | undefined =
    stepId === 'state' ? spec.state : stepId === 'init' ? spec.init : spec.operations.find((o) => o.id === stepId);
  if (!doc) return [];
  const key = JSON.stringify([n, mode, budgetMs, stepKey(spec, stepId, binding)]);
  const hit = sampleCache.get(key);
  if (hit) return hit;
  return sampleFor(spec, an, stepId, n, key, budgetMs, binding);
}

/** Everything the examples of a step depend on. */
function stepKey(spec: SpecDoc, stepId: string, binding?: ExampleBinding): string {
  const doc: SchemaDoc | null | undefined =
    stepId === 'state' ? spec.state : stepId === 'init' ? spec.init : spec.operations.find((o) => o.id === stepId);
  return JSON.stringify([
    stepId,
    spec.given,
    spec.pools,
    spec.infinite,
    spec.fixed,
    spec.state.name,
    spec.state.decls,
    spec.state.preds,
    doc?.decls,
    doc?.preds,
    // numbers written anywhere in the spec are example candidates
    allText(spec).match(/\d+/g)?.join(','),
    binding ?? null,
  ]);
}

function sampleFor(spec: SpecDoc, an: Analysis, stepId: string, n: number, key: string, budgetMs?: number, binding?: ExampleBinding): Sample[] {
  const opts = budgetMs || binding ? { ...(budgetMs ? { budgetMs } : {}), ...(binding ? { binding } : {}) } : undefined;
  const schema = an.byId[stepId];
  const samples: Sample[] = [];
  let misses = 0;
  for (let seed = 1; seed <= n; seed++) {
    const u = universeFor(spec, an, seed, binding);
    let vars: ShownVar[] | null = null;
    if (stepId === 'state') {
      const ex = exampleState(spec, an, seed, opts);
      vars = ex.ok ? ex.vars : null;
    } else if (stepId === 'init') {
      const ex = exampleInit(spec, an, seed, opts);
      vars = ex.ok ? ex.vars : null;
    } else {
      const ex = exampleOperation(spec, an, stepId, seed, 'applicable', opts);
      vars = ex.ok && ex.status === 'applicable' ? [...ex.before, ...ex.inputs, ...ex.after, ...ex.outputs] : null;
    }
    if (!vars) {
      if (++misses >= 2) break;
      continue;
    }
    misses = 0;
    const env = new Map(vars.map((v) => [v.name, v.value] as [string, Value]));
    samples.push({ env, u, vars });
    // values the spec leaves open: also try their alternatives (if still a valid example)
    for (const v of vars) {
      if (v.status !== 'free' || !v.alternativeValue) continue;
      const alt = new Map(env);
      alt.set(v.name, v.alternativeValue);
      const altVars = vars.map((w) => (w === v ? { ...w, value: v.alternativeValue!, text: v.alternative ?? w.text, status: undefined, alternative: undefined, alternativeValue: undefined } : w));
      if (schema && valid(schema, alt, u)) samples.push({ env: alt, u, vars: altVars });
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

const termCache = new Map<string, Term | null>();
function goalTerm(text: string): Term | null {
  if (!termCache.has(text)) termCache.set(text, parseTerm(text).term);
  return termCache.get(text)!;
}

/**
 * Is the goal achieved under the state matching `sm` (reference → student, unprimed
 * names) and the operation's input/output matching `om`?
 */
/** Reference names → the student's variables of this step (primed, Init's import, …). */
function stepNames(step: Step, sm: Map<string, Match>, om: Map<string, Match>, ctx: Ctx): Map<string, Match> {
  const names = new Map<string, Match>();
  for (const [r, m] of sm) {
    if (step.kind === 'init') {
      const t = { ...m, stu: ctx.initPrimed ? m.stu + '′' : m.stu };
      names.set(r, t);
      names.set(r + '′', t);
    } else {
      names.set(r, m);
      if (step.kind === 'op') names.set(r + '′', { ...m, stu: m.stu + '′' });
    }
  }
  for (const [r, m] of om) names.set(r, m);
  return names;
}

/** Does the reference predicate hold in one example (values converted to the reference encoding)? */
function holdsIn(term: Term, names: Map<string, Match>, ctx: Ctx, { env, u }: Sample): boolean {
  try {
    const refEnv = new Map<string, Value>();
    for (const [r, m] of names) {
      const v = env.get(m.stu);
      if (v) refEnv.set(r, m.conv ? m.conv(v, u) : v);
    }
    return evalPred(rename(term, ctx.givenMap), refEnv, u);
  } catch {
    return false;
  }
}

const sampledCache = new Map<string, boolean>();

/**
 * Which goals of a step hold in all its examples under the names (memoised per goal and
 * the matching of the variables it mentions, so that trying many matchings is cheap).
 */
function sampledResults(fp: string, step: Step, names: Map<string, Match>, ctx: Ctx): boolean[] {
  const givens = JSON.stringify([...ctx.givenMap]);
  return step.goals.map((g) => {
    const rel = relevantNames(g);
    const key = JSON.stringify([fp, ctx.mode, step.samples.length, g.check, givens, rel.map((r) => names.get(r)?.desc ?? null)]);
    const hit = sampledCache.get(key);
    if (hit !== undefined) return hit;
    const r = achieved(g, step, names, ctx);
    sampledCache.set(key, r);
    if (sampledCache.size > 4096) sampledCache.delete(sampledCache.keys().next().value!);
    return r;
  });
}

/** The reference names a goal depends on. */
function relevantNames(g: Goal): string[] {
  const vars = g.check.var === undefined ? [] : Array.isArray(g.check.var) ? g.check.var : [g.check.var];
  const t = g.check.holds ? goalTerm(g.check.holds) : null;
  return [...new Set([...vars, ...(t ? freeVars(t) : [])])].sort();
}

/** A matching as data (for cache keys). */
const namesKey = (names: Map<string, Match>) => [...names].map(([r, m]) => [r, m.desc]);

function achieved(g: Goal, step: Step, names: Map<string, Match>, ctx: Ctx): boolean {
  const c = g.check;
  if (c.given) return false; // given goals belong to the Types step
  if (c.var !== undefined) {
    const vars = Array.isArray(c.var) ? c.var : [c.var];
    if (!vars.every((v) => names.has(v))) return false;
  }
  if (c.holds === undefined) return c.var !== undefined;
  const t = holdsTerm(g, names, ctx);
  if (!t || !step.samples.length) return false;
  // the reference predicate, over the student's given sets, evaluated on the student's
  // values (converted to the reference's encoding) under the reference names
  return step.samples.every((sample) => holdsIn(t, names, ctx, sample));
}

/**
 * The goal's predicate if all its names are matched (null otherwise). In "unchanged"
 * goals (conjunctions of v′ = v) the conjuncts of unmatched variables are left out: a
 * query that changes nothing changes none of the variables the student has.
 */
function holdsTerm(g: Goal, names: Map<string, Match>, ctx: Ctx): Term | null {
  const t = g.check.holds ? goalTerm(g.check.holds) : null;
  if (!t) return null;
  const known = (n: string) => names.has(n) || ctx.givenMap.has(n);
  if ([...freeVars(t)].every(known)) return t;
  const cs = conjunctsOf(t);
  const unchanged = (c: Term) => c.kind === 'rel' && c.op === '=' && c.left.kind === 'name' && c.right.kind === 'name' && c.left.name === c.right.name + '′';
  if (!cs.every(unchanged)) return null;
  const kept = cs.filter((c) => [...freeVars(c)].every(known));
  return kept.length ? kept.reduce((a, b) => ({ kind: 'logic', op: '∧', left: a, right: b, span: a.span })) : null;
}

const conjunctsOf = (t: Term): Term[] => (t.kind === 'logic' && t.op === '∧' ? [...conjunctsOf(t.left), ...conjunctsOf(t.right)] : [t]);

// ── counterexamples ─────────────────────────────────────────────────────────────

/** Default effort of the counterexample search per step kind (work-clock ms, seeds). */
const SEARCH: Record<Step['kind'], SearchEffort> = {
  state: { ms: 30, seeds: 2 },
  init: { ms: 60, seeds: 2 },
  op: { ms: 30, seeds: 2 },
};
const refuteCache = new Map<string, [number, Sample][]>();

/**
 * Goals (indices) for which a targeted search finds a valid example of the step where
 * they are false. `relaxed`: search the step's own content only (no invariant, no frame
 * convention).
 */
function refuted(spec: SpecDoc, an: Analysis, step: Step, idx: number[], names: Map<string, Match>, ctx: Ctx, relaxed: boolean): Map<number, Sample> {
  const terms: { i: number; ref: Term; stu: Term }[] = [];
  for (const i of idx) {
    const ref = holdsTerm(step.goals[i], names, ctx);
    const stu = ref && inStudentNames(ref, names, ctx);
    if (ref && stu) terms.push({ i, ref, stu });
  }
  const found = refuteTerms(spec, step, terms, names, ctx, relaxed, an);
  return new Map([...found].map(([j, smp]) => [terms[j].i, smp]));
}

/**
 * Predicates (indices into `terms`) for which a targeted search finds a valid example of
 * the step where they are false. One search for "some predicate is false" at a time;
 * the ones false in the example found drop out, until no more is found.
 */
function refuteTerms(spec: SpecDoc, step: Step, terms: { ref: Term; stu: Term }[], names: Map<string, Match>, ctx: Ctx, relaxed: boolean, an: Analysis): Map<number, Sample> {
  const out = new Map<number, Sample>();
  let pending = terms.map((_, i) => i);
  if (!pending.length) return out;
  const key = JSON.stringify([stepKey(spec, step.key, ctx.binding), ctx.mode, ctx.search, relaxed, terms.map((t) => printTerm(t.stu))]);
  const hit = refuteCache.get(key);
  if (hit) return new Map(hit);
  for (let round = 0; pending.length && round <= terms.length; round++) {
    const someFalse = pending.map((i) => negate(terms[i].stu)).reduce((a, b) => orTerm(a, b));
    const sample = search(spec, an, step, someFalse, relaxed, ctx.search ?? SEARCH[step.kind], ctx.binding);
    if (!sample) break;
    const failed = pending.filter((i) => !holdsIn(terms[i].ref, names, ctx, sample));
    if (!failed.length) break;
    for (const i of failed) out.set(i, sample);
    pending = pending.filter((i) => !failed.includes(i));
  }
  refuteCache.set(key, [...out]);
  if (refuteCache.size > CACHE_SIZE) refuteCache.delete(refuteCache.keys().next().value!);
  return out;
}

/** A valid example of the step that satisfies `extra` (tried with `effort.seeds` seeds), or null. */
function search(spec: SpecDoc, an: Analysis, step: Step, extra: Term, relaxed: boolean, effort: SearchEffort, binding?: ExampleBinding): Sample | null {
  const opts = { extra, relaxed, budgetMs: effort.ms, ...(binding ? { binding } : {}) };
  for (let seed = 1; seed <= effort.seeds; seed++) {
    let vars: ShownVar[] | null = null;
    if (step.kind === 'state') {
      const ex = exampleState(spec, an, seed, opts);
      vars = ex.ok ? ex.vars : null;
    } else if (step.kind === 'init') {
      const ex = exampleInit(spec, an, seed, opts);
      vars = ex.ok ? ex.vars : null;
    } else {
      const ex = exampleOperation(spec, an, step.key, seed, 'applicable', opts);
      vars = ex.ok && ex.status === 'applicable' ? [...ex.before, ...ex.inputs, ...ex.after, ...ex.outputs] : null;
    }
    if (vars) return { env: new Map(vars.map((v) => [v.name, v.value] as [string, Value])), u: universeFor(spec, an, seed, binding), vars };
  }
  return null;
}

/** The reference predicate in the student's names (null if a variable has no term form). */
function inStudentNames(t: Term, names: Map<string, Match>, ctx: Ctx): Term | null {
  const sub = new Map<string, Term>();
  for (const n of freeVars(t)) {
    const m = names.get(n);
    if (m) {
      const term = m.term ? m.term(m.stu) : nameTerm(m.stu);
      if (!term) return null;
      sub.set(n, term);
    } else if (ctx.givenMap.has(n)) sub.set(n, nameTerm(ctx.givenMap.get(n)!));
    else return null;
  }
  return substitute(t, sub);
}

const notTerm = (t: Term): Term => ({ kind: 'not', arg: t, span: t.span });

const NEGATED: Partial<Record<string, '=' | '≠' | '∈' | '∉' | '<' | '≤' | '>' | '≥'>> = { '=': '≠', '≠': '=', '∈': '∉', '∉': '∈', '<': '≥', '≥': '<', '>': '≤', '≤': '>' };

/**
 * ¬t with the negation pushed inwards through ∧ ∨ ⇒ and into relations, so that the
 * search gets a graded distance (¬(A ∧ B) is "A or B false", not just true / false).
 */
function negate(t: Term): Term {
  switch (t.kind) {
    case 'not':
      return t.arg;
    case 'bool':
      return { ...t, value: !t.value };
    case 'logic':
      if (t.op === '∧') return { ...t, op: '∨', left: negate(t.left), right: negate(t.right) };
      if (t.op === '∨') return { ...t, op: '∧', left: negate(t.left), right: negate(t.right) };
      if (t.op === '⇒') return { ...t, op: '∧', right: negate(t.right) };
      return notTerm(t);
    case 'rel': {
      const op = NEGATED[t.op];
      return op ? { ...t, op } : notTerm(t);
    }
    default:
      return notTerm(t);
  }
}
const orTerm = (a: Term, b: Term): Term => ({ kind: 'logic', op: '∨', left: a, right: b, span: a.span });

/** Names applied as functions in a term (`f` in `f(x)`). */
function applied(t: Term): Set<string> {
  const out = new Set<string>();
  const walk = (x: unknown): void => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(walk);
    const o = x as Record<string, unknown>;
    if (o.kind === 'apply' && (o.fn as Term).kind === 'name') out.add((o.fn as { name: string }).name);
    for (const [k, v] of Object.entries(o)) if (k !== 'span') walk(v);
  };
  walk(t);
  return out;
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

type Encoding = 'id' | 'flatten' | 'group' | 'inverse' | 'neg';

/** A matched student variable, and how to convert its values to the reference encoding. */
interface Match {
  stu: string;
  /** Preference: 0 identical types, 1 another encoding, 2 the inverse relation. */
  rank: number;
  kind: Encoding;
  /** The student variable and the encoding (for cache keys). */
  desc: string;
  conv?: (v: Value, u: Universe) => Value;
  /** The converted value as a term over the student's variable (for targeted searches). */
  term?: (stu: string) => Term | null;
  /** The other way round: a reference value in the student's encoding. */
  back?: (v: Value, u: Universe) => Value;
  /** The student's value as a term over the reference variable. */
  backTerm?: (ref: string) => Term | null;
  /**
   * The reference declaration as a predicate (`cleared ∈ AIRCRAFT ⇸ RUNWAY`, reference
   * names, student given sets) when the student's encoding does not guarantee it: a
   * function (⇸, →) matched by a relation, the inverse relation or a function to sets.
   */
  decl?: Term;
}

/**
 * Can a student variable of type `stu` stand for a reference variable of type `ref`
 * (already over the student's given sets)? Identical types need no conversion; a
 * relation X ↔ Y and a function to sets X → ℙ Y are converted into each other, and a
 * relation Y ↔ X (or Y ⇸ X) is the inverse of X ↔ Y (pairs swapped).
 */
function encodings(ref: VarInfo, refT: ZType, stu: VarInfo, givenMap: Map<string, string>): Match[] {
  const out: Match[] = [];
  const decl = declCheck(ref) ?? undefined;
  const mk = (kind: Encoding, rank: number, m: Omit<Match, 'stu' | 'rank' | 'kind' | 'desc'>): Match => ({ stu: stu.name, rank, kind, desc: `${stu.name}:${kind}`, ...m });
  if (typeEquals(refT, stu.type)) out.push(mk('id', 0, { decl: decl && !implies(stu.declared, rename(ref.declared, givenMap)) ? decl : undefined }));
  const r = relationParts(refT);
  const s = relationParts(stu.type);
  const rr = relationParts(ref.type); // in the reference's names
  if (r && s && rr) {
    if (typeEquals(r[0], s[0])) {
      const Y = simpleType(r[1].k === 'power' ? r[1].elem : r[1]);
      const Yref = simpleType(rr[1].k === 'power' ? rr[1].elem : rr[1]);
      // reference: relation X ↔ Y, student: function to sets X → ℙ Y — flatten
      if (s[1].k === 'power' && typeEquals(r[1], s[1].elem)) {
        const sd = stu.declared;
        const inv = new Map([...givenMap].map(([a, b]) => [b, a]));
        const total = sd.kind === 'binop' && sd.op === '→' ? rename(sd.left, inv) : null;
        out.push(
          mk('flatten', 1, {
            conv: flatten,
            term: (f) => (Y ? term(`{ _x ∈ dom ${f}; _y ∈ ${Y} | _y ∈ ${f}(_x) . _x ↦ _y }`) : null),
            back: (v, u) => group(v, total ? setValues(evalTerm(total, new Map(), u), u) : null),
            backTerm: (R) => (Yref ? term(`{ _x ∈ ${total ? printTerm(total) : `dom ${R}`} . _x ↦ { _y ∈ ${Yref} | (_x ↦ _y) ∈ ${R} } }`) : null),
            decl,
          }),
        );
      }
      // reference: function to sets, student: relation — group (over dom for ⇸, all of X for →)
      if (r[1].k === 'power' && typeEquals(r[1].elem, s[1])) {
        const d = ref.declared;
        const total = d.kind === 'binop' && d.op === '→' ? rename(d.left, givenMap) : null;
        out.push(
          mk('group', 1, {
            conv: (v, u) => group(v, total ? setValues(evalTerm(total, new Map(), u), u) : null),
            term: (R) => (Y ? term(`{ _x ∈ ${total ? printTerm(total) : `dom ${R}`} . _x ↦ { _y ∈ ${Y} | (_x ↦ _y) ∈ ${R} } }`) : null),
            back: flatten,
            backTerm: (f) => (Yref ? term(`{ _x ∈ dom ${f}; _y ∈ ${Yref} | _y ∈ ${f}(_x) . _x ↦ _y }`) : null),
          }),
        );
      }
    }
    // the inverse relation: reference X ↔ Y, student Y ↔ X (also X ↔ X read the other way round)
    if (typeEquals(r[0], s[1]) && typeEquals(r[1], s[0])) {
      const inverse = (R: string) => term(`{ _y ∈ dom ${R}; _x ∈ ran ${R} | (_y ↦ _x) ∈ ${R} . _x ↦ _y }`);
      out.push(mk('inverse', 2, { conv: swap, term: inverse, back: swap, backTerm: inverse, decl }));
    }
    // numbers the other way round: X ↔ ℤ holding the negated values (a limit as the lowest balance)
    if (r[1].k === 'int' && typeEquals(refT, stu.type)) {
      const negated = (R: string) => term(`{ _x ∈ dom ${R}; _y ∈ ran ${R} | (_x ↦ _y) ∈ ${R} . _x ↦ -_y }`);
      out.push(mk('neg', 1, { conv: negate2, term: negated, back: negate2, backTerm: negated, decl: memberDecl(ref) }));
    }
  }
  if (refT.k === 'int' && stu.type.k === 'int') {
    const negated = (n: string) => term(`-${n}`);
    out.push(mk('neg', 1, { conv: negateInt, term: negated, back: negateInt, backTerm: negated, decl: memberDecl(ref) }));
  }
  return out;
}

/** `v ∈ S` for the reference declaration `v : S`. */
function memberDecl(ref: VarInfo): Term {
  return { kind: 'rel', op: '∈', left: nameTerm(ref.name), right: ref.declared, span: ref.declared.span };
}

/** -n */
function negateInt(v: Value): Value {
  return v.k === 'int' ? int(-v.v) : v;
}

/** {x ↦ n, …} → {x ↦ -n, …} */
function negate2(v: Value): Value {
  if (v.k !== 'set') return v;
  return mkSet(v.elems.map((p) => (isPair(p) ? pair(p.elems[0], negateInt(p.elems[1])) : p)));
}

/** `v ∈ X ⇸ Y` / `v ∈ X → Y` for a reference variable declared as a function (else null). */
function declCheck(ref: VarInfo): Term | null {
  const d = ref.declared;
  if (d.kind !== 'binop' || (d.op !== '⇸' && d.op !== '→')) return null;
  return { kind: 'rel', op: '∈', left: nameTerm(ref.name), right: d, span: d.span };
}

/** Does a declaration `a` (student) guarantee the declaration `b` (reference) of a function? */
function implies(a: Term, b: Term): boolean {
  if (printTerm(a) === printTerm(b)) return true;
  if (a.kind !== 'binop' || b.kind !== 'binop') return false;
  // any function is a partial function; a total one only on the same set
  if (b.op === '⇸') return a.op === '⇸' || a.op === '→';
  return a.op === '→' && printTerm(a.left) === printTerm(b.left);
}

/** A type that has a name as a set (a given set or ℤ), as text. */
function simpleType(t: ZType): string | null {
  return t.k === 'given' ? t.name : t.k === 'int' ? 'ℤ' : null;
}

const term = (text: string): Term | null => parseTerm(text).term;

/** {x ↦ S, …} → {x ↦ y | y ∈ S} */
function flatten(v: Value): Value {
  if (v.k !== 'set') return v;
  return mkSet(v.elems.flatMap((p) => (isPair(p) && p.elems[1].k === 'set' ? p.elems[1].elems.map((y) => pair(p.elems[0], y)) : [])));
}

/** {y ↦ x, …} → {x ↦ y, …} */
function swap(v: Value): Value {
  if (v.k !== 'set') return v;
  return mkSet(v.elems.flatMap((p) => (isPair(p) ? [pair(p.elems[1], p.elems[0])] : [])));
}

/** R → {x ↦ {y | (x, y) ∈ R}} for x in `domain` (null: dom R). */
function group(v: Value, domain: Value[] | null): Value {
  if (v.k !== 'set') return v;
  const images = new Map<string, { x: Value; ys: Value[] }>();
  for (const x of domain ?? []) images.set(valueKey(x), { x, ys: [] });
  for (const p of v.elems) {
    if (!isPair(p)) continue;
    const k = valueKey(p.elems[0]);
    if (!images.has(k)) {
      if (domain) continue; // outside the domain of a total function: cannot be represented
      images.set(k, { x: p.elems[0], ys: [] });
    }
    images.get(k)!.ys.push(p.elems[1]);
  }
  return mkSet([...images.values()].map(({ x, ys }) => pair(x, mkSet(ys))));
}

function setValues(v: Value, u: Universe): Value[] {
  return isSetLike(v) ? (enumerateSet(v, u) ?? []) : [];
}

/**
 * Injective matchings of reference variables to student variables (same type, or
 * another encoding), each reference variable matched or left unmatched (the student
 * may not have it yet, and a variable of the same type must not stand in for it).
 * Order: fewest reference variables left unmatched while a candidate was free, then per
 * variable identical types, other encodings, inverses, each by name similarity, then
 * declaration order; so the first one is the natural choice and the tie-breaker.
 */
function matchings(refs: VarInfo[], stus: VarInfo[], typeOf: (t: ZType) => ZType | null, givenMap: Map<string, string>): Map<string, Match>[] {
  const cands = refs.map((r) => {
    const t = typeOf(r.type);
    if (!t) return [];
    const ms = stus.flatMap((s) => encodings(r, t, s, givenMap).map((m) => ({ m, sim: nameSimilarity(r.name, s.name) })));
    return ms.sort((a, b) => a.m.rank - b.m.rank || b.sim - a.sim).map((x) => x.m);
  });
  const out: Map<string, Match>[] = [];
  const cur = new Map<string, Match>();
  const used = new Set<string>();
  // `skips`: how many more reference variables to leave unmatched although a candidate is free
  const go = (i: number, skips: number) => {
    if (out.length >= MAX_MATCHINGS || skips > refs.length - i) return;
    if (i === refs.length) {
      if (skips === 0) out.push(new Map(cur));
      return;
    }
    const free = cands[i].filter((m) => !used.has(m.stu));
    if (!free.length) return go(i + 1, skips);
    for (const m of free) {
      cur.set(refs[i].name, m);
      used.add(m.stu);
      go(i + 1, skips);
      cur.delete(refs[i].name);
      used.delete(m.stu);
    }
    if (skips > 0) go(i + 1, skips - 1);
  };
  for (let skips = 0; skips <= refs.length && out.length < MAX_MATCHINGS; skips++) go(0, skips);
  return out;
}

/** How alike two variable names are: 3 equal, 2 one contains the other, 1 a common start, 0. */
function nameSimilarity(a: string, b: string): number {
  const norm = (n: string) => n.replace(/[′?!]/g, '').toLowerCase().replace(/s$/, '');
  const x = norm(a);
  const y = norm(b);
  if (x === y) return 3;
  if (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))) return 2;
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  return p >= 3 ? 1 : 0;
}

/** Name similarity of a whole matching (the tie-breaker between equally good matchings). */
const similarity = (m: Map<string, Match>) => [...m].reduce((n, [r, x]) => n + nameSimilarity(r, x.stu), 0);

/** Matchings of an operation's inputs to inputs and outputs to outputs. */
function ioMatchings(refOp: SchemaInfo | undefined, stu: SchemaInfo, typeOf: (t: ZType) => ZType | null, givenMap: Map<string, string>): Map<string, Match>[] {
  if (!refOp) return [new Map()];
  const pick = (s: SchemaInfo, role: VarInfo['role']) => s.vars.filter((v) => v.role === role);
  const ins = matchings(pick(refOp, 'input'), pick(stu, 'input'), typeOf, givenMap);
  const outs = matchings(pick(refOp, 'output'), pick(stu, 'output'), typeOf, givenMap);
  const all: Map<string, Match>[] = [];
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
  refuteCache.clear();
  refuteRefCache.clear();
  refProofCache.clear();
  autoCache.clear();
  chosenCache.clear();
  judgeCache.clear();
  sampledCache.clear();
  refCache.clear();
}
