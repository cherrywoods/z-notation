// Live analysis of the open spec: diagnostics per editor section, examples and
// inference results. Recomputed (debounced) whenever the spec changes.

import { analyseSpec, type Analysis } from '../z/index';
import type { InferenceResult } from '../z/results';
import { inference } from './engine';
import type { SectionPart, SpecDoc, ZDiagnostic } from './model';
import { store } from './store.svelte';
import { visibleDiagnostics } from './helpers';
import { goalsOf, referenceSpecOf, stepGoalsOf } from './topics';
import { checkGoals, type GoalStatus } from '../z/goals';

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

  #timer: ReturnType<typeof setTimeout> | undefined;
  #lastJson = '';
  #cancelGoals: (() => void) | undefined;
  #goalRun = 0;

  constructor() {
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

  /** Goals are checked when the browser is idle; results of an older spec are dropped. */
  #scheduleGoals(spec: SpecDoc, an: Analysis | null) {
    this.#cancelGoals?.();
    const run = ++this.#goalRun;
    if (this.goals && this.goals.topicId !== spec.topicId) this.goals = null;
    const goals = goalsOf(spec.topicId);
    const reference = goals ? referenceSpecOf(spec.topicId) : undefined;
    if (!an || !goals || !reference) return;
    this.#cancelGoals = idle(() => {
      if (run !== this.#goalRun) return;
      try {
        const byStep = checkGoals(spec, an, reference, goals);
        if (run !== this.#goalRun) return;
        this.goals = { topicId: spec.topicId, byStep };
      } catch (e) {
        console.error('[live] goal check failed', e);
      }
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
    return list.map((g, i) => ({ text: g.text, achieved: !!done?.[i]?.achieved }));
  }

  diagnosticsFor(schemaId: string, part: SectionPart): ZDiagnostic[] {
    return this.diagnostics.filter((d) => d.section.schemaId === schemaId && d.section.part === part);
  }
}

export const live = new Live();
