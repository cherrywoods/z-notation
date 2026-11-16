// AST for the Z subset. Expressions and predicates share one `Term` type (Z's
// grammar is ambiguous between the two, e.g. inside parentheses); the type
// checker decides which terms are predicates.
//
// Spans are offsets into the source text of the editor section the term came from
// (see `Section` in ../spec/model.ts).

import type { Decoration } from './lexer';

export interface Span {
  from: number;
  to: number;
}

/** Binary operators on expressions (canonical unicode text). */
export type BinOp =
  | '↔' // relation set
  | '⇸' // partial function set
  | '→' // total function set
  | '↦' // maplet (pair)
  | '∪'
  | '∩'
  | '∖'
  | '+'
  | '-'
  | '*'
  | 'div'
  | 'mod'
  | '..'; // number range a..b

/** Prefix operators on expressions. */
export type UnOp = 'dom' | 'ran' | 'ℙ' | '#' | 'neg';

/** Relational predicates. */
export type RelOp = '=' | '≠' | '∈' | '∉' | '⊆' | '⊂' | '<' | '≤' | '>' | '≥';

export type Term =
  // ── expressions ────────────────────────────────────────────────────────────
  | { kind: 'name'; name: string; base: string; decoration: Decoration; span: Span }
  | { kind: 'num'; value: number; span: Span } // 3, -3, 0.25 (a minus before a literal is folded in)
  | { kind: 'builtinSet'; set: 'ℕ' | 'ℕ₁' | 'ℤ' | 'ℝ'; span: Span }
  | { kind: 'emptyset'; span: Span }
  | { kind: 'setDisplay'; elems: Term[]; span: Span } // {a, b, c}
  | { kind: 'setComp'; decls: VarDecl[]; pred?: Term; expr?: Term; span: Span } // { x : S | P • e }
  | { kind: 'tuple'; elems: Term[]; span: Span } // (a, b)
  | { kind: 'cross'; elems: Term[]; span: Span } // A × B × C
  | { kind: 'apply'; fn: Term; arg: Term; span: Span } // f(x)
  | { kind: 'unop'; op: UnOp; arg: Term; span: Span }
  | { kind: 'binop'; op: BinOp; left: Term; right: Term; span: Span }
  // ── predicates ─────────────────────────────────────────────────────────────
  | { kind: 'bool'; value: boolean; span: Span } // true / false
  | { kind: 'rel'; op: RelOp; left: Term; right: Term; span: Span }
  | { kind: 'not'; arg: Term; span: Span }
  | { kind: 'logic'; op: '∧' | '∨' | '⇒' | '⇔'; left: Term; right: Term; span: Span }
  | { kind: 'quant'; q: '∀' | '∃'; decls: VarDecl[]; pred?: Term; body: Term; span: Span };

export type TermKind = Term['kind'];

/** `x, y : T` (also `x ∈ T` inside set comprehensions and quantifiers). */
export interface VarDecl {
  kind: 'var';
  names: { name: string; base: string; decoration: Decoration; span: Span }[];
  type: Term;
  span: Span;
  /** Separator as written (`x : S` or `x ∈ S`); only affects printing. Default ':'. */
  sep?: ':' | '∈';
}

/** A line in a schema's declaration part. */
export type Decl =
  | VarDecl
  | { kind: 'delta'; schema: string; span: Span } // ΔState
  | { kind: 'xi'; schema: string; span: Span } // ΞState
  | { kind: 'include'; schema: string; span: Span }; // State (only used by the Init schema)

/** `[NAME, DATE]` */
export interface GivenSetsDecl {
  names: { name: string; span: Span }[];
  span: Span;
}

/** Parsed declaration part + predicate part of one schema. */
export interface SchemaAst {
  name: string;
  decls: Decl[];
  /** Predicates, one per line (newline = conjunction). */
  preds: Term[];
}
