// The single source of truth for Z symbols: how they look (unicode), how to type
// them (ASCII shortcuts), how they are coloured (category), what the symbol library
// inserts (snippet), and which explainer they open (id).

/**
 * Highlighting categories. Colours come from GitHub's "Light Colorblind" syntax theme
 * (see --z-* tokens in src/app.css).
 */
export type SymbolCategory =
  | 'type' // ℙ ℕ ℤ ℝ ×, given-set names
  | 'relation' // ↔ ⇸ → ↦ dom ran
  | 'set' // ∈ ∉ ⊆ ⊂ ∪ ∩ ∖ ∅ # { | }
  | 'logic' // ∧ ∨ ¬ ⇒ ⇔ ∀ ∃ • = ≠ < ≤ > ≥ + − ∗
  | 'schema' // Δ Ξ and the declaration colon
  | 'decoration'; // ′ ? !

export interface ZSymbol {
  /** Stable id; also the explainer key. */
  id: string;
  /** Canonical unicode text, e.g. '⇸' or 'dom'. */
  text: string;
  /** Short human-readable name, e.g. 'partial function'. */
  name: string;
  category: SymbolCategory;
  /**
   * ASCII sequences that are auto-replaced by `text` while typing.
   * Entries starting with a letter are *words*: they are replaced only when typed as a
   * whole token (i.e. when the next non-identifier character is typed).
   */
  ascii?: string[];
  /** CodeMirror snippet inserted from the symbol library; `${X}` marks a field to fill in. */
  snippet?: string;
  /** Where the symbol appears in the library ('main' row or the 'more' drawer). */
  library?: 'main' | 'more';
  /** Word-like symbol (dom, ran) rather than a glyph. */
  keyword?: boolean;
}

export const SYMBOLS: ZSymbol[] = [
  // ── declarations & schemas ───────────────────────────────────────────────
  { id: 'colon', text: ':', name: 'declaration', category: 'schema' },
  { id: 'delta', text: 'Δ', name: 'Delta: state may change', category: 'schema', ascii: ['Delta'], snippet: 'Δ${State}', library: 'main' },
  { id: 'xi', text: 'Ξ', name: 'Xi: state stays unchanged', category: 'schema', ascii: ['Xi'], snippet: 'Ξ${State}', library: 'main' },
  { id: 'prime', text: '′', name: 'after state (prime)', category: 'decoration', ascii: ["'"], library: 'main', snippet: '′' },
  { id: 'input', text: '?', name: 'input', category: 'decoration', library: 'main', snippet: '?' },
  { id: 'output', text: '!', name: 'output', category: 'decoration', library: 'main', snippet: '!' },

  // ── types & sets ─────────────────────────────────────────────────────────
  { id: 'power', text: 'ℙ', name: 'power set', category: 'type', ascii: ['PP'], snippet: 'ℙ ${X}', library: 'main' },
  { id: 'nat', text: 'ℕ', name: 'natural numbers', category: 'type', ascii: ['NN'], snippet: 'ℕ', library: 'more' },
  { id: 'nat1', text: 'ℕ₁', name: 'positive natural numbers', category: 'type', ascii: ['NN1'], snippet: 'ℕ₁', library: 'more' },
  { id: 'int', text: 'ℤ', name: 'integers', category: 'type', ascii: ['ZZ'], snippet: 'ℤ', library: 'more' },
  { id: 'real', text: 'ℝ', name: 'real numbers', category: 'type', ascii: ['RR'], snippet: 'ℝ', library: 'more' },
  { id: 'cross', text: '×', name: 'Cartesian product', category: 'type', ascii: ['><'], snippet: '${X} × ${Y}', library: 'more' },

  // ── relations & functions ────────────────────────────────────────────────
  { id: 'rel', text: '↔', name: 'relation', category: 'relation', ascii: ['<->'], snippet: '${X} ↔ ${Y}', library: 'main' },
  { id: 'pfun', text: '⇸', name: 'partial function', category: 'relation', ascii: ['-|>', '+->'], snippet: '${X} ⇸ ${Y}', library: 'main' },
  { id: 'tfun', text: '→', name: 'total function', category: 'relation', ascii: ['->'], snippet: '${X} → ${Y}', library: 'main' },
  { id: 'maplet', text: '↦', name: 'maplet (pair)', category: 'relation', ascii: ['|->'], snippet: '${x} ↦ ${y}', library: 'main' },
  { id: 'dom', text: 'dom', name: 'domain', category: 'relation', keyword: true, snippet: 'dom ${R}', library: 'main' },
  { id: 'ran', text: 'ran', name: 'range', category: 'relation', keyword: true, snippet: 'ran ${R}', library: 'main' },
  { id: 'apply', text: '( )', name: 'function application', category: 'relation', snippet: '${f}(${x})', library: 'more' },

  // ── sets ─────────────────────────────────────────────────────────────────
  { id: 'in', text: '∈', name: 'element of', category: 'set', ascii: ['in'], snippet: '${x} ∈ ${S}', library: 'main' },
  { id: 'notin', text: '∉', name: 'not element of', category: 'set', ascii: ['notin'], snippet: '${x} ∉ ${S}', library: 'main' },
  { id: 'subseteq', text: '⊆', name: 'subset', category: 'set', ascii: ['<:'], snippet: '${A} ⊆ ${B}', library: 'main' },
  { id: 'subset', text: '⊂', name: 'proper subset', category: 'set', ascii: ['<<:'], snippet: '${A} ⊂ ${B}', library: 'more' },
  { id: 'cup', text: '∪', name: 'union', category: 'set', ascii: ['union'], snippet: '${A} ∪ ${B}', library: 'main' },
  { id: 'cap', text: '∩', name: 'intersection', category: 'set', ascii: ['inter'], snippet: '${A} ∩ ${B}', library: 'main' },
  { id: 'setminus', text: '∖', name: 'set difference', category: 'set', ascii: ['\\'], snippet: '${A} ∖ ${B}', library: 'main' },
  { id: 'emptyset', text: '∅', name: 'empty set', category: 'set', ascii: ['{}'], snippet: '∅', library: 'main' },
  { id: 'card', text: '#', name: 'number of elements', category: 'set', snippet: '#${S}', library: 'main' },
  { id: 'setdisplay', text: '{ , }', name: 'set of elements', category: 'set', snippet: '{${a}, ${b}}', library: 'more' },
  { id: 'setcomp', text: '{ | }', name: 'set comprehension', category: 'set', snippet: '{ ${x} ∈ ${S} | ${P} }', library: 'main' },

  // ── logic & arithmetic ───────────────────────────────────────────────────
  { id: 'and', text: '∧', name: 'and', category: 'logic', ascii: ['/\\'], snippet: '∧', library: 'main' },
  { id: 'or', text: '∨', name: 'or', category: 'logic', ascii: ['\\/'], snippet: '∨', library: 'main' },
  { id: 'not', text: '¬', name: 'not', category: 'logic', ascii: ['~', 'not'], snippet: '¬ ', library: 'main' },
  { id: 'implies', text: '⇒', name: 'implies', category: 'logic', ascii: ['=>'], snippet: '${P} ⇒ ${Q}', library: 'main' },
  { id: 'iff', text: '⇔', name: 'if and only if', category: 'logic', ascii: ['<=>'], snippet: '${P} ⇔ ${Q}', library: 'more' },
  { id: 'forall', text: '∀', name: 'for all', category: 'logic', ascii: ['forall'], snippet: '∀ ${x} : ${S} • ${P}', library: 'main' },
  { id: 'exists', text: '∃', name: 'there exists', category: 'logic', ascii: ['exists'], snippet: '∃ ${x} : ${S} • ${P}', library: 'main' },
  { id: 'spot', text: '•', name: 'such that (spot)', category: 'logic', ascii: ['@'] },
  { id: 'eq', text: '=', name: 'equals', category: 'logic' },
  { id: 'neq', text: '≠', name: 'not equal', category: 'logic', ascii: ['/='], snippet: '≠', library: 'more' },
  { id: 'lt', text: '<', name: 'less than', category: 'logic' },
  { id: 'leq', text: '≤', name: 'less or equal', category: 'logic', ascii: ['<='], snippet: '≤', library: 'more' },
  { id: 'gt', text: '>', name: 'greater than', category: 'logic' },
  { id: 'geq', text: '≥', name: 'greater or equal', category: 'logic', ascii: ['>='], snippet: '≥', library: 'more' },
];

export const SYMBOL_BY_ID: Record<string, ZSymbol> = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));

/** Look up a symbol by its canonical text (e.g. '⇸' → pfun). */
export const SYMBOL_BY_TEXT: Record<string, ZSymbol> = Object.fromEntries(
  SYMBOLS.filter((s) => !['apply', 'setdisplay', 'setcomp'].includes(s.id)).map((s) => [s.text, s]),
);

/** Glyph-like (non-word) ASCII shortcuts, longest first: [ascii, unicode]. */
export const ASCII_GLYPH_SHORTCUTS: [string, string][] = SYMBOLS.flatMap((s) =>
  (s.ascii ?? []).filter((a) => !/^[A-Za-z]/.test(a)).map((a) => [a, s.text] as [string, string]),
).sort((a, b) => b[0].length - a[0].length);

/** Word shortcuts (in, notin, union, …, Delta, Xi): [word, unicode]. */
export const ASCII_WORD_SHORTCUTS: [string, string][] = SYMBOLS.flatMap((s) =>
  (s.ascii ?? []).filter((a) => /^[A-Za-z]/.test(a)).map((a) => [a, s.text] as [string, string]),
);
