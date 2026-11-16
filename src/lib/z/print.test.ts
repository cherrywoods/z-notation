import { describe, expect, it } from 'vitest';
import type { BinOp, RelOp, Span, Term, UnOp, VarDecl } from './ast';
import { parseDecls, parseTerm } from './parser';
import {
  freeVars,
  nameTerm,
  primeTerm,
  printDecl,
  printTerm,
  rename,
  substitute,
  termEquals,
} from './print';

const parse = (s: string): Term => {
  const r = parseTerm(s);
  if (!r.term) throw new Error(`${s}: ${r.diagnostics[0]?.message}`);
  return r.term;
};
const canon = (s: string) => printTerm(parse(s));

describe('printTerm', () => {
  it.each([
    ['dom(borrower ∪ {book? ↦ member?})', 'dom (borrower ∪ {book? ↦ member?})'],
    ['borrower book?', 'borrower(book?)'],
    ['borrower′=borrower∪{book?↦member?}', 'borrower′ = borrower ∪ {book? ↦ member?}'],
    ["onLoan' = onLoan", 'onLoan′ = onLoan'],
    ['(a ∧ b) ∧ c', 'a ∧ b ∧ c'],
    ['a ∧ (b ∧ c)', 'a ∧ (b ∧ c)'],
    ['(a ∨ b) ∧ c', '(a ∨ b) ∧ c'],
    ['a ⇒ (b ⇒ c)', 'a ⇒ b ⇒ c'],
    ['(a ⇒ b) ⇒ c', '(a ⇒ b) ⇒ c'],
    ['((x ∈ S))', 'x ∈ S'],
    ['¬ (x ∈ S)', '¬ x ∈ S'],
    ['(A ∪ B) ∩ C', '(A ∪ B) ∩ C'],
    ['A ∪ (B ∩ C)', 'A ∪ B ∩ C'],
    ['a - (b - c)', 'a - (b - c)'],
    ['(a - b) - c', 'a - b - c'],
    ['A ⇸ (B ⇸ C)', 'A ⇸ B ⇸ C'],
    ['PATIENT ⇸ (DRUG ⇸ ℕ₁)', 'PATIENT ⇸ DRUG ⇸ ℕ₁'],
    ['(A ⇸ B) ⇸ C', '(A ⇸ B) ⇸ C'],
    ['ℙ(A × B)', 'ℙ (A × B)'],
    ['# onLoan', '#onLoan'],
    ['#(dom f)', '#dom f'],
    ['dom rx(p)', 'dom (rx(p))'],
    ['rx p d', 'rx(p)(d)'],
    ['(f ∪ g) x', '(f ∪ g)(x)'],
    ['f(a, b)', 'f(a, b)'],
    ['p? ↦ d ∈ prescribed', '(p? ↦ d) ∈ prescribed'],
    ['−(overdraft a)', '-(overdraft(a))'],
    ['x - -3', 'x - -3'],
    ['{ b ∈ onLoan | borrower(b) = member? }', '{ b ∈ onLoan | borrower(b) = member? }'],
    ['{x:S|P•e}', '{ x : S | P • e }'],
    ['{}', '∅'],
    ['P ∧ ∀ x : S • Q', 'P ∧ (∀ x : S • Q)'],
    ['∀ x : S • ∃ y : T • R', '∀ x : S • ∃ y : T • R'],
    ['∀ x, y : S; z : T | x ≠ y • z ∈ U', '∀ x, y : S; z : T | x ≠ y • z ∈ U'],
    ['¬ ∃ x : S • P', '¬ (∃ x : S • P)'],
    ['1..10', '1 .. 10'],
    ['t∈ℝ', 't ∈ ℝ'],
    ['x = 0.25 + -1.5', 'x = 0.25 + -1.5'],
    ['x = 36.50', 'x = 36.5'],
    ['-(0.5)', '-(0.5)'],
    ['true ∨ false', 'true ∨ false'],
  ])('%s  ⟶  %s', (src, expected) => expect(canon(src)).toBe(expected));

  it('prints declarations', () => {
    const { decls } = parseDecls('ΔLibrary\nΞ Library\nLibrary′\nbook?, x? : BOOK\nrx : PATIENT ⇸ (DRUG ⇸ ℕ₁)');
    expect(decls.map(printDecl)).toEqual(['ΔLibrary', 'ΞLibrary', 'Library′', 'book?, x? : BOOK', 'rx : PATIENT ⇸ DRUG ⇸ ℕ₁']);
  });
});

describe('round trip: parse(print(t)) ≅ t', () => {
  const corpus = [
    'onLoan = dom borrower',
    'borrower′ = borrower ∪ {book? ↦ member?}',
    'books! = { b ∈ onLoan | borrower(b) = member? }',
    '∀ a : dom balance • balance(a) ≥ -overdraft(a)',
    '{ d ∈ DRUG | (p? ↦ d) ∈ prescribed }',
    '#{ v ∈ registered | v ∈ dom ballot } ≤ #registered',
    '∀ p : patients; d : dom (rx p) • (rx p) d ≤ maxDose d',
    '∀ u : USER; p : PERMISSION • (u ↦ p) ∈ perms ⇔ (∃ r : ROLE • (u ↦ r) ∈ ua ∧ (r ↦ p) ∈ pa)',
    'aspect′ = SIGNAL × {red}',
    '∀ s₁, s₂ : SIGNAL • aspect s₁ = green ∧ aspect s₂ = green ∧ protected s₁ = protected s₂ ⇒ s₁ = s₂',
    'balance′ = balance ∖ {a? ↦ balance a?} ∪ {a? ↦ balance a? - amount?}',
    'x ∈ 1 .. n ∧ (n div 2) * 2 + n mod 2 = n',
    '(A × B) × C = A × B × C',
    'f ∈ A ↔ B ⇸ C → D',
    '{ x : ℕ; y : ℤ | x < y • (x, y, x + y) }',
    '¬ ¬ (p ⇔ q ⇔ r)',
    '{x : S} = S',
  ];
  it.each(corpus)('%s', (src) => {
    const t = parse(src);
    const again = parse(printTerm(t));
    expect(termEquals(again, t)).toBe(true);
    expect(printTerm(again)).toBe(printTerm(t)); // printing is idempotent
  });

  it('holds for 2000 random terms', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 2000; i++) {
      const t = randomPred(rand, 4);
      const text = printTerm(t);
      const r = parseTerm(text);
      expect(r.diagnostics, text).toEqual([]);
      expect(termEquals(r.term!, t), `${text}\nreprinted: ${printTerm(r.term!)}`).toBe(true);
    }
  });
});

describe('numbers', () => {
  it('prints decimals exactly, never in exponent notation', () => {
    const num = (value: number): Term => ({ kind: 'num', value, span: { from: 0, to: 0 } });
    for (const v of [0.25, -1.5, 36.5, 0.1 + 0.2, 1e-7, -1.25e-7, 1.5e22, 1e21, 123456.789, 2 ** 53]) {
      const text = printTerm(num(v));
      expect(text, String(v)).not.toMatch(/e/);
      const back = parseTerm(text).term!;
      expect(back.kind === 'num' && back.value, text).toBe(v);
    }
    expect(printTerm(num(1e-7))).toBe('0.0000001');
    expect(printTerm(num(1.5e22))).toBe('15000000000000000000000');
  });
});

describe('termEquals', () => {
  it('ignores spans and the ‘:’/‘∈’ spelling', () => {
    expect(termEquals(parse('{ x : S | x ∈ T }'), parse('{x ∈ S | (x ∈ T)}'))).toBe(true);
    expect(termEquals(parse('a ∪ b'), parse('a ∩ b'))).toBe(false);
    expect(termEquals(parse('f(x)'), parse('f(y)'))).toBe(false);
    expect(termEquals(parse('∀ x : S • P'), parse('∃ x : S • P'))).toBe(false);
  });
});

describe('freeVars', () => {
  it('collects free names and respects binders', () => {
    const fv = (s: string) => [...freeVars(parse(s))].sort();
    expect(fv('onLoan = dom borrower')).toEqual(['borrower', 'onLoan']);
    expect(fv('books! = { b ∈ onLoan | borrower(b) = member? }')).toEqual(['books!', 'borrower', 'member?', 'onLoan']);
    expect(fv('∀ p : patients; d : dom (rx p) • rx p d ≤ maxDose d')).toEqual(['maxDose', 'patients', 'rx']);
    // the declared set is outside the binder's scope
    expect(fv('∀ x : x • x')).toEqual(['x']);
  });
});

describe('rename / primeTerm / substitute', () => {
  it('primes state variables', () => {
    const t = primeTerm(parse('onLoan = dom borrower'), ['onLoan', 'borrower']);
    expect(printTerm(t)).toBe('onLoan′ = dom borrower′');
    expect(t).toMatchObject({ left: { name: 'onLoan′', base: 'onLoan', decoration: '′', span: { from: 0, to: 6 } } });
  });

  it('does not rename bound variables', () => {
    expect(printTerm(primeTerm(parse('∀ onLoan : BOOK • onLoan ∈ dom borrower'), ['onLoan', 'borrower']))).toBe(
      '∀ onLoan : BOOK • onLoan ∈ dom borrower′',
    );
    expect(printTerm(rename(parse('{ x : x | x ∈ y }'), { x: 'a', y: 'b' }))).toBe('{ x : a | x ∈ b }');
  });

  it('avoids capturing a renamed variable', () => {
    // renaming y ↦ x must not let the binder ∀ x capture it
    expect(printTerm(rename(parse('∀ x : S • x = y'), { y: 'x' }))).toBe('∀ x1 : S • x1 = x');
  });

  it('substitutes terms for variables', () => {
    const sub = new Map<string, Term>([['borrower′', parse('borrower ∪ {book? ↦ member?}')]]);
    expect(printTerm(substitute(parse('onLoan′ = dom borrower′'), sub))).toBe('onLoan′ = dom (borrower ∪ {book? ↦ member?})');
    const cap = new Map<string, Term>([['y', nameTerm('n')]]);
    expect(printTerm(substitute(parse('{ n : BOOK | n = y }'), cap))).toBe('{ n1 : BOOK | n1 = n }');
  });
});

// ── random terms ───────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const S0: Span = { from: 0, to: 0 };
const NAMES = ['x', 'y', 'f', 'onLoan', 'book?', 'member!', 'borrower′', 'BOOK', 's₁'];
const BINOPS: BinOp[] = ['↔', '⇸', '→', '↦', '∪', '∩', '∖', '+', '-', '*', 'div', 'mod', '..'];
const RELOPS: RelOp[] = ['=', '≠', '∈', '∉', '⊆', '⊂', '<', '≤', '>', '≥'];
const UNOPS: UnOp[] = ['dom', 'ran', 'ℙ', '#', 'neg'];

function randomExpr(r: () => number, depth: number): Term {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  if (depth <= 0 || r() < 0.25) {
    const k = r();
    if (k < 0.6) return nameTerm(pick(NAMES));
    if (k < 0.7) return { kind: 'num', value: Math.floor(r() * 7) - 3, span: S0 };
    if (k < 0.75) return { kind: 'num', value: pick([0.25, -1.5, 36.5, 0.1, -0.05]), span: S0 };
    if (k < 0.85) return { kind: 'builtinSet', set: pick(['ℕ', 'ℕ₁', 'ℤ', 'ℝ'] as const), span: S0 };
    return { kind: 'emptyset', span: S0 };
  }
  const d = depth - 1;
  const k = r();
  if (k < 0.35) return { kind: 'binop', op: pick(BINOPS), left: randomExpr(r, d), right: randomExpr(r, d), span: S0 };
  if (k < 0.5) return { kind: 'unop', op: pick(UNOPS), arg: randomExpr(r, d), span: S0 };
  if (k < 0.62) {
    // the parser only applies "applicable" terms (not numbers, ∅, ℕ, tuples)
    let fn = randomExpr(r, d);
    if (fn.kind === 'num' || fn.kind === 'emptyset' || fn.kind === 'builtinSet' || fn.kind === 'tuple') fn = nameTerm('f');
    return { kind: 'apply', fn, arg: randomExpr(r, d), span: S0 };
  }
  if (k < 0.7) return { kind: 'setDisplay', elems: [randomExpr(r, d), ...(r() < 0.5 ? [randomExpr(r, d)] : [])], span: S0 };
  if (k < 0.77) return { kind: 'tuple', elems: [randomExpr(r, d), randomExpr(r, d)], span: S0 };
  if (k < 0.84) return { kind: 'cross', elems: [randomExpr(r, d), randomExpr(r, d), ...(r() < 0.3 ? [randomExpr(r, d)] : [])], span: S0 };
  if (k < 0.92) {
    return {
      kind: 'setComp',
      decls: randomDecls(r, d),
      pred: r() < 0.7 ? randomPred(r, d) : undefined,
      expr: r() < 0.4 ? randomExpr(r, d) : undefined,
      span: S0,
    };
  }
  return nameTerm(pick(NAMES));
}

function randomDecls(r: () => number, depth: number): VarDecl[] {
  const n = r() < 0.7 ? 1 : 2;
  return Array.from({ length: n }, (_, i) => ({
    kind: 'var' as const,
    names: [{ name: `v${i}`, base: `v${i}`, decoration: '' as const, span: S0 }],
    type: randomExpr(r, depth),
    sep: r() < 0.5 ? (':' as const) : ('∈' as const),
    span: S0,
  }));
}

function randomPred(r: () => number, depth: number): Term {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const d = depth - 1;
  const k = r();
  if (depth <= 0 || k < 0.35) {
    if (r() < 0.1) return { kind: 'bool', value: r() < 0.5, span: S0 };
    return { kind: 'rel', op: pick(RELOPS), left: randomExpr(r, depth), right: randomExpr(r, depth), span: S0 };
  }
  if (k < 0.65) return { kind: 'logic', op: pick(['∧', '∨', '⇒', '⇔'] as const), left: randomPred(r, d), right: randomPred(r, d), span: S0 };
  if (k < 0.75) return { kind: 'not', arg: randomPred(r, d), span: S0 };
  return {
    kind: 'quant',
    q: pick(['∀', '∃'] as const),
    decls: randomDecls(r, d),
    pred: r() < 0.3 ? randomPred(r, d) : undefined,
    body: randomPred(r, d),
    span: S0,
  };
}
