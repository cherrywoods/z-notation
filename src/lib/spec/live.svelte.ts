// Live analysis of the open spec: diagnostics per editor section, examples and
// inference results. Recomputed (debounced) whenever the spec changes.

import { analyseSpec, type Analysis } from '../z/index';
import type { ExampleBinding, InferenceResult } from '../z/results';
import { inference } from './engine';
import type { SectionPart, SpecDoc, ZDiagnostic } from './model';
import { store } from './store.svelte';
import { visibleDiagnostics } from './helpers';
import { goalsOf, referenceSpecOf, stepGoalsOf } from './topics';
import type { GoalStatus } from '../z/goals';
import { GoalRunner } from './goalRunner';

export type { GoalStatus };

const DELAY = 220;

const idle = (fn: () => void): (() => void) => {
  if (typeof requestIdleCallback === 'function') {
    const h = requestIdleCallback(fn, { timeout: 600 });
    return () => cancelIdleCallback(h);
  }
  const h = setTimeout(fn, 30);
  return () => clearTimeout(h);
};

class Live {
  /** Latest analysis of the open spec (null before the first run). */
  analysis = $state.raw<Analysis | null>(null);
  /** The spec snapshot the analysis belongs to. */
  spec = $state.raw<SpecDoc | null>(null);
  diagnostics = $state.raw<ZDiagnostic[]>([]);
  /** Inference facts + redundant predicates (null if unavailable). */
  inferred = $state.raw<InferenceResult | null>(null);
  /** Goal results of the analysed spec by step id (null: not checked yet). */
  goals = $state.raw<{ topicId: string; byStep: Record<string, GoalStatus[]> } | null>(null);
  /**
   * Which template given sets and variables the student's stand for (from the goal
   * check's matching), so that examples use the template's pools and fixed data. Pass it
   * to the generator; null (until the first goal check, own topic): go by names. Replaced
   * only when it changes, so examples do not switch worlds on every keystroke.
   */
  binding = $state.raw<ExampleBinding | null>(null);
  #bindingJson = '';

  /**
   * Example seeds per step ('state', 'init', op ids). The example world builds up step
   * by step: carriers come from the Types step, the state example from the State step
   * (operations run on it), and a seed changes only when its own step regenerates.
   * Seeds, modes and the binding belong to the open doc: another topic or a reset starts
   * afresh, and a removed step forgets its own (a re-added Operation3 gets the same id).
   */
  seeds = $state<Record<string, number>>({});
  /** Example mode per operation ('applicable' or the 'blocked' case). */
  modes = $state<Record<string, 'applicable' | 'blocked'>>({});

  #forget(ids: string[] | null) {
    if (!ids) {
      this.seeds = {};
      this.modes = {};
      this.binding = null;
      this.#bindingJson = '';
      return;
    }
    for (const id of ids) {
      delete this.seeds[id];
      delete this.modes[id];
    }
  }

  /** The step's seed: a stable default per step until the step regenerates. */
  seedFor(stepId: string): number {
    const s = this.seeds[stepId];
    if (s !== undefined) return s;
    let h = 2166136261;
    for (const ch of stepId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return h % 2 ** 31;
  }

  regenerate(stepId: string) {
    this.seeds[stepId] = Math.floor(Math.random() * 2 ** 31);
  }

  #timer: ReturnType<typeof setTimeout> | undefined;
  #lastJson = '';
  #cancelGoals: (() => void) | undefined;
  #goalRun = 0;
  /** Goal checks run in a Web Worker (they can take a second). */
  #goalRunner = new GoalRunner();

  constructor() {
    store.onStepsGone((ids) => this.#forget(ids));
    $effect.root(() => {
      $effect(() => {
        const doc = store.current;
        if (!doc) return;
        const json = JSON.stringify(doc); // tracks every field
        if (json === this.#lastJson) return;
        const first = this.#lastJson === '' || this.spec?.topicId !== doc.topicId;
        this.#lastJson = json;
        clearTimeout(this.#timer);
        if (first) this.#run(json);
        else this.#timer = setTimeout(() => this.#run(json), DELAY);
      });
    });
  }

  #run(json: string) {
    const snapshot = JSON.parse(json) as SpecDoc;
    let an: Analysis | null = null;
    try {
      an = analyseSpec(snapshot);
    } catch (e) {
      console.error('[live] analysis failed', e);
    }
    let inf: InferenceResult | null = null;
    if (an && inference) {
      try {
        inf = inference.infer(snapshot, an);
      } catch (e) {
        console.error('[live] inference failed', e);
      }
    }
    this.spec = snapshot;
    this.analysis = an;
    this.inferred = inf;
    this.diagnostics = an ? visibleDiagnostics(snapshot, [...an.diagnostics, ...(inf?.redundant ?? [])]) : [];
    this.#scheduleGoals(snapshot, an);
  }

  /**
   * Goals are checked off the main thread, started when the browser is idle; results of
   * an older spec are dropped. The goal lists update when the results arrive.
   */
  #scheduleGoals(spec: SpecDoc, an: Analysis | null) {
    this.#cancelGoals?.();
    const run = ++this.#goalRun;
    if (this.goals && this.goals.topicId !== spec.topicId) this.goals = null;
    const goals = goalsOf(spec.topicId);
    const reference = goals ? referenceSpecOf(spec.topicId) : undefined;
    if (!an || !goals || !reference) return;
    this.#cancelGoals = idle(() => {
      if (run !== this.#goalRun) return;
      this.#goalRunner.check({ spec, reference, goals }, an).then(
        (r) => {
          if (!r || run !== this.#goalRun || store.current?.topicId !== spec.topicId) return;
          this.goals = { topicId: spec.topicId, byStep: r.byStep };
          const json = JSON.stringify(r.binding);
          if (json !== this.#bindingJson) {
            this.#bindingJson = json;
            this.binding = r.binding;
          }
        },
        (e) => console.error('[live] goal check failed', e),
      );
    });
  }

  /** The goals of a step ('types', 'state', 'init', 'op-…') with their status. */
  goalsFor(stepId: string): GoalStatus[] {
    const topicId = store.current?.topicId;
    if (!topicId) return [];
    const list = stepGoalsOf(topicId, stepId);
    if (!list.length) return [];
    const r = this.goals; // read first: components subscribe before the first result
    const done = r && r.topicId === topicId ? r.byStep[stepId] : undefined;
    // full status (via, evidence) for the template's goals; until the first result they
    // show as open. The checker's automatic goals (e.g. "Runs whenever it should") follow.
    const own = list.map((g, i): GoalStatus => (done?.[i]?.text === g.text ? done[i] : { text: g.text, achieved: false }));
    return done ? [...own, ...done.slice(list.length)] : own;
  }

  diagnosticsFor(schemaId: string, part: SectionPart): ZDiagnostic[] {
    return this.diagnostics.filter((d) => d.section.schemaId === schemaId && d.section.part === part);
  }
}

export const live = new Live();
