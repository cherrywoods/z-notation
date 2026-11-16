// Result types of the example generator (generate.ts) and the inference engine
// (infer.ts). The side panels (src/ui/panels) render these.

import type { Value } from './values';
import type { Derivation, SectionRef, ZDiagnostic } from '../spec/model';

// ── examples ────────────────────────────────────────────────────────────────

/** One variable of an example, e.g. `borrower = {Dune ↦ Ada}`. */
export interface ShownVar {
  /** Decorated name: 'onLoan', 'onLoan′', 'book?', 'member!'. */
  name: string;
  value: Value;
  /** printValue(value), in Z set notation as on the slides. */
  text: string;
  /**
   * After-state / output variables: how the value came about.
   *   'computed'  — determined by the predicates (e.g. borrower′ = borrower ∪ {…})
   *   'unchanged' — equal to the before value
   *   'free'      — NOT determined: other values would satisfy all predicates too
   * Before-state and input variables: undefined.
   */
  status?: 'computed' | 'unchanged' | 'free';
  /** For status 'free': another value that would also be allowed (printValue text). */
  alternative?: string;
  /** Fixed example data (spec.fixed) rather than a generated value. */
  fixed?: boolean;
}

/** Truth of one predicate in the example. */
export interface PredCheck {
  /** Where the predicate is written (state invariant, this schema's predicates, …). */
  section?: SectionRef;
  index?: number;
  origin: 'own' | 'invariant' | 'invariant′' | 'xi';
  /** Printed predicate. */
  text: string;
  /** true / false, or 'undefined' when evaluation hit an undefined application. */
  result: boolean | 'undefined';
  /** For 'undefined': why, e.g. "borrower(Emma) is undefined: Emma ∉ dom borrower". */
  message?: string;
}

export interface TypesExample {
  kind: 'types';
  /** Example carrier of each given set, in given-set order. */
  carriers: { name: string; values: string[] }[];
}

export type StateExample =
  | {
      kind: 'state';
      ok: true;
      vars: ShownVar[];
      checks: PredCheck[];
    }
  | {
      kind: 'state';
      ok: false;
      /** Short, student-facing: why no example was found. */
      message: string;
      /** The best candidate found and the predicates it violates (helps finding contradictions). */
      best?: { vars: ShownVar[]; failed: PredCheck[] };
    };

export type OpExample =
  | {
      kind: 'op';
      ok: true;
      /** 'applicable': precondition holds and an after-state exists.
       *  'blocked': the requested blocked case — a precondition is false (see `failed`). */
      status: 'applicable' | 'blocked';
      before: ShownVar[];
      inputs: ShownVar[];
      /** Empty when blocked. */
      after: ShownVar[];
      outputs: ShownVar[];
      checks: PredCheck[];
      /** For 'blocked': the explicit preconditions that are false. */
      failed?: PredCheck[];
    }
  | {
      kind: 'op';
      ok: false;
      /**
       * 'no-before'  no state satisfies the invariant
       * 'no-input'   no state + inputs satisfy the preconditions (operation never applicable)
       * 'no-after'   a valid before-state + inputs exist, but no after-state/outputs satisfy all
       *              predicates (typically: the effect breaks the invariant′)
       * 'no-blocked' the operation is never blocked (for the blocked-case request)
       */
      reason: 'no-before' | 'no-input' | 'no-after' | 'no-blocked';
      message: string;
      before?: ShownVar[];
      inputs?: ShownVar[];
      /** For 'no-after': predicates violated by the best after-state candidate. */
      failed?: PredCheck[];
    };

// ── inference ───────────────────────────────────────────────────────────────

export interface InferredFact {
  schemaId: string;
  /**
   * 'effect'    v′ = e derived for a state variable the operation does not set explicitly
   * 'unchanged' v′ = v from Ξ
   * 'defined'   f(x) is defined (x ∈ dom f follows from the predicates)
   * 'initial'   a value of the initial state that follows from Init + invariant
   * 'implied'   another useful consequence
   */
  kind: 'effect' | 'unchanged' | 'defined' | 'initial' | 'implied';
  /** The fact in Z, e.g. "onLoan′ = onLoan ∪ {book?}". */
  text: string;
  derivation: Derivation;
}

export interface InferenceResult {
  facts: InferredFact[];
  /** Redundant predicates (kind 'redundant', severity 'info', with derivation). */
  redundant: ZDiagnostic[];
}
