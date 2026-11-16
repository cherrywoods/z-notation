// Live analysis of the open spec: diagnostics per editor section, examples and
// inference results. Recomputed (debounced) whenever the spec changes.

import { analyseSpec, type Analysis } from '../z/index';
import type { InferenceResult } from '../z/results';
import { inference } from './engine';
import type { SectionPart, SpecDoc, ZDiagnostic } from './model';
import { store } from './store.svelte';

const DELAY = 220;

class Live {
  /** Latest analysis of the open spec (null before the first run). */
  analysis = $state.raw<Analysis | null>(null);
  /** The spec snapshot the analysis belongs to. */
  spec = $state.raw<SpecDoc | null>(null);
  diagnostics = $state.raw<ZDiagnostic[]>([]);
  /** Inference facts + redundant predicates (null if unavailable). */
  inferred = $state.raw<InferenceResult | null>(null);

  #timer: ReturnType<typeof setTimeout> | undefined;
  #lastJson = '';

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
    this.diagnostics = an ? [...an.diagnostics, ...(inf?.redundant ?? [])] : [];
  }

  diagnosticsFor(schemaId: string, part: SectionPart): ZDiagnostic[] {
    return this.diagnostics.filter((d) => d.section.schemaId === schemaId && d.section.part === part);
  }
}

export const live = new Live();
