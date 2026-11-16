import { describe, expect, it } from 'vitest';
import { LIBRARY, LOANS_OF } from './testing/library';
import type { Term } from './ast';
import {
  EvalError,
  enumerateDeclared,
  enumerateSet,
  equalValues,
  evalPred,
  evalTerm,
  makeUniverse,
  memberOfDeclared,
  type Env,
  type Universe,
} from './eval';
import { analyseSpec, type SchemaInfo } from './index';
import { parseTerm } from './parser';
import {
  EMPTY,
  atom,
  compareValues,
  formatNumber,
  int,
  lazy,
  mkSet,
  pair,
  printValue,
  tuple,
  valueEquals,
  valueKey,
  type Value,
} from './values';

const T = (s: string): Term => {
  const r = parseTerm(s);
  if (!r.term) throw new Error(`${s}: ${r.diagnostics[0]?.message}`);
  return r.term;
};

const u: Universe = makeUniverse(LIBRARY.pools, { intMin: -3, intMax: 6 });
const B = (n: string) => u.carriers.BOOK.find((a) => a.k === 'atom' && a.name === n)!;
const M = (n: string) => u.carriers.MEMBER.find((a) => a.k === 'atom' && a.name === n)!;
const set = (...xs: Value[]) => mkSet(xs);
const fn = (...ps: [Value, Value][]) => mkSet(ps.map(([a, b]) => pair(a, b)));

// an example state
const onLoan = set(B('Dune'), B('Emma'), B('Hamlet'));
const borrower = fn([B('Hamlet'), M('Ada')], [B('Dune'), M('Ben')], [B('Emma'), M('Ben')]);
const state: Env = new Map<string, Value>([
  ['onLoan', onLoan],
  ['borrower', borrower],
]);

const analysis = analyseSpec({ ...LIBRARY, operations: [...LIBRARY.operations, LOANS_OF] });
/** Which of a schema's predicates fail in `env` (printed with their origin). */
function failing(schema: SchemaInfo, env: Env): string[] {
  return schema.preds.filter((p) => !evalPred(p.term, env, u)).map((p) => `${p.origin}: ${printPred(p.term)}`);
}
const printPred = (t: Term) => `${t.span.from}`; // origin + position is enough to identify the line
const withVars = (base: Env, more: Record<string, Value>): Env => new Map([...base, ...Object.entries(more)]);

describe('Library', () => {
  it('prints the state in Z set notation', () => {
    expect(printValue(onLoan)).toBe('{Dune, Emma, Hamlet}'); // pool order
    expect(printValue(borrower)).toBe('{Dune ↦ Ben, Emma ↦ Ben, Hamlet ↦ Ada}');
  });

  it('the example state satisfies the invariant', () => {
    expect(evalPred(T('onLoan = dom borrower'), state, u)).toBe(true);
    expect(evalPred(T('onLoan = dom borrower'), withVars(state, { onLoan: set(B('Dune')) }), u)).toBe(false);
    expect(failing(analysis.byId.state, state)).toEqual([]);
  });

  it('Lend holds for a correct after-state and fails for wrong ones', () => {
    const lend = analysis.byId['op-lend'];
    const inputs = { 'book?': B('Ulysses'), 'member?': M('Cleo') };
    const good = withVars(state, {
      ...inputs,
      'onLoan′': set(B('Dune'), B('Emma'), B('Hamlet'), B('Ulysses')),
      'borrower′': fn([B('Hamlet'), M('Ada')], [B('Dune'), M('Ben')], [B('Emma'), M('Ben')], [B('Ulysses'), M('Cleo')]),
    });
    expect(failing(lend, good)).toEqual([]);

    // onLoan′ not updated: only the invariant after the operation fails
    const stale = withVars(good, { 'onLoan′': onLoan });
    expect(lend.preds.filter((p) => !evalPred(p.term, stale, u)).map((p) => p.origin)).toEqual(['invariant′']);

    // wrong member stored: the operation's own predicate fails
    const wrong = withVars(good, {
      'borrower′': fn([B('Hamlet'), M('Ada')], [B('Dune'), M('Ben')], [B('Emma'), M('Ben')], [B('Ulysses'), M('Eva')]),
    });
    expect(lend.preds.filter((p) => !evalPred(p.term, wrong, u)).map((p) => p.origin)).toEqual(['own']);

    // precondition: book? ∉ onLoan is false for a book that is on loan
    expect(evalPred(lend.preds[0].term, withVars(good, { 'book?': B('Dune') }), u)).toBe(false);
  });

  it('FindBorrower and LoansOf', () => {
    const find = analysis.byId['op-find'];
    const env = withVars(state, { 'onLoan′': onLoan, 'borrower′': borrower, 'book?': B('Hamlet'), 'member!': M('Ada') });
    expect(failing(find, env)).toEqual([]);
    expect(find.preds.filter((p) => !evalPred(p.term, withVars(env, { 'member!': M('Ben') }), u)).map((p) => p.origin)).toEqual(['own']);
    expect(find.preds.filter((p) => !evalPred(p.term, withVars(env, { 'onLoan′': EMPTY, 'borrower′': EMPTY }), u)).map((p) => p.origin)).toEqual([
      'xi',
      'xi',
    ]);

    const loans = analysis.byId['op-loans'];
    const books = loans.preds[0].term;
    if (books.kind !== 'rel') throw new Error();
    expect(printValue(evalTerm(books.right, withVars(state, { 'member?': M('Ben') }), u))).toBe('{Dune, Emma}');
    expect(printValue(evalTerm(books.right, withVars(state, { 'member?': M('Eva') }), u))).toBe('∅');
  });

  it('reports undefined function applications', () => {
    const t = T('member! = borrower(book?)');
    const env = withVars(state, { 'book?': B('Ulysses'), 'member!': M('Cleo') });
    let err: unknown;
    try {
      evalPred(t, env, u);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EvalError);
    expect((err as EvalError).message).toBe('borrower(Ulysses) is undefined: Ulysses ∉ dom borrower');
    expect((err as EvalError).reason).toBe('undefined');
    expect((err as EvalError).span).toEqual({ from: 10, to: 25 });

    const rel = fn([B('Ulysses'), M('Cleo')], [B('Ulysses'), M('Eva')]);
    expect(() => evalTerm(T('f(Ulysses)'), new Map([['f', rel], ['Ulysses', B('Ulysses')]]), u)).toThrow(
      'f(Ulysses) is undefined: f relates Ulysses to several values (Cleo, Eva)',
    );
    expect(() => evalTerm(T('(f ∪ g)(x)'), new Map<string, Value>([['f', EMPTY], ['g', EMPTY], ['x', int(1)]]), u)).toThrow(
      '(f ∪ g)(1) is undefined: 1 ∉ dom (f ∪ g)',
    );
  });

  it('short-circuits so guarded applications are fine', () => {
    const env = withVars(state, { 'book?': B('Ulysses') });
    expect(evalPred(T('book? ∈ dom borrower ⇒ borrower(book?) = borrower(book?)'), env, u)).toBe(true);
    expect(evalPred(T('book? ∈ onLoan ∧ borrower(book?) ∈ MEMBER'), env, u)).toBe(false);
  });
});

describe('sets, relations and functions', () => {
  const ev = (s: string, env: Env = state) => printValue(evalTerm(T(s), env, u));

  it('evaluates set operators', () => {
    expect(ev('onLoan ∪ {Ulysses}', withVars(state, { Ulysses: B('Ulysses') }))).toBe('{Dune, Emma, Hamlet, Ulysses}');
    expect(ev('onLoan ∩ {Hamlet}', withVars(state, { Hamlet: B('Hamlet') }))).toBe('{Hamlet}');
    expect(ev('onLoan ∖ dom borrower')).toBe('∅');
    expect(ev('ran borrower')).toBe('{Ada, Ben}');
    expect(ev('#onLoan + #ran borrower')).toBe('5');
    expect(ev('{ b : onLoan • borrower(b) }')).toBe('{Ada, Ben}');
    expect(ev('{ b : onLoan; m : ran borrower | (b ↦ m) ∉ borrower }')).toBe('{Dune ↦ Ada, Emma ↦ Ada, Hamlet ↦ Ben}');
    expect(ev('borrower ∖ {b ↦ borrower(b)} ∪ {b ↦ m}', withVars(state, { b: B('Hamlet'), m: M('Eva') }))).toBe(
      '{Dune ↦ Ben, Emma ↦ Ben, Hamlet ↦ Eva}',
    );
    expect(ev('1 .. 4')).toBe('{1, 2, 3, 4}');
    expect(ev('{1} × {Dune}', withVars(state, { Dune: B('Dune') }))).toBe('{1 ↦ Dune}');
    expect(ev('(1, 2, 3)')).toBe('(1, 2, 3)');
    expect(ev('{(1, 2, 3)}')).toBe('{(1, 2, 3)}');
  });

  it('evaluates predicates on sets', () => {
    const p = (s: string) => evalPred(T(s), state, u);
    expect(p('dom borrower ⊆ onLoan')).toBe(true);
    expect(p('dom borrower ⊂ onLoan')).toBe(false);
    expect(p('onLoan ⊆ BOOK ∧ onLoan ≠ BOOK')).toBe(true);
    expect(p('borrower ∈ BOOK ⇸ MEMBER')).toBe(true);
    expect(p('borrower ∈ BOOK → MEMBER')).toBe(false);
    expect(p('borrower ∈ onLoan → MEMBER')).toBe(true);
    expect(p('onLoan ∈ ℙ BOOK')).toBe(true);
    expect(p('∀ b : onLoan • borrower(b) ∈ MEMBER')).toBe(true);
    expect(p('∃ b : onLoan • borrower(b) = borrower(b) ∧ b ∉ onLoan')).toBe(false);
    expect(p('∀ a, b : onLoan | a ≠ b • borrower(a) ≠ borrower(b)')).toBe(false); // Ben has borrowed Dune and Emma
    expect(p('1 .. 3 = {1, 2, 3}')).toBe(true);
    expect(p('ℕ = ℕ ∧ ℕ ≠ {1}')).toBe(true);
    expect(p('ℕ₁ ⊆ ℕ ∧ ℕ ⊆ ℤ ∧ ¬ ℤ ⊆ ℕ ∧ 1 .. 100000 ⊆ ℕ₁ ∧ ¬ (0 .. 100000 ⊆ ℕ₁)')).toBe(true);
    expect(p('{1, 2} ⊆ ℕ₁ ∧ ¬ {0} ⊆ ℕ₁')).toBe(true);
  });

  it('uses Z integer division', () => {
    const v = (s: string) => evalTerm(T(s), state, u);
    expect([v('7 div 2'), v('-7 div 2'), v('-7 mod 2'), v('7 mod -2')].map(printValue)).toEqual(['3', '-4', '1', '-1']);
    expect(() => v('1 div 0')).toThrow('‘1 div 0’ is undefined: division by zero');
  });

  it('checks integers exactly but enumerates them within bounds', () => {
    expect(evalPred(T('5000 ∈ ℕ₁ ∧ 0 ∉ ℕ₁ ∧ -1 ∉ ℕ ∧ -1 ∈ ℤ'), state, u)).toBe(true);
    expect(evalPred(T('∀ n : ℕ • n ≤ 6'), state, u)).toBe(true); // bounded by intMax
    expect(printValue(evalTerm(T('{ n : ℤ | n * n = 4 }'), state, u))).toBe('{-2, 2}');
  });

  it('bank invariant with negative balances', () => {
    const acc = (n: string) => atom('ACCOUNT', n);
    const env: Env = new Map<string, Value>([
      ['balance', fn([acc('a1'), int(-50)], [acc('a2'), int(10)])],
      ['overdraft', fn([acc('a1'), int(100)], [acc('a2'), int(0)])],
    ]);
    expect(evalPred(T('∀ a : dom balance • balance(a) ≥ -overdraft(a)'), env, u)).toBe(true);
    expect(evalPred(T('∀ a : dom balance • balance a ≥ 0'), env, u)).toBe(false);
  });
});

describe('declared sets', () => {
  it('checks membership of declared sets', () => {
    const m = (v: Value, s: string) => memberOfDeclared(v, T(s), new Map(), u);
    expect(m(borrower, 'BOOK ⇸ MEMBER')).toBe(true);
    expect(m(borrower, 'BOOK ↔ MEMBER')).toBe(true);
    expect(m(borrower, 'BOOK → MEMBER')).toBe(false);
    expect(m(fn([B('Dune'), M('Eva')], [B('Dune'), M('Cleo')]), 'BOOK ⇸ MEMBER')).toBe(false);
    expect(m(fn([B('Dune'), M('Eva')], [B('Dune'), M('Cleo')]), 'BOOK ↔ MEMBER')).toBe(true);
    expect(m(fn([M('Eva'), B('Dune')]), 'BOOK ⇸ MEMBER')).toBe(false);
    expect(m(onLoan, 'ℙ BOOK')).toBe(true);
    expect(m(B('Dune'), 'BOOK')).toBe(true);
    expect(m(M('Eva'), 'BOOK')).toBe(false);
    expect(m(int(5000), 'ℕ₁')).toBe(true);
    expect(m(int(0), 'ℕ₁')).toBe(false);
    expect(m(pair(B('Dune'), int(3)), 'BOOK × ℕ')).toBe(true);
    const total = mkSet((u.carriers.BOOK as Value[]).map((b) => pair(b, M('Eva'))));
    expect(m(total, 'BOOK → MEMBER')).toBe(true);
    expect(m(fn([B('Dune'), int(-1)]), 'BOOK ⇸ ℕ')).toBe(false);
  });

  it('checks nested functions', () => {
    const uu = makeUniverse({ PATIENT: ['Ana', 'Ben'], DRUG: ['aspirin', 'ibuprofen'] });
    const P = (n: string) => atom('PATIENT', n);
    const Dr = (n: string) => atom('DRUG', n);
    const rx = fn([P('Ana'), fn([Dr('aspirin'), int(2)])], [P('Ben'), EMPTY]);
    expect(printValue(rx)).toBe('{Ana ↦ {aspirin ↦ 2}, Ben ↦ ∅}');
    expect(memberOfDeclared(rx, T('PATIENT ⇸ (DRUG ⇸ ℕ₁)'), new Map(), uu)).toBe(true);
    expect(memberOfDeclared(fn([P('Ana'), fn([Dr('aspirin'), int(0)])]), T('PATIENT ⇸ (DRUG ⇸ ℕ₁)'), new Map(), uu)).toBe(false);
  });

  it('enumerates small declared sets and gives up on large ones', () => {
    const e = (s: string, env: Env = new Map()) => enumerateDeclared(T(s), env, u);
    expect(e('BOOK')!.map(printValue)).toEqual(LIBRARY.pools.BOOK);
    expect(e('ℕ₁')!.map(printValue)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(e('ℤ')!.map(printValue)[0]).toBe('-3');
    expect(e('onLoan', state)!.map(printValue)).toEqual(['Dune', 'Emma', 'Hamlet']);
    expect(e('ℙ BOOK')).toHaveLength(256);
    expect(e('ℙ onLoan', state)!.map(printValue).slice(0, 5)).toEqual(['∅', '{Dune}', '{Emma}', '{Hamlet}', '{Dune, Emma}']);
    expect(e('onLoan ⇸ {1, 2}', state)).toHaveLength(27);
    expect(e('onLoan → {1, 2}', state)).toHaveLength(8);
    expect(e('BOOK ⇸ MEMBER')).toBeNull(); // 9^8 functions
    expect(e('ℙ ℙ BOOK')).toBeNull();
    expect(enumerateSet(lazy({ kind: 'nat' }), u, 3)).toBeNull();
  });

  it('refuses to quantify over huge sets', () => {
    expect(() => evalPred(T('∀ f : BOOK ⇸ MEMBER • f = f'), new Map(), u)).toThrow(EvalError);
  });
});

describe('real numbers (ℝ)', () => {
  const p = (s: string, env: Env = new Map()) => evalPred(T(s), env, u);
  const ev = (s: string, env: Env = new Map()) => printValue(evalTerm(T(s), env, u));
  const S = (n: string) => atom('SENSOR', n);
  const reals = makeUniverse({ SENSOR: ['s1', 's2'] }, { intMin: -3, intMax: 6 });

  it('checks membership: ℕ and ℤ hold whole numbers only', () => {
    expect(p('2.5 ∈ ℝ ∧ 2.5 ∉ ℤ ∧ 2.5 ∉ ℕ ∧ 2.5 ∉ ℕ₁ ∧ -0.5 ∈ ℝ ∧ 3 ∈ ℝ')).toBe(true);
    expect(p('2.5 ∉ 1 .. 3 ∧ 2 ∈ 1 .. 3')).toBe(true);
    expect(p('ℕ ⊆ ℝ ∧ ℤ ⊆ ℝ ∧ ¬ ℝ ⊆ ℤ ∧ ℝ = ℝ ∧ ℝ ≠ ℤ')).toBe(true);
    expect(memberOfDeclared(fn([S('s1'), int(36.5)]), T('SENSOR ⇸ ℝ'), new Map(), reals)).toBe(true);
    expect(memberOfDeclared(fn([S('s1'), int(36.5)]), T('SENSOR ⇸ ℤ'), new Map(), reals)).toBe(false);
    expect(memberOfDeclared(int(0.25), T('ℝ'), new Map(), reals)).toBe(true);
  });

  it('computes with decimals without binary rounding noise', () => {
    expect(ev('0.1 + 0.2')).toBe('0.3');
    expect(p('0.1 + 0.2 = 0.3 ∧ 0.3 ∈ {0.1 + 0.2}')).toBe(true);
    expect(p('1.1 * 3 = 3.3 ∧ 0.25 < 0.5 ∧ -1.5 ≤ -1.5')).toBe(true);
    expect(ev('{ x : 1 .. 3 • x * 0.5 }')).toBe('{0.5, 1, 1.5}');
    expect(ev('0.5 .. 3.5')).toBe('{1, 2, 3}'); // the whole numbers in between
    expect(printValue(int(0.1 + 0.2))).toBe('0.3');
    expect(valueEquals(int(0.1 + 0.2), int(0.3))).toBe(true);
    expect(valueKey(int(0.1 + 0.2))).toBe(valueKey(int(0.3)));
    expect(printValue(mkSet([int(36.5), int(-1.5), int(0.25)]))).toBe('{-1.5, 0.25, 36.5}');
    expect(formatNumber(1e-7)).toBe('0.0000001');
  });

  it('refuses div and mod on decimals', () => {
    expect(() => evalTerm(T('5 div 2.5'), new Map(), u)).toThrow('div works on whole numbers, but 2.5 is not one');
    expect(() => evalTerm(T('t mod 2'), new Map([['t', int(36.5)]]), u)).toThrow('mod works on whole numbers, but ‘t’ is 36.5');
  });

  it('cannot list ℝ', () => {
    let err: unknown;
    try {
      p('∀ x : ℝ • x = x');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EvalError);
    expect((err as EvalError).reason).toBe('too-large');
    expect((err as EvalError).message).toBe('Cannot try every value of ‘ℝ’: real numbers (ℝ) cannot be listed one by one');
    expect(() => evalPred(T('∃ f : SENSOR ⇸ ℝ • f = ∅'), new Map(), reals)).toThrow('Cannot try every value of ‘SENSOR ⇸ ℝ’');
    expect(() => evalTerm(T('#ℝ'), new Map(), u)).toThrow('‘ℝ’ cannot be listed — there are infinitely many real numbers');
    expect(enumerateDeclared(T('ℝ'), new Map(), u)).toBeNull();
    expect(enumerateSet(lazy({ kind: 'real' }), u)).toBeNull();
    // membership in ℝ needs no listing
    expect(p('∀ x : 1 .. 3 • x ∈ ℝ')).toBe(true);
  });
});

describe('values', () => {
  it('normalises sets: no duplicates, canonical order', () => {
    const s = mkSet([int(3), int(1), int(3), int(2)]);
    expect(printValue(s)).toBe('{1, 2, 3}');
    expect(valueEquals(s, mkSet([int(2), int(1), int(3)]))).toBe(true);
    expect(valueEquals(s, mkSet([int(1), int(2)]))).toBe(false);
    expect(valueKey(mkSet([pair(int(1), int(2))]))).toBe(valueKey(mkSet([tuple([int(1), int(2)])])));
  });

  it('orders atoms by carrier position, then naturally by name', () => {
    expect(printValue(mkSet([atom('T', 'train10'), atom('T', 'train2'), atom('T', 'train1')]))).toBe('{train1, train2, train10}');
    expect(compareValues(B('Ulysses'), B('Beloved'))).toBeLessThan(0); // pool order: Ulysses before Beloved
    expect(compareValues(int(1), B('Dune'))).toBeLessThan(0);
  });

  it('does not confuse atoms with tricky names', () => {
    expect(valueEquals(atom('A', 'x,y'), atom('A', 'x'))).toBe(false);
    expect(valueKey(tuple([atom('A', 'a'), atom('A', 'b')]))).not.toBe(valueKey(tuple([atom('A', 'a),(b')])));
    expect(valueEquals(atom('BOOK', 'Ana'), atom('PATIENT', 'Ana'))).toBe(false);
  });

  it('prints values like the slides', () => {
    expect(printValue(EMPTY)).toBe('∅');
    expect(printValue(pair(B('Dune'), M('Ben')))).toBe('(Dune, Ben)');
    expect(printValue(mkSet([pair(pair(int(1), int(2)), int(3))]))).toBe('{(1, 2) ↦ 3}');
    expect(printValue(lazy({ kind: 'pfun', from: lazy({ kind: 'nat' }), to: onLoan }))).toBe('ℕ ⇸ {Dune, Emma, Hamlet}');
    expect(printValue(lazy({ kind: 'power', base: lazy({ kind: 'rel', from: onLoan, to: lazy({ kind: 'int' }) }) }))).toBe(
      'ℙ ({Dune, Emma, Hamlet} ↔ ℤ)',
    );
  });

  it('compares lazy and finite sets exactly when possible', () => {
    expect(equalValues(lazy({ kind: 'range', lo: 1, hi: 2 }), mkSet([int(1), int(2)]), u)).toBe(true);
    expect(equalValues(lazy({ kind: 'nat1' }), mkSet([int(1)]), u)).toBe(false);
  });
});
