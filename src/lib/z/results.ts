// Result types of the example generator (generate.ts) and the inference engine
// (infer.ts). The side panels (src/ui/panels) render these.

import type { Value } from './values';
import type { Derivation, SectionRef, ZDiagnostic } from '../spec/model';

// ── examples ────────────────────────────────────────────────────────────────

/**
 * Which template names the student's own names stand for, so that examples use the
 * template's value pools and fixed data (e.g. [Trains, Blocks, Signals] for TRAIN, …).
 */
export interface ExampleBinding {
  /** student given set → template given set (for its value pool) */
  givens: Record<string, string>;
  /** student state variable → template variable whose fixed value it takes; inverse = pairs swapped */
  vars: Record<string, { ref: string; inverse?: boolean }>;
}

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
   *   'chosen'    — picked by the search; whether the predicates fix it is not known
   *                 (no other value was found, but that is no proof, or no time was left)
   * 'computed' / 'unchanged' are only claimed when established.
   * Before-state and input variables: undefined.
   */
  status?: 'computed' | 'unchanged' | 'free' | 'chosen';
  /** For status 'free': another value that would also be allowed (printValue text). */
  alternative?: string;
  /** For status 'free': that other value itself. */
  alternativeValue?: Value;
  /** Fixed example data (spec.fixed) rather than a generated value. */
  fixed?: boolean;
}

/** Truth of one predicate in the example. */
export interface PredCheck {
  /** Where the predicate is written (state invariant, this schema's predicates, …). */
  section?: SectionRef;
  index?: number;
  /** 'frame': `v′ = v` for a state variable the Δ operation does not mention. */
  origin: 'own' | 'invariant' | 'invariant′' | 'xi' | 'frame';
  /** Printed predicate. */
  text: string;
  /** true / false, or 'undefined' when evaluation hit an undefined application. */
  result: boolean | 'undefined';
  /**
   * The verdict relied on cutting off an infinite set (only some numbers of ℕ / ℤ were
   * tried, or only the example elements of an infinite given set were counted), so it
   * may be wrong: show it as "≈" instead of ✓ / ✗. Only set (to true) when it did.
   */
  bounded?: boolean;
  /** For 'undefined': why, e.g. "borrower(book?) is undefined: book? = Emma ∉ dom borrower". */
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
      /**
       * A `before` state was passed but no longer fits the spec (e.g. the invariant
       * changed since), so this example uses a fresh before-state instead.
       */
      freshBefore?: boolean;
    }
  | {
      kind: 'op';
      ok: false;
      /**
       * 'no-before'  no state satisfies the invariant
       * 'no-input'   no state + inputs satisfy the preconditions (operation never applicable)
       * 'no-after'   a valid before-state + inputs exist, but no after-state/outputs satisfy all
       *              predicates (typically: the effect breaks the invariant′)
       * 'no-blocked' the operation is never blocked (for the blocked-case request); with a
       *              given before-state: no input is blocked in that state
       * 'no-input-for-state'  with a given before-state: no input meets the preconditions
       *              in that state (another state might work)
       */
      reason: 'no-before' | 'no-input' | 'no-after' | 'no-blocked' | 'no-input-for-state';
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
   * 'guaranteed' a precondition the invariant after imposes where the operation changes
   *             the state (e.g. `balance(a?) - amount? ≥ -overdraft(a?)`); 'unchanged'
   *             also covers Δ variables the operation does not mention (reason "not mentioned")
   */
  kind: 'effect' | 'unchanged' | 'defined' | 'initial' | 'implied' | 'guaranteed';
  /** The fact in Z, e.g. "onLoan′ = onLoan ∪ {book?}". */
  text: string;
  derivation: Derivation;
  /** A short plain-words reading, e.g. "every patient is in patients" (for 'implied' facts). */
  note?: string;
}

export interface InferenceResult {
  facts: InferredFact[];
  /** Redundant predicates (kind 'redundant', severity 'info', with derivation). */
  redundant: ZDiagnostic[];
}
