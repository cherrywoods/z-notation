// The editable specification as the student sees it: plain texts per editor
// section. The Z engine parses these texts; the UI edits them.

export type SchemaRole = 'state' | 'init' | 'operation';

/** Suggested kind of an operation: query (Ξ, read-only) or update (Δ). */
export type OpKind = 'query' | 'update';

export interface SchemaDoc {
  /** Stable id: 'state', 'init', or 'op-…' for operations. */
  id: string;
  role: SchemaRole;
  /** Schema name, e.g. 'Library', 'Lend'. */
  name: string;
  /** Declaration part (above the line), one declaration per line. */
  decls: string;
  /** Predicate part (below the line), one predicate per line. */
  preds: string;
  /** Short task prompt shown above the schema box (very little text!). */
  prompt?: string;
  /** Placeholder of the (empty) predicate part, e.g. the key safety property. */
  predPrompt?: string;
  /** For operations: suggested kind (shown as a small Ξ/Δ badge). */
  opKind?: OpKind;
}

export interface SpecDoc {
  /** Topic id (template id, or 'custom'). */
  topicId: string;
  /** Revision of the template it was made from (missing = 1; see topics.ts revisionOf). */
  revision?: number;
  /** Human title of the system, e.g. 'Medication Prescribing'. */
  title: string;
  /** Own topic only: the student's short description of the system (System step). */
  description?: string;
  /** Text of the given-set paragraph, e.g. '[BOOK, MEMBER]'. */
  given: string;
  /** Short prompt for the Types step. */
  typesPrompt?: string;
  /** Example values for given sets (missing sets get name1, name2, …). */
  pools: Record<string, string[]>;
  /**
   * Given sets that are infinite in principle, shown as `DATE = {2.Feb, 17.Apr, …}`.
   * Examples still use the finite pool.
   */
  infinite?: string[];
  /**
   * Fixed example values for "fixed data" state variables (a track layout, a
   * compatibility table), as Z set displays over pool values, e.g.
   * `{ compatible: '{Oneg ↦ Oneg, Oneg ↦ Apos}' }`. The example generator uses them
   * instead of random values (when they still satisfy the declarations).
   */
  fixed?: Record<string, string>;
  state: SchemaDoc;
  /** Optional initial-state schema (imports the state schema). */
  init: SchemaDoc | null;
  operations: SchemaDoc[];
}

/** One editable text region. `part` 'given' only exists for schemaId 'types'. */
export type SectionPart = 'given' | 'decls' | 'preds';
export interface SectionRef {
  schemaId: string; // 'types' | 'state' | 'init' | 'op-…'
  part: SectionPart;
}
export const sectionKey = (s: SectionRef) => `${s.schemaId}:${s.part}`;

export type Severity = 'error' | 'warning' | 'info';

/** A diagnostic attached to a text range in one section. */
export interface ZDiagnostic {
  section: SectionRef;
  from: number;
  to: number;
  severity: Severity;
  /** syntax / type errors, redundant (already implied) predicates, … */
  kind: 'syntax' | 'type' | 'scope' | 'redundant' | 'undefined';
  message: string;
  /** For 'redundant': why it is implied (shown in the tooltip and the inference panel). */
  derivation?: Derivation;
}

/**
 * A derivation in the style of the lecture slides:
 *
 *   onLoan′ = dom borrower′                        [invariant after]
 *           = dom (borrower ∪ {book? ↦ member?})   [spec of Lend]
 *          = …
 *
 * `chain`: an equational/relational chain starting at `start`.
 * `facts`: premises (each with a reason) that together give `conclusion`.
 */
export type Derivation =
  | {
      kind: 'chain';
      start: string;
      steps: { rel: '=' | '⊆' | '∈' | '⇔' | '⇒'; expr: string; reason: string }[];
    }
  | {
      kind: 'facts';
      premises: { text: string; reason: string }[];
      conclusion: string;
    };
