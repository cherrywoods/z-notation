// Lexer for the Z subset used in the tutorial. Accepts both unicode symbols and the
// ASCII shortcuts (so pasted ASCII text still parses), and always reports the
// canonical unicode value of a token.

import { ASCII_GLYPH_SHORTCUTS, SYMBOL_BY_TEXT, type SymbolCategory } from './symbols';

export type TokenKind = 'ident' | 'number' | 'sym' | 'keyword' | 'newline' | 'error' | 'eof';
export type Decoration = '' | '′' | '?' | '!';

export interface Token {
  kind: TokenKind;
  /**
   * Canonical value. sym/keyword: unicode text ('⇸', 'dom', '∈').
   * ident: full decorated name ('borrower′', 'book?'). number: the digits ('42', '0.25').
   */
  value: string;
  /** Source offsets (half-open). */
  from: number;
  to: number;
  /** For sym/keyword tokens: id in SYMBOLS (if the symbol has one). */
  symbolId?: string;
  /** For ident tokens: the name without decoration. */
  base?: string;
  /** For ident tokens: the decoration (prime, ?, !) or ''. */
  decoration?: Decoration;
  /** For decorated ident tokens: source offset where the decoration starts. */
  decorationFrom?: number;
}

/** Characters that look like letters but are Z symbols. */
const NOT_IDENT = new Set(['ℙ', 'ℕ', 'ℤ', 'ℝ', 'Δ', 'Ξ']);
const IDENT_START = /[\p{L}_]/u;
const IDENT_CONT = /[\p{L}\p{N}_]/u;

export function isIdentStart(ch: string): boolean {
  return IDENT_START.test(ch) && !NOT_IDENT.has(ch);
}
export function isIdentChar(ch: string): boolean {
  return IDENT_CONT.test(ch) && !NOT_IDENT.has(ch);
}

/** Word tokens with special meaning. Words map to their canonical symbol text. */
const WORDS: Record<string, string> = {
  dom: 'dom',
  ran: 'ran',
  div: 'div',
  mod: 'mod',
  // ASCII word shortcuts (normally replaced while typing, but accepted as-is)
  in: '∈',
  notin: '∉',
  union: '∪',
  inter: '∩',
  forall: '∀',
  exists: '∃',
  not: '¬',
};

/** Punctuation and operator symbols without an entry in SYMBOLS. */
const PLAIN_SYMBOLS = new Set(['(', ')', '[', ']', '{', '}', ',', ';', '|', '+', '-', '*', '..']);

/** Unicode look-alikes normalised to a canonical form. */
const ALIASES: Record<string, string> = {
  '⦁': '•', // Z NOTATION SPOT
  '−': '-', // MINUS SIGN
  '∗': '*',
  '⤀': '⇸', // in case a font substitutes
  '∖': '∖',
};

/** Multi-character sequences, longest first: [source text, canonical value]. */
const MULTI: [string, string][] = (
  [...ASCII_GLYPH_SHORTCUTS.filter(([a]) => a.length > 1), ['ℕ₁', 'ℕ₁'], ['..', '..']] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);

/** Single ASCII characters that are shortcuts for unicode symbols ('\\' → '∖', '@' → '•', '~' → '¬'). */
const SINGLE_ASCII: Record<string, string> = Object.fromEntries(
  ASCII_GLYPH_SHORTCUTS.filter(([a]) => a.length === 1 && a !== "'").map(([a, u]) => [a, u]),
);

export function symbolIdOf(value: string): string | undefined {
  return SYMBOL_BY_TEXT[value]?.id;
}

export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  const push = (t: Token) => tokens.push(t);

  while (i < n) {
    const ch = src[i];

    // whitespace
    if (ch === '\n') {
      push({ kind: 'newline', value: '\n', from: i, to: i + 1 });
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === ' ') {
      i++;
      continue;
    }

    // identifiers & words
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdentChar(src[j])) j++;
      const base = src.slice(i, j);
      if (Object.prototype.hasOwnProperty.call(WORDS, base)) {
        const value = WORDS[base];
        push({ kind: 'keyword', value, from: i, to: j, symbolId: symbolIdOf(value) });
        i = j;
        continue;
      }
      let decoration: Decoration = '';
      let decorationFrom: number | undefined;
      const d = src[j];
      if (d === '′' || d === "'") decoration = '′';
      else if (d === '?') decoration = '?';
      else if (d === '!') decoration = '!';
      if (decoration) {
        decorationFrom = j;
        j++;
      }
      push({ kind: 'ident', value: base + decoration, base, decoration, decorationFrom, from: i, to: j });
      i = j;
      continue;
    }

    // numbers: digits, optionally a decimal part (`0.25`). The dot belongs to the number
    // only if a digit follows, so `1..5` is a range and `2.Feb` is not a number.
    if (ch >= '0' && ch <= '9') {
      const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
      let j = i + 1;
      while (j < n && isDigit(src[j])) j++;
      if (src[j] === '.' && isDigit(src[j + 1])) {
        j += 2;
        while (j < n && isDigit(src[j])) j++;
      }
      push({ kind: 'number', value: src.slice(i, j), from: i, to: j });
      i = j;
      continue;
    }

    // multi-character symbols (ASCII shortcuts, ℕ₁, ..)
    let matched = false;
    for (const [seq, value] of MULTI) {
      if (src.startsWith(seq, i)) {
        // '{}' is only the empty set if not followed by something odd; always fine here.
        push({ kind: 'sym', value, from: i, to: i + seq.length, symbolId: symbolIdOf(value) });
        i += seq.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // single characters
    let value = ALIASES[ch] ?? SINGLE_ASCII[ch] ?? ch;
    if (ch === "'" || ch === '′') value = '′';
    if (SYMBOL_BY_TEXT[value] || PLAIN_SYMBOLS.has(value) || value === '′') {
      push({ kind: 'sym', value, from: i, to: i + 1, symbolId: symbolIdOf(value) });
      i++;
      continue;
    }

    push({ kind: 'error', value: ch, from: i, to: i + 1 });
    i++;
  }

  push({ kind: 'eof', value: '', from: n, to: n });
  return tokens;
}

/** Highlighting class for a token (used by the editor and the static renderer). */
export interface HighlightSpan {
  from: number;
  to: number;
  /** CSS class suffix: z-type, z-relation, z-set, z-logic, z-schema, z-decoration, z-ident, z-given, z-number, z-error */
  cls: string;
  /** Explainer id to show on hover, if any. */
  explain?: string;
}

/**
 * Turn a source text into highlight spans. `givenSets` are names of given sets
 * (coloured as types); `schemaNames` are schema names (after Δ/Ξ).
 */
export function highlight(src: string, givenSets: ReadonlySet<string> = new Set()): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  const toks = lex(src);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind === 'eof' || t.kind === 'newline') continue;
    if (t.kind === 'error') {
      spans.push({ from: t.from, to: t.to, cls: 'z-error' });
      continue;
    }
    if (t.kind === 'number') {
      spans.push({ from: t.from, to: t.to, cls: 'z-number' });
      continue;
    }
    if (t.kind === 'ident') {
      if (givenSets.has(t.value)) {
        spans.push({ from: t.from, to: t.to, cls: 'z-given', explain: 'given' });
        continue;
      }
      if (t.decoration && t.decorationFrom !== undefined) {
        const id = t.decoration === '′' ? 'prime' : t.decoration === '?' ? 'input' : 'output';
        spans.push({ from: t.from, to: t.decorationFrom, cls: `z-ident z-ident-${id}`, explain: id });
        spans.push({ from: t.decorationFrom, to: t.to, cls: `z-decoration z-deco-${id}`, explain: id });
      } else {
        spans.push({ from: t.from, to: t.to, cls: 'z-ident' });
      }
      continue;
    }
    // sym / keyword
    const sym = t.symbolId ? SYMBOL_BY_TEXT[t.value] : undefined;
    if (sym) {
      const cat: SymbolCategory = sym.category;
      spans.push({ from: t.from, to: t.to, cls: `z-${cat}${sym.keyword ? ' z-keyword' : ''}`, explain: sym.id });
    } else if (t.value === '′') {
      spans.push({ from: t.from, to: t.to, cls: 'z-decoration', explain: 'prime' });
    } else if (t.value === '[' || t.value === ']') {
      spans.push({ from: t.from, to: t.to, cls: 'z-punct', explain: 'given' });
    } else if (t.value === '|' || t.value === '{' || t.value === '}') {
      spans.push({ from: t.from, to: t.to, cls: 'z-set z-punct' });
    } else {
      spans.push({ from: t.from, to: t.to, cls: 'z-punct' });
    }
  }
  return spans;
}
