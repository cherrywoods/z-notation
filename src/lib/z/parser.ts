// Recursive-descent parser for the tutorial's Z subset (see docs/design.md, "Z language
// scope"). Three entry points match the three kinds of editor sections:
//
//   parseGiven  "[NAME, DATE]"                       → given-set names
//   parseDecls  one declaration per line (or ';')    → Decl[]
//   parsePreds  one predicate per line (= conjunction) → Term[]
//
// A section is first split into *items* (one declaration / one predicate each) using
// the line-continuation rule below, then every item is parsed on its own, so one
// syntax error never hides the other lines. Diagnostics carry offsets relative to the
// section text; the caller adds the `section`.
//
// Precedence, lowest → highest:
//   ∀ ∃ (body extends as far right as possible) < ⇔ < ⇒ (right) < ∨ < ∧ < ¬
//   < relations = ≠ ∈ ∉ ⊆ ⊂ < ≤ > ≥ (non-assoc) < ↔ ⇸ → (right) < × (n-ary) < ↦
//   < .. < + - ∪ ∖ < * div mod ∩ < prefix dom ran ℙ # - < application < atoms
//
// ⊕, ◁ and ⩤ are deliberately out of scope (friendly error, like ⦇ ⦈ or ⤔).

import type { BinOp, Decl, GivenSetsDecl, RelOp, Span, Term, UnOp, VarDecl } from './ast';
import { lex, type Token } from './lexer';

/** A syntax diagnostic; the caller adds the section it belongs to. */
export interface ParseDiagnostic {
  from: number;
  to: number;
  severity: 'error';
  kind: 'syntax';
  message: string;
}

/** Thrown inside the parser and caught per item. */
class ParseError extends Error {
  constructor(
    readonly from: number,
    readonly to: number,
    message: string,
    /** The error is an unclosed bracket at the end of the item (triggers line re-splitting). */
    readonly unclosed = false,
  ) {
    super(message);
  }
}

// ── operator tables ────────────────────────────────────────────────────────────

const REL_OPS = new Set<string>(['=', '≠', '∈', '∉', '⊆', '⊂', '<', '≤', '>', '≥']);
const ARROWS = new Set<string>(['↔', '⇸', '→']);
const ADD_OPS = new Set<string>(['+', '-', '∪', '∖']);
const MUL_OPS = new Set<string>(['*', 'div', 'mod', '∩']);
const PREFIX_OPS = new Set<string>(['dom', 'ran', 'ℙ', '#', '-']);
const LOGIC_INFIX = new Set<string>(['∧', '∨', '⇒', '⇔']);

/** All infix operators. */
export const INFIX_OPS: ReadonlySet<string> = new Set<string>([
  ...LOGIC_INFIX,
  ...REL_OPS,
  ...ARROWS,
  '×',
  '↦',
  '..',
  ...ADD_OPS,
  ...MUL_OPS,
]);

const CLOSERS: Record<string, string> = { '(': ')', '{': '}', '[': ']' };

/** A line ending with one of these continues on the next line. */
const ENDS_OPEN = new Set<string>([
  ...INFIX_OPS,
  ...Object.keys(CLOSERS),
  ',', '•', '|', ':', ';', '¬', 'dom', 'ran', 'ℙ', '#', '∀', '∃', 'Δ', 'Ξ',
]);
/** A line starting with one of these continues the previous line. ('-' is excluded: it may be a unary minus.) */
const STARTS_CONT = new Set<string>([
  ...[...INFIX_OPS].filter((o) => o !== '-'),
  ...Object.values(CLOSERS),
  '•', '|', ',', ':',
]);

/** Out-of-scope symbols with a friendly explanation. */
const OUT_OF_SCOPE: Record<string, string> = {
  '⦇': '‘⦇ ⦈’ (relational image) is not part of this tutorial — use a set comprehension, e.g. { y : Y | (x ↦ y) ∈ R }',
  '⦈': '‘⦇ ⦈’ (relational image) is not part of this tutorial — use a set comprehension, e.g. { y : Y | (x ↦ y) ∈ R }',
  '⤔': '‘⤔’ (partial injection) is not part of this tutorial — use ‘⇸’',
  '↣': '‘↣’ (total injection) is not part of this tutorial — use ‘→’',
  '↠': '‘↠’ (surjection) is not part of this tutorial — use ‘→’',
  '⤖': '‘⤖’ (bijection) is not part of this tutorial — use ‘→’',
  '⟨': 'Sequences (‘seq’, ‘⟨ ⟩’) are not part of this tutorial',
  '⟩': 'Sequences (‘seq’, ‘⟨ ⟩’) are not part of this tutorial',
  '⁀': 'Sequences (‘⁀’) are not part of this tutorial',
  '≙': 'Schema definitions with ‘≙’ are not part of this tutorial — use the schema boxes',
  '⨾': 'Relational composition ‘⨾’ is not part of this tutorial — use ∃, e.g. ∃ y : Y • (x ↦ y) ∈ R ∧ (y ↦ z) ∈ S',
  '∘': 'Relational composition ‘∘’ is not part of this tutorial — use ∃, e.g. ∃ y : Y • (x ↦ y) ∈ R ∧ (y ↦ z) ∈ S',
  '∼': 'Relational inverse ‘∼’ is not part of this tutorial — swap the pair instead, e.g. (y ↦ x) ∈ R',
  '˜': 'Relational inverse ‘˜’ is not part of this tutorial — swap the pair instead, e.g. (y ↦ x) ∈ R',
  '⁺': 'Transitive closure is not part of this tutorial',
  '⋃': 'Generalised union ‘⋃’ is not part of this tutorial — use a set comprehension with ∃',
  '⋂': 'Generalised intersection ‘⋂’ is not part of this tutorial — use a set comprehension with ∀',
  '▷': 'Range restriction ‘▷’ is not part of this tutorial — use a set comprehension',
  '⩥': 'Range subtraction ‘⩥’ is not part of this tutorial — use a set comprehension',
  '𝔽': 'Finite sets ‘𝔽’ are not part of this tutorial — use ‘ℙ’',
  '≡': 'Write ‘⇔’ for “if and only if” or ‘=’ for equality',
  '≔': 'Z has no assignment — describe the after-state instead, e.g. ‘x′ = x + 1’',
  '&': 'Write ‘∧’ for “and”',
  '/': 'Division ‘/’ is not part of this tutorial — use ‘div’ (division of whole numbers)',
  '⊕': '‘⊕’ (override) is not part of this tutorial — use ∪ and ∖ instead',
  '⤀': '‘⤀’ (partial surjection) is not part of this tutorial — use ‘⇸’',
  '⇻': '‘⇻’ (finite function) is not part of this tutorial — use ‘⇸’',
  '⤕': '‘⤕’ (finite injection) is not part of this tutorial — use ‘⇸’',
  '⇀': 'Write ‘⇸’ for a partial function',
  '⟶': 'Write ‘→’ for a total function',
  '⟷': 'Write ‘↔’ for a relation',
  '⁻': 'Relational inverse (‘⁻¹’, ‘∼’) is not part of this tutorial — swap the pair instead, e.g. (y ↦ x) ∈ R',
  'ℝ': '‘ℝ’ (real numbers) is not part of this tutorial — use ℤ (whole numbers)',
  '⩤': '‘⩤’ (domain subtraction) is not part of this tutorial — use ∖ or a set comprehension instead',
  '◁': '‘◁’ (domain restriction) is not part of this tutorial — use a set comprehension instead',
};

/** Identifiers (lexed as letters) that start out-of-scope constructs. */
const OUT_OF_SCOPE_IDENT_PREFIX: [string, string][] = [
  ['θ', '‘θ’ (theta) is not part of this tutorial'],
  ['λ', '‘λ’ (lambda) is not part of this tutorial — use a set comprehension, e.g. { x : X • (x ↦ e) }'],
  ['μ', '‘μ’ (definite description) is not part of this tutorial — use ∃ or a function'],
];

/** Words of out-of-scope constructs (treated as reserved). */
const OUT_OF_SCOPE_WORDS: Record<string, string> = {
  if: '‘if … then … else’ is not part of this tutorial — write two implications: P ⇒ … and ¬ P ⇒ …',
  then: '‘if … then … else’ is not part of this tutorial — write two implications: P ⇒ … and ¬ P ⇒ …',
  else: '‘if … then … else’ is not part of this tutorial — write two implications: P ⇒ … and ¬ P ⇒ …',
  let: '‘let’ is not part of this tutorial — write the expression out where it is used',
};

/** The arrow blocks of Unicode: an unknown arrow is one of the Z arrows we leave out. */
const isArrow = (cp: string) => {
  const c = cp.codePointAt(0) ?? 0;
  return (c >= 0x2190 && c <= 0x21ff) || (c >= 0x27f0 && c <= 0x27ff) || (c >= 0x2900 && c <= 0x297f) || (c >= 0x2b00 && c <= 0x2bff);
};

/** ASCII spellings of the arrows left out (longest first). */
const ASCII_ARROWS: [string, string][] = [
  ['>->>', '⤖'],
  ['+->>', '⤀'],
  ['-->>', '↠'],
  ['>-|>', '⤔'],
  ['>->', '↣'],
  ['>+>', '⤔'],
  ['->>', '↠'],
];

const WHOLE_NUMBERS = 'Only whole numbers are part of this tutorial.';
const TOO_LARGE = 'Numbers this large are not supported here.';

const q = (s: string) => `‘${s}’`;

/** Operator value of a symbol/keyword token, else null. */
function opv(t: Token | undefined): string | null {
  return t && (t.kind === 'sym' || t.kind === 'keyword') ? t.value : null;
}

const span = (from: number, to: number): Span => ({ from, to });

// ── splitting a section into items ─────────────────────────────────────────────

type Line = Token[];

/**
 * Split tokens into lines at newlines (and, for declarations, at ';' outside brackets).
 * Empty lines are kept (as empty arrays) because they end an item.
 */
function splitLines(toks: Token[], semicolons: boolean): Line[] {
  const lines: Line[] = [];
  let cur: Line = [];
  let depth = 0;
  for (const t of toks) {
    if (t.kind === 'eof') break;
    if (t.kind === 'newline') {
      lines.push(cur);
      cur = [];
      continue;
    }
    const v = opv(t);
    if (semicolons && v === ';' && depth === 0) {
      lines.push(cur);
      cur = [];
      continue;
    }
    if (v && v in CLOSERS) depth++;
    else if (v === ')' || v === '}' || v === ']') depth = Math.max(0, depth - 1);
    cur.push(t);
  }
  lines.push(cur);
  return lines;
}

function bracketDepth(line: Line, depth: number): number {
  for (const t of line) {
    const v = opv(t);
    if (v && v in CLOSERS) depth++;
    else if (v === ')' || v === '}' || v === ']') depth = Math.max(0, depth - 1);
  }
  return depth;
}

/**
 * Group lines into items. A line continues the previous item if brackets are still
 * open (`useDepth`), if the previous line ends with an infix operator, ',', an opening
 * bracket, '•', '|', …, or if the line starts with an infix operator.
 * An empty line always ends the item.
 */
function chunkLines(lines: Line[], useDepth: boolean): Line[][] {
  const chunks: Line[][] = [];
  let cur: Line[] | null = null;
  let depth = 0;
  for (const line of lines) {
    if (line.length === 0) {
      if (cur) chunks.push(cur);
      cur = null;
      depth = 0;
      continue;
    }
    if (cur) {
      const last = cur[cur.length - 1];
      const lastTok = last[last.length - 1];
      const cont =
        (useDepth && depth > 0) ||
        ENDS_OPEN.has(opv(lastTok) ?? '') ||
        STARTS_CONT.has(opv(line[0]) ?? '');
      if (!cont) {
        chunks.push(cur);
        cur = null;
        depth = 0;
      }
    }
    if (!cur) cur = [];
    cur.push(line);
    depth = bracketDepth(line, depth);
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Report out-of-scope constructs and common typos before parsing an item. */
function prescan(toks: Token[], text: string): void {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const prev = toks[i - 1];
    const next = toks[i + 1];
    if (t.kind === 'number') {
      if (t.value.includes('.')) throw new ParseError(t.from, t.to, WHOLE_NUMBERS);
      if (!Number.isSafeInteger(Number(t.value))) throw new ParseError(t.from, t.to, TOO_LARGE);
    }
    if (t.kind === 'error') {
      const cp = String.fromCodePoint(text.codePointAt(t.from) ?? 0xfffd);
      // a stray decimal point: `.5` or `1.`
      if (cp === '.' && ((next?.kind === 'number' && next.from === t.to) || (prev?.kind === 'number' && prev.to === t.from))) {
        throw new ParseError(t.from, t.to, WHOLE_NUMBERS);
      }
      // ℙ₁ and ∃₁ (the subscript is not part of the symbol)
      if (cp === '₁' && prev && prev.to === t.from && (prev.value === 'ℙ' || prev.value === '∃')) {
        throw new ParseError(
          prev.from,
          t.to,
          prev.value === 'ℙ'
            ? '‘ℙ₁’ (non-empty subsets) is not part of this tutorial — use ℙ and add ‘S ≠ ∅’'
            : '‘∃₁’ (exactly one) is not part of this tutorial — use ∃ and say that any two such values are equal',
        );
      }
      throw new ParseError(t.from, t.from + cp.length, unknownSymbolMessage(cp));
    }
    if (t.kind === 'ident' && !t.decoration) {
      for (const [prefix, msg] of OUT_OF_SCOPE_IDENT_PREFIX) {
        if (t.value.startsWith(prefix)) throw new ParseError(t.from, t.to, msg);
      }
      const word = OUT_OF_SCOPE_WORDS[t.value];
      if (word) throw new ParseError(t.from, t.to, word);
    }
    const v = opv(t);
    const n = toks[i + 1];
    const n2 = toks[i + 2];
    const adj = (a: Token, b: Token | undefined) => !!b && a.to === b.from;
    if (v === ':' && opv(n) === ':' && adj(t, n) && opv(n2) === '=' && adj(n, n2)) {
      throw new ParseError(t.from, n2.to, 'Free types (‘::=’) are not part of this tutorial — use a given set instead');
    }
    if (v === ':' && opv(n) === '=' && adj(t, n)) {
      throw new ParseError(t.from, n.to, 'Z has no assignment ‘:=’ — describe the after-state instead, e.g. ‘x′ = x + 1’');
    }
    if (v === '=' && opv(n) === '=' && adj(t, n)) {
      throw new ParseError(t.from, n.to, 'Write a single ‘=’ for equality (abbreviations with ‘==’ are not part of this tutorial)');
    }
    if (v === '!' && opv(n) === '=' && adj(t, n)) {
      throw new ParseError(t.from, n.to, 'Write ‘≠’ (or ‘/=’) for “not equal”');
    }
    if (v === '|' && opv(n) === '|' && adj(t, n)) {
      throw new ParseError(t.from, n.to, 'Write ‘∨’ for “or”');
    }
    // ASCII spellings of the out-of-scope arrows (>->, ->>, …), ⊕ (++), ◁ (<|) and ⩤ (<<|)
    if ((t.kind === 'sym' || t.kind === 'keyword') && !(prev && prev.to === t.from && (prev.kind === 'sym' || prev.kind === 'keyword'))) {
      const hit = ASCII_ARROWS.find(([a]) => text.startsWith(a, t.from));
      if (hit) throw new ParseError(t.from, t.from + hit[0].length, OUT_OF_SCOPE[hit[1]]);
    }
    if (v === '+' && opv(n) === '+' && adj(t, n)) throw new ParseError(t.from, n.to, OUT_OF_SCOPE['⊕']);
    if (v === '<' && opv(n) === '|' && adj(t, n)) throw new ParseError(t.from, n.to, OUT_OF_SCOPE['◁']);
    if (v === '<' && opv(n) === '<' && opv(n2) === '|' && adj(t, n) && adj(n, n2)) {
      throw new ParseError(t.from, n2.to, OUT_OF_SCOPE['⩤']);
    }
  }
}

function unknownSymbolMessage(cp: string): string {
  if (OUT_OF_SCOPE[cp]) return OUT_OF_SCOPE[cp];
  if (isArrow(cp)) return `${q(cp)} is not part of this tutorial — use ⇸, → or ↔`;
  return `Unknown symbol ${q(cp)}`;
}

interface Item<T> {
  node: T | null;
  /** Source range of the whole item (all its lines). */
  span: Span;
}

function parseItems<T>(
  text: string,
  semicolons: boolean,
  parseOne: (p: Parser) => T,
): { items: Item<T>[]; diagnostics: ParseDiagnostic[] } {
  const items: Item<T>[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  const report = (e: ParseError) =>
    diagnostics.push({ from: e.from, to: Math.max(e.to, e.from), severity: 'error', kind: 'syntax', message: e.message });

  const runChunk = (chunk: Line[]): Item<T> => {
    const toks = chunk.flat();
    const sp = span(toks[0].from, toks[toks.length - 1].to);
    toks.push({ kind: 'eof', value: '', from: sp.to, to: sp.to });
    prescan(toks, text);
    const p = new Parser(toks);
    const node = parseOne(p);
    return { node, span: sp };
  };
  const chunkSpan = (chunk: Line[]): Span => {
    const toks = chunk.flat();
    return span(toks[0].from, toks[toks.length - 1].to);
  };

  for (const chunk of chunkLines(splitLines(lex(text), semicolons), true)) {
    try {
      items.push(runChunk(chunk));
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      // An unclosed bracket swallowed the following lines: re-split without bracket
      // tracking so that the lines after the broken one are still parsed.
      if (chunk.length > 1 && (e.unclosed || chunk.reduce((d, l) => bracketDepth(l, d), 0) > 0)) {
        const sub = chunkLines(chunk, false);
        if (sub.length > 1) {
          for (const c of sub) {
            try {
              items.push(runChunk(c));
            } catch (e2) {
              if (!(e2 instanceof ParseError)) throw e2;
              report(e2);
              items.push({ node: null, span: chunkSpan(c) });
            }
          }
          continue;
        }
      }
      report(e);
      items.push({ node: null, span: chunkSpan(chunk) });
    }
  }
  return { items, diagnostics };
}

// ── the parser proper ──────────────────────────────────────────────────────────

type Mode = 'pred' | 'decl' | 'term';

class Parser {
  private pos = 0;
  constructor(private readonly toks: Token[]) {}

  // token helpers
  private peek(o = 0): Token {
    return this.toks[Math.min(this.pos + o, this.toks.length - 1)];
  }
  private next(): Token {
    const t = this.peek();
    if (t.kind !== 'eof') this.pos++;
    return t;
  }
  private isOp(v: string, o = 0): boolean {
    return opv(this.peek(o)) === v;
  }
  private prevTok(): Token | undefined {
    return this.pos > 0 ? this.toks[this.pos - 1] : undefined;
  }
  /** End offset of the last consumed token. */
  private end(): number {
    return this.prevTok()?.to ?? this.peek().from;
  }
  private fail(t: Token, message: string): never {
    throw new ParseError(t.from, t.to, message);
  }
  private atEnd(): boolean {
    return this.peek().kind === 'eof';
  }

  // ── items ────────────────────────────────────────────────────────────────

  /** A whole predicate item; everything must be consumed. */
  predicateItem(mode: Mode): Term {
    const t = this.pred();
    this.expectEnd(mode);
    return t;
  }

  /** One line of a schema's declaration part. */
  declItem(): Decl {
    const t = this.peek();
    const v = opv(t);
    if (v === 'Δ' || v === 'Ξ') {
      this.next();
      const n = this.peek();
      if (n.kind !== 'ident') {
        this.fail(n.kind === 'eof' ? t : n, `Expected the state schema name after ${q(v)}, e.g. ${q(v + 'State')}`);
      }
      if (n.decoration) this.fail(n, `Write ${q(v + n.base)} without ${q(n.decoration)}`);
      this.next();
      if (!this.atEnd()) this.fail(this.peek(), `Only the state schema name follows ${q(v)}`);
      return { kind: v === 'Δ' ? 'delta' : 'xi', schema: n.value, span: span(t.from, n.to) };
    }
    if (t.kind === 'ident' && this.peek(1).kind === 'eof') {
      if (t.decoration === '?' || t.decoration === '!') {
        this.fail(t, `Expected ‘:’ and a type after ${q(t.value)}, e.g. ${q(t.value + ' : NAME')}`);
      }
      return { kind: 'include', schema: t.value, span: span(t.from, t.to) };
    }
    const op = opv(this.peek(1));
    if (t.kind === 'ident' && op && LOGIC_INFIX.has(op)) {
      const n2 = this.peek(2);
      if (/^[A-ZΔΞ]/.test(t.value) && (n2.kind === 'ident' || opv(n2) === 'Δ' || opv(n2) === 'Ξ')) {
        this.fail(this.peek(1), `Combining schemas with ${q(op)} (schema calculus) is not part of this tutorial`);
      }
    }
    const d = this.varDecl(true);
    this.expectEnd('decl');
    return d;
  }

  // ── predicates ───────────────────────────────────────────────────────────

  private pred(): Term {
    return this.iff();
  }

  private iff(): Term {
    let left = this.impl();
    while (this.isOp('⇔')) {
      this.next();
      const right = this.impl();
      left = { kind: 'logic', op: '⇔', left, right, span: span(left.span.from, right.span.to) };
    }
    return left;
  }

  private impl(): Term {
    const left = this.or();
    if (this.isOp('⇒')) {
      this.next();
      const right = this.impl(); // right-associative
      return { kind: 'logic', op: '⇒', left, right, span: span(left.span.from, right.span.to) };
    }
    return left;
  }

  private or(): Term {
    let left = this.and();
    while (this.isOp('∨')) {
      this.next();
      const right = this.and();
      left = { kind: 'logic', op: '∨', left, right, span: span(left.span.from, right.span.to) };
    }
    return left;
  }

  private and(): Term {
    let left = this.not();
    while (this.isOp('∧')) {
      this.next();
      const right = this.not();
      left = { kind: 'logic', op: '∧', left, right, span: span(left.span.from, right.span.to) };
    }
    return left;
  }

  /** ¬ and quantifiers. A quantifier here extends as far right as possible. */
  private not(): Term {
    const t = this.peek();
    if (this.isOp('¬')) {
      this.next();
      const arg = this.not();
      return { kind: 'not', arg, span: span(t.from, arg.span.to) };
    }
    if (this.isOp('∀') || this.isOp('∃')) return this.quant();
    return this.rel();
  }

  private quant(): Term {
    const qt = this.next();
    const qv = qt.value as '∀' | '∃';
    if (this.peek().kind !== 'ident') {
      this.fail(this.atEnd() ? qt : this.peek(), `Expected a variable after ${q(qv)}, e.g. ${q(qv + ' x : S • …')}`);
    }
    const decls = this.declList();
    let pred: Term | undefined;
    if (this.isOp('|')) {
      this.next();
      pred = this.pred();
    }
    if (!this.isOp('•')) {
      const t = this.peek();
      if (t.kind === 'eof') {
        this.fail(this.prevTok() ?? qt, `Expected ‘•’ and a predicate, e.g. ${q(qv + ' x : S • P')}`);
      }
      this.fail(t, `Expected ‘•’ before ${q(t.value)}`);
    }
    this.next();
    const body = this.pred();
    return { kind: 'quant', q: qv, decls, pred, body, span: span(qt.from, body.span.to) };
  }

  private rel(): Term {
    const left = this.expr();
    const opTok = this.peek();
    const op = opv(opTok);
    if (op && REL_OPS.has(op)) {
      this.next();
      const right = this.expr();
      const op2 = opv(this.peek());
      if (op2 && REL_OPS.has(op2)) {
        this.fail(this.peek(), `Chains like ‘a ${op} b ${op2} c’ are not allowed — write ‘a ${op} b ∧ b ${op2} c’`);
      }
      return { kind: 'rel', op: op as RelOp, left, right, span: span(left.span.from, right.span.to) };
    }
    return left;
  }

  // ── expressions ──────────────────────────────────────────────────────────

  /** Expression (arrow level and above). */
  private expr(): Term {
    return this.arrow();
  }

  private arrow(): Term {
    const left = this.cross();
    const op = opv(this.peek());
    if (op && ARROWS.has(op)) {
      this.next();
      const right = this.arrow(); // right-associative
      return { kind: 'binop', op: op as BinOp, left, right, span: span(left.span.from, right.span.to) };
    }
    return left;
  }

  private cross(): Term {
    const first = this.maplet();
    if (!this.isOp('×')) return first;
    const elems = [first];
    while (this.isOp('×')) {
      this.next();
      elems.push(this.maplet());
    }
    return { kind: 'cross', elems, span: span(first.span.from, elems[elems.length - 1].span.to) };
  }

  private leftAssoc(ops: ReadonlySet<string>, operand: () => Term): Term {
    let left = operand();
    for (;;) {
      const op = opv(this.peek());
      if (!op || !ops.has(op)) return left;
      this.next();
      const right = operand();
      left = { kind: 'binop', op: op as BinOp, left, right, span: span(left.span.from, right.span.to) };
    }
  }

  private maplet(): Term {
    return this.leftAssoc(new Set(['↦']), () => this.range());
  }

  private range(): Term {
    const left = this.add();
    if (!this.isOp('..')) return left;
    this.next();
    const right = this.add();
    if (this.isOp('..')) this.fail(this.peek(), 'A range has only two ends, like ‘1 .. 10’');
    return { kind: 'binop', op: '..', left, right, span: span(left.span.from, right.span.to) };
  }

  private add(): Term {
    return this.leftAssoc(ADD_OPS, () => this.mul());
  }
  private mul(): Term {
    return this.leftAssoc(MUL_OPS, () => this.prefix());
  }

  /** dom ran ℙ # - : the operand is again a prefix term or an application. */
  private prefix(): Term {
    const t = this.peek();
    const op = opv(t);
    if (op && PREFIX_OPS.has(op)) {
      this.next();
      // A minus directly in front of a number literal is a negative number.
      if (op === '-' && this.peek().kind === 'number') {
        const n = this.next();
        return { kind: 'num', value: -Number(n.value), span: span(t.from, n.to) };
      }
      if (this.atEnd()) this.fail(t, `Expected something after ${q(op)}`);
      const arg = this.prefix();
      const uop: UnOp = op === '-' ? 'neg' : (op as UnOp);
      return { kind: 'unop', op: uop, arg, span: span(t.from, arg.span.to) };
    }
    return this.app();
  }

  /** Function application: `f(x)` and juxtaposition `f x` (left-associative). */
  private app(): Term {
    let f = this.atom();
    for (;;) {
      if (!applicable(f)) return f;
      const t = this.peek();
      const v = opv(t);
      const startsArg =
        t.kind === 'ident' || t.kind === 'number' || v === '(' || v === '{' || v === '∅';
      if (!startsArg) return f;
      const arg = this.atom();
      f = { kind: 'apply', fn: f, arg, span: span(f.span.from, arg.span.to) };
    }
  }

  private atom(): Term {
    const t = this.peek();
    if (t.kind === 'ident') {
      this.next();
      if (!t.decoration && (t.value === 'true' || t.value === 'false')) {
        return { kind: 'bool', value: t.value === 'true', span: span(t.from, t.to) };
      }
      return { kind: 'name', name: t.value, base: t.base ?? t.value, decoration: t.decoration ?? '', span: span(t.from, t.to) };
    }
    if (t.kind === 'number') {
      this.next();
      return { kind: 'num', value: Number(t.value), span: span(t.from, t.to) };
    }
    if (t.kind === 'eof') this.failAfterPrev();
    const v = t.value;
    switch (v) {
      case 'ℕ':
      case 'ℕ₁':
      case 'ℤ':
        this.next();
        return { kind: 'builtinSet', set: v, span: span(t.from, t.to) };
      case '∅':
        this.next();
        return { kind: 'emptyset', span: span(t.from, t.to) };
      case '(':
        return this.paren();
      case '{':
        return this.brace();
    }
    return this.failUnexpectedAtom(t);
  }

  private paren(): Term {
    const open = this.next();
    if (this.isOp(')')) this.fail(this.peek(), 'Empty parentheses ‘( )’ — something is missing inside');
    const first = this.pred();
    if (this.isOp(',')) {
      const elems = [first];
      while (this.isOp(',')) {
        this.next();
        elems.push(this.pred());
      }
      this.expectClose(open, ')');
      return { kind: 'tuple', elems, span: span(open.from, this.end()) };
    }
    this.expectClose(open, ')');
    // The span of a parenthesised term includes its parentheses.
    return { ...first, span: span(open.from, this.end()) };
  }

  /** `{}` / set display `{a, b}` / set comprehension `{ x : S | P • e }`. */
  private brace(): Term {
    const open = this.next();
    if (this.isOp('}')) {
      const close = this.next();
      return { kind: 'emptyset', span: span(open.from, close.to) };
    }
    // Comprehension if the braces start with a declaration `x, y : S` or `x ∈ S`.
    // With ':' this is certain; with '∈' it is only a comprehension if '|' or '•' follows
    // the declarations (otherwise `{x ∈ S}` is a set display), so we may backtrack.
    let k = 0;
    while (this.peek(k).kind === 'ident' && this.isOp(',', k + 1)) k += 2;
    if (this.peek(k).kind === 'ident') {
      const sep = opv(this.peek(k + 1));
      if (sep === ':') return this.comprehension(open);
      if (sep === '∈') {
        const save = this.pos;
        let decls: VarDecl[] | null = null;
        try {
          decls = this.declList();
        } catch (e) {
          if (!(e instanceof ParseError)) throw e;
        }
        if (decls && (this.isOp('|') || this.isOp('•'))) return this.comprehensionRest(open, decls);
        this.pos = save;
      }
    }
    const elems: Term[] = [this.pred()];
    while (this.isOp(',')) {
      this.next();
      elems.push(this.pred());
    }
    this.expectClose(open, '}');
    return { kind: 'setDisplay', elems, span: span(open.from, this.end()) };
  }

  private comprehension(open: Token): Term {
    return this.comprehensionRest(open, this.declList());
  }

  private comprehensionRest(open: Token, decls: VarDecl[]): Term {
    let pred: Term | undefined;
    let expr: Term | undefined;
    if (this.isOp('|')) {
      this.next();
      pred = this.pred();
    }
    if (this.isOp('•')) {
      this.next();
      expr = this.pred();
    }
    if (!this.isOp('}') && !this.atEnd()) {
      const t = this.peek();
      if (!pred && !expr) this.fail(t, `Expected ‘|’, ‘•’ or ‘}’ before ${q(t.value)}`);
    }
    this.expectClose(open, '}');
    return { kind: 'setComp', decls, pred, expr, span: span(open.from, this.end()) };
  }

  /** `x, y : S; z ∈ T` (in quantifiers and comprehensions). */
  private declList(): VarDecl[] {
    const decls = [this.varDecl(false)];
    while (this.isOp(';')) {
      this.next();
      decls.push(this.varDecl(false));
    }
    return decls;
  }

  /**
   * `x, y : T`. In a schema's declaration part (`schemaPart`) only ':' is allowed;
   * in quantifiers and comprehensions `x ∈ S` is accepted as well.
   */
  private varDecl(schemaPart: boolean): VarDecl {
    const first = this.peek();
    if (first.kind !== 'ident') {
      if (schemaPart) this.fail(first, 'Expected a declaration such as ‘x : T’ (predicates go below the line)');
      const prev = this.prevTok();
      this.fail(first.kind === 'eof' && prev ? prev : first, `Expected a variable name${prev ? ` after ${q(prev.value)}` : ''}`);
    }
    const names: VarDecl['names'] = [];
    const pushName = (t: Token) =>
      names.push({ name: t.value, base: t.base ?? t.value, decoration: t.decoration ?? '', span: span(t.from, t.to) });
    pushName(this.next());
    while (this.isOp(',')) {
      const comma = this.next();
      const n = this.peek();
      if (n.kind !== 'ident') this.fail(n.kind === 'eof' ? comma : n, 'Expected a variable name after ‘,’');
      pushName(this.next());
    }
    const lastName = names[names.length - 1].name;
    const sepTok = this.peek();
    const sv = opv(sepTok);
    let sep: ':' | '∈';
    if (sv === ':' || (!schemaPart && sv === '∈')) {
      sep = sv;
      this.next();
    } else if (schemaPart && sv === '∈') {
      this.fail(sepTok, `In a declaration, write ‘:’ instead of ‘∈’, e.g. ${q(lastName + ' : …')}`);
    } else if (schemaPart && sv && (REL_OPS.has(sv) || INFIX_OPS.has(sv))) {
      this.fail(sepTok, 'This looks like a predicate — predicates go below the line. A declaration looks like ‘x : T’.');
    } else if (sepTok.kind === 'eof') {
      this.fail(this.prevTok() ?? sepTok, `Expected ‘:’ and a type after ${q(lastName)}`);
    } else {
      this.fail(sepTok, `Expected ${schemaPart ? '‘:’' : '‘:’ or ‘∈’'} after ${q(lastName)}`);
    }
    if (this.atEnd() || this.isOp(';') || this.isOp('|') || this.isOp('•')) {
      this.fail(sepTok, `Expected a type after ${q(sep)}`);
    }
    const type = this.expr();
    return { kind: 'var', names, type, sep, span: span(first.from, type.span.to) };
  }

  // ── errors ───────────────────────────────────────────────────────────────

  private expectClose(open: Token, closer: string): void {
    if (this.isOp(closer)) {
      this.next();
      return;
    }
    const t = this.peek();
    if (t.kind === 'eof') {
      throw new ParseError(open.from, open.to, `Missing ${q(closer)} to close this ${q(open.value)}`, true);
    }
    const v = opv(t);
    if (v && Object.values(CLOSERS).includes(v)) {
      this.fail(t, `Expected ${q(closer)} here (to close the ${q(open.value)}), not ${q(v)}`);
    }
    this.fail(t, `Expected ${q(closer)} before ${q(t.value)}`);
  }

  /** An atom was expected but the item ended. */
  private failAfterPrev(): never {
    const prev = this.prevTok();
    if (!prev) throw new ParseError(this.peek().from, this.peek().to, 'Expected a predicate');
    if (prev.value === ':') this.fail(prev, 'Expected a type after ‘:’');
    if (prev.value === '•') this.fail(prev, 'Expected something after ‘•’');
    this.fail(prev, `Expected something after ${q(prev.value)}`);
  }

  private failUnexpectedAtom(t: Token): never {
    const v = t.value;
    const prev = this.prevTok();
    if (INFIX_OPS.has(v) || v === '..') {
      const pv = opv(prev);
      if (prev && pv && (INFIX_OPS.has(pv) || PREFIX_OPS.has(pv) || pv in CLOSERS || pv === ',')) {
        this.fail(t, `Expected something between ${q(pv)} and ${q(v)}`);
      }
      this.fail(t, `Expected something before ${q(v)}`);
    }
    if (v === ')' || v === '}' || v === ']' || v === ',' || v === '|' || v === '•' || v === ';') {
      if (prev) this.fail(prev, `Expected something after ${q(prev.value)}`);
      this.fail(t, `Unexpected ${q(v)}`);
    }
    if (v === '∀' || v === '∃' || v === '¬') this.fail(t, `Put the ${q(v)} part in parentheses here: (${v} …)`);
    return this.failCommon(t);
  }

  /** Messages shared by "unexpected token" situations. */
  private failCommon(t: Token): never {
    const v = t.value;
    if (v === 'Δ' || v === 'Ξ') this.fail(t, `${q(v + 'State')} belongs in the declarations (above the line)`);
    if (v === '?' || v === '!' || v === '′') {
      const prev = this.prevTok();
      if (prev?.kind === 'ident' && prev.decoration && prev.to === t.from) {
        this.fail(t, 'A name can have only one decoration (′, ? or !)');
      }
      this.fail(t, `Write ${q(v)} directly after the name, without a space (e.g. ${q('x' + v)})`);
    }
    if (v === '[') this.fail(t, 'Square brackets are only for given sets like [NAME, DATE] — use ( ) here');
    if (v === ':') this.fail(t, 'Declarations like ‘x : T’ go above the line (or after ∀ / ∃)');
    if (v === 'div' || v === 'mod') this.fail(t, `Expected something before ${q(v)}`);
    this.fail(t, `Unexpected ${q(v)}`);
  }

  /** The item must be fully consumed. */
  private expectEnd(mode: Mode): void {
    const t = this.peek();
    if (t.kind === 'eof') return;
    const v = opv(t);
    if (t.kind === 'ident' || t.kind === 'number' || v === '(' || v === '{' || v === '∅' || v === 'ℕ' || v === 'ℤ' || v === 'ℕ₁') {
      this.fail(t, `Missing operator before ${q(t.value)}`);
    }
    if (v === ')' || v === '}' || v === ']') this.fail(t, `Unexpected ${q(v)} — there is no matching opening bracket`);
    if (v === ',') {
      // `x = 1,5`: a decimal comma (written without spaces)
      const prev = this.prevTok();
      const next = this.peek(1);
      if (prev?.kind === 'number' && prev.to === t.from && next.kind === 'number' && next.from === t.to) {
        throw new ParseError(prev.from, next.to, WHOLE_NUMBERS);
      }
      if (mode === 'pred') this.fail(t, 'Unexpected ‘,’ — put each predicate on its own line (or join them with ‘∧’)');
      this.fail(t, 'Unexpected ‘,’');
    }
    if (mode === 'decl' && v && (REL_OPS.has(v) || LOGIC_INFIX.has(v))) {
      this.fail(t, 'Predicates go below the line — above it, only declarations like ‘x : T’');
    }
    if (v === '•') this.fail(t, 'Unexpected ‘•’ — it is used after ∀ x : S or in { x : S • … }');
    if (v === '|') this.fail(t, 'Unexpected ‘|’ — it is used in { x : S | … } and after ∀ x : S');
    if (v === '¬') this.fail(t, 'Missing ‘∧’ or ‘∨’ before ‘¬’');
    if (v === '∀' || v === '∃') this.fail(t, `Missing ‘∧’ or ‘⇒’ before ${q(v)}`);
    return this.failCommon(t);
  }
}

/** Can this term be applied by juxtaposition (`f x`)? */
function applicable(f: Term): boolean {
  return !(f.kind === 'num' || f.kind === 'bool' || f.kind === 'builtinSet' || f.kind === 'emptyset' || f.kind === 'tuple');
}

// ── public API ─────────────────────────────────────────────────────────────────

export interface GivenParse {
  /** All names of all `[…]` groups, or null if there are none. */
  decl: GivenSetsDecl | null;
  names: { name: string; span: Span }[];
  diagnostics: ParseDiagnostic[];
}

/** Parse the given-set paragraph: one or more `[A, B, C]` groups, on one or several lines. */
export function parseGiven(text: string): GivenParse {
  const toks = lex(text);
  const diagnostics: ParseDiagnostic[] = [];
  const names: { name: string; span: Span }[] = [];
  const diag = (from: number, to: number, message: string) =>
    diagnostics.push({ from, to, severity: 'error', kind: 'syntax', message });
  let first = -1;
  let last = -1;
  let i = 0;
  const lineEnd = (j: number) => {
    while (toks[j].kind !== 'newline' && toks[j].kind !== 'eof') j++;
    return j;
  };

  while (toks[i].kind !== 'eof') {
    const t = toks[i];
    if (t.kind === 'newline') {
      i++;
      continue;
    }
    const end = lineEnd(i);
    const line = toks.slice(i, end);
    if (opv(t) !== '[') {
      // Something outside brackets: explain common cases, then skip the line.
      try {
        prescan([...line, { kind: 'eof', value: '', from: 0, to: 0 }], text);
        if (t.kind === 'ident') diag(t.from, t.to, `Write given sets in square brackets, e.g. [${t.base ?? t.value}]`);
        else diag(t.from, t.to, `Unexpected ${q(t.value)} — given sets are written like [NAME, DATE]`);
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        diag(e.from, e.to, e.message);
      }
      i = end;
      continue;
    }
    // A group "[A, B, C]": report problems, but keep reading names up to ']'.
    const open = t;
    if (first < 0) first = open.from;
    i++;
    let expectName = true;
    let count = 0;
    let errors = 0;
    const err = (from: number, to: number, message: string) => {
      errors++;
      diag(from, to, message);
    };
    for (;;) {
      const u = toks[i];
      const uv = opv(u);
      if (u.kind === 'newline' || u.kind === 'eof') {
        err(open.from, open.to, 'Missing ‘]’ to close this ‘[’');
        last = Math.max(last, toks[i - 1].to);
        break;
      }
      i++;
      if (u.kind === 'ident') {
        if (!expectName) err(u.from, u.to, 'Separate the names with ‘,’');
        if (u.decoration) err(u.from, u.to, `Given set names have no decoration — write ${q(u.base ?? u.value)}`);
        names.push({ name: u.base ?? u.value, span: span(u.from, u.decorationFrom ?? u.to) });
        count++;
        expectName = false;
      } else if (uv === ',') {
        if (expectName && count > 0) err(u.from, u.to, 'Expected a name between the commas');
        else if (expectName) err(u.from, u.to, 'Expected a name before ‘,’');
        expectName = true;
      } else if (uv === ']') {
        last = u.to;
        if (count === 0 && errors === 0) err(u.from, u.to, 'Write at least one name inside [ ]');
        else if (expectName && count > 0) err(u.from, u.to, 'Expected a name after ‘,’');
        break;
      } else if (uv === 'ℕ' || uv === 'ℤ' || uv === 'ℕ₁') {
        err(u.from, u.to, `${q(uv)} is built in — no need to declare it`);
        expectName = false;
      } else if (u.kind === 'error') {
        const cp = String.fromCodePoint(text.codePointAt(u.from) ?? 0xfffd);
        err(u.from, u.from + cp.length, unknownSymbolMessage(cp));
        expectName = false;
      } else {
        err(u.from, u.to, `Unexpected ${q(u.value)} — given sets are written like [NAME, DATE]`);
        expectName = false;
      }
    }
  }
  const decl = names.length > 0 ? { names, span: span(first, last >= 0 ? last : text.length) } : null;
  return { decl, names, diagnostics };
}

export interface DeclsParse {
  decls: Decl[];
  diagnostics: ParseDiagnostic[];
}

/**
 * Parse a declaration part: one declaration per line (or separated by ';'):
 * `x, y : T`, `ΔS` / `ΞS` (also `Δ S`), or a bare schema name `S` / `S′`.
 */
export function parseDecls(text: string): DeclsParse {
  const { items, diagnostics } = parseItems(text, true, (p) => p.declItem());
  const decls = items.flatMap((i) => (i.node ? [i.node] : []));
  // The tutorial (like the lecture slides) declares one variable per line. The
  // declarations are still kept, so the names do not cause follow-up errors.
  const lineOf = (pos: number) => text.slice(0, pos).split('\n').length;
  let prevLine = -1;
  for (const d of decls) {
    if (d.kind === 'var' && d.names.length > 1) {
      const type = text.slice(d.type.span.from, d.type.span.to);
      const [a, b] = d.names;
      diagnostics.push({
        from: d.names[0].span.from,
        to: d.names[d.names.length - 1].span.to,
        severity: 'error',
        kind: 'syntax',
        message: `Declare one variable per line: ‘${a.name} : ${type}’ and ‘${b.name} : ${type}’ on separate lines.`,
      });
    }
    const line = lineOf(d.span.from);
    if (line === prevLine) {
      diagnostics.push({
        from: d.span.from,
        to: d.span.to,
        severity: 'error',
        kind: 'syntax',
        message: 'Declare one variable per line: put this declaration on its own line.',
      });
    }
    prevLine = line;
  }
  return { decls, diagnostics };
}

export interface PredItem {
  /** Parsed predicate, or null if this item has a syntax error. */
  term: Term | null;
  /** Source range of the item (may span several lines). */
  span: Span;
}

/**
 * Parse a predicate part, keeping one entry per predicate even if it fails to parse
 * (so predicate indices stay stable while the student types).
 */
export function parsePredItems(text: string): { items: PredItem[]; diagnostics: ParseDiagnostic[] } {
  const { items, diagnostics } = parseItems(text, false, (p) => p.predicateItem('pred'));
  return { items: items.map((i) => ({ term: i.node, span: i.span })), diagnostics };
}

/**
 * Parse a predicate part: predicates separated by newlines (newline = conjunction).
 * A newline does not end a predicate inside brackets, after an infix operator / ',' /
 * opening bracket / '•' / '|', or before a line starting with an infix operator.
 * An empty line always ends a predicate.
 */
export function parsePreds(text: string): { preds: Term[]; diagnostics: ParseDiagnostic[] } {
  const { items, diagnostics } = parsePredItems(text);
  return { preds: items.flatMap((i) => (i.term ? [i.term] : [])), diagnostics };
}

/** Parse a single term or predicate (newlines are plain whitespace). For tests and tools. */
export function parseTerm(text: string): { term: Term | null; diagnostics: ParseDiagnostic[] } {
  const toks = lex(text).filter((t) => t.kind !== 'newline');
  try {
    if (toks.length === 1) throw new ParseError(0, text.length, 'Expected a predicate');
    prescan(toks, text);
    const term = new Parser(toks).predicateItem('term');
    return { term, diagnostics: [] };
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    return { term: null, diagnostics: [{ from: e.from, to: e.to, severity: 'error', kind: 'syntax', message: e.message }] };
  }
}
