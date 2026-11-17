import { describe, expect, it } from 'vitest';
import { LIBRARY, LOANS_OF } from './testing/library';
import type { Term } from './ast';
import {
  EvalError,
  enumerateDeclared,
  enumerateSet,
  equalValues,
  evalPred,
  evalPredChecked,
  evalTerm,
  isInfiniteSet,
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
  int,
  lazy,
  mkSet,
  pair,
  printValue,
  tuple,
  valueEquals,
  valueKey,
  type SetLike,
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
    expect((err as EvalError).message).toBe('borrower(book?) is undefined: book? = Ulysses ∉ dom borrower');
    expect((err as EvalError).reason).toBe('undefined');
    expect((err as EvalError).span).toEqual({ from: 10, to: 25 });

    const rel = fn([B('Ulysses'), M('Cleo')], [B('Ulysses'), M('Eva')]);
    expect(() => evalTerm(T('f(Ulysses)'), new Map([['f', rel], ['Ulysses', B('Ulysses')]]), u)).toThrow(
      'f(Ulysses) is undefined: f relates Ulysses to several values (Cleo, Eva)',
    );
    expect(() => evalTerm(T('(f ∪ g)(x)'), new Map<string, Value>([['f', EMPTY], ['g', EMPTY], ['x', int(1)]]), u)).toThrow(
      '(f ∪ g)(x) is undefined: x = 1 ∉ dom (f ∪ g)',
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

  it('checks integers exactly', () => {
    expect(evalPred(T('5000 ∈ ℕ₁ ∧ 0 ∉ ℕ₁ ∧ -1 ∉ ℕ ∧ -1 ∈ ℤ'), state, u)).toBe(true);
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

describe('infinite sets: exact or bounded verdicts', () => {
  const check = (src: string, env: Env = new Map(), uu: Universe = u) => {
    const r = evalPredChecked(T(src), env, uu);
    return r.bounded ? `≈ ${r.value}` : String(r.value);
  };

  it('quantifiers over ℕ / ℤ: a probe beyond the window decides exactly, otherwise ≈', () => {
    // u's window is -3 .. 6
    expect(check('∀ n : ℕ • n ≤ 6')).toBe('false'); // 7 is a counterexample
    expect(check('∀ n : ℕ • n < 500')).toBe('false'); // so is 1000
    expect(check('∃ n : ℕ • n > 500')).toBe('true');
    expect(check('∃ n : ℤ • n < -500')).toBe('true');
    expect(check('∀ n : ℕ • n ≥ 0')).toBe('≈ true');
    expect(check('∃ n : ℕ • n * n = 2')).toBe('≈ false');
    expect(check('∀ n : 1 .. 3 • n ≥ 1')).toBe('true'); // finite: exact
    expect(check('∀ n : ℕ • n ∈ s', new Map([['s', mkSet([0, 1, 2, 3, 4, 5, 6].map(int))]]))).toBe('false');
  });

  it('does not count probe errors as counterexamples', () => {
    const f = mkSet([0, 1, 2, 3, 4, 5, 6].map((n) => pair(int(n), int(n * n))));
    expect(check('∀ n : ℕ • f(n) ≥ 0', new Map([['f', f]]))).toBe('≈ true');
    expect(() => evalPred(T('∀ n : ℤ • f(n) ≥ 0'), new Map([['f', f]]), u)).toThrow('f(n) is undefined: n = -3 ∉ dom f'); // inside the window
  });

  it('comprehensions over ℕ / ℤ are never equal to a finite set by accident', () => {
    const upTo = (n: number) => mkSet(Array.from({ length: n }, (_, i) => int(i + 1)));
    expect(check('s = { n : ℕ | n > 0 }', new Map([['s', upTo(6)]]))).toBe('false'); // 7 is missing
    expect(check('s = { n : ℕ | n > 0 }', new Map([['s', upTo(30)]]))).toBe('false'); // 50 is missing
    expect(check('s = { n : ℕ | n > 0 ∧ n < 4 }', new Map([['s', upTo(3)]]))).toBe('≈ true');
    expect(check('s = { n : ℕ | n > 0 ∧ n < 4 }', new Map([['s', upTo(2)]]))).toBe('false'); // 3 is missing
    expect(printValue(evalTerm(T('{ n : ℤ | n * n = 4 }'), new Map(), u))).toBe('{-2, 2, …}');
    expect(check('{ n : ℤ | n * n = 4 } = {-2, 2}')).toBe('≈ true');
    expect(check('2 ∈ { n : ℤ | n * n = 4 } ∧ 3 ∉ { n : ℤ | n * n = 4 } ∧ 1000 ∈ { n : ℕ | n > 6 }')).toBe('true');
    expect(check('{ n : ℕ | n > 0 } ⊆ ℕ₁')).toBe('≈ true');
    expect(check('ℕ₁ ⊆ { n : ℕ | n < 30 }')).toBe('false');
    expect(check('#{ n : ℕ | n < 5 } = 5')).toBe('≈ true');
    // a finite set never equals an infinite one
    expect(check('s = ℕ ∨ ℕ ⊆ s', new Map([['s', upTo(30)]]))).toBe('false');
  });

  const dates = makeUniverse({ DATE: ['a', 'b', 'c'], NAME: ['x', 'y'] }, { intMin: -3, intMax: 6, infinite: ['DATE'] });
  const D = (n: string) => dates.carriers.DATE.find((d) => d.k === 'atom' && d.name === n)!;
  const f = mkSet([pair(D('a'), int(1)), pair(D('b'), int(5))]);
  const env: Env = new Map<string, Value>([['f', f]]);

  it('infinite given sets: exact by using one generic element', () => {
    expect(check('∀ d : DATE • d ∈ dom f', env, dates)).toBe('false');
    expect(check('∃ d : DATE • d ∉ dom f', env, dates)).toBe('true');
    expect(check('∀ d : DATE | d ∈ dom f • f(d) > 0', env, dates)).toBe('true');
    expect(check('∀ d, e : DATE • d ≠ e ⇒ ¬ (d ∈ dom f ∧ e ∈ dom f ∧ f(d) = f(e))', env, dates)).toBe('true');
    expect(check('dom f ⊆ DATE ∧ DATE ≠ dom f ∧ ¬ DATE ⊆ dom f', env, dates)).toBe('true');
    expect(printValue(evalTerm(T('{ d : DATE | d ∈ dom f ∧ f(d) > 2 }'), env, dates))).toBe('{b}'); // exact and finite
    expect(check('{ d : DATE | d ∉ dom f } = {c}', new Map([...env, ['c', D('c')]]), dates)).toBe('false'); // infinite
    expect(check('#DATE = 3', env, dates)).toBe('≈ true'); // only the example elements are counted
    // a function given on all example dates: the example cannot show more of it, so
    // statements about all of DATE are only bounded verdicts, and → counts on the examples
    const g = mkSet(['a', 'b', 'c'].map((n) => pair(D(n), int(1))));
    expect(check('∀ d : DATE • g(d) > 0', new Map([['g', g]]), dates)).toBe('≈ true');
    expect(check('∀ d : DATE • g(d) > 5', new Map([['g', g]]), dates)).toBe('false'); // a is a counterexample
    expect(check('g ∈ DATE → ℕ', new Map([['g', g]]), dates)).toBe('≈ true');
    expect(memberOfDeclared(f, T('DATE ⇸ ℕ'), new Map(), dates)).toBe(true);
    expect(memberOfDeclared(f, T('DATE → ℕ'), new Map(), dates)).toBe(false); // never total on an infinite set
    expect(isInfiniteSet(evalTerm(T('NAME ⇸ DATE'), env, dates) as SetLike, dates)).toBe(true);
    expect(enumerateDeclared(T('DATE'), new Map(), dates)?.map(printValue)).toEqual(['a', 'b', 'c']);
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

describe('nested sets compare by their elements', () => {
  it('a power set inside a set display or tuple equals its listed elements', () => {
    const e = new Map<string, Value>();
    expect(evalPred(T('{ℙ {1}} = {{∅, {1}}}'), e, u)).toBe(true);
    expect(evalPred(T('(ℙ {1}, 2) = ({∅, {1}}, 2)'), e, u)).toBe(true);
    expect(evalPred(T('ℙ {1} ∈ {{∅, {1}}}'), e, u)).toBe(true);
    expect(evalPred(T('{1 .. 3} = {{1, 2, 3}}'), e, u)).toBe(true);
    expect(evalPred(T('{ℙ {1}} = {{{1}}}'), e, u)).toBe(false);
    const f = mkSet([pair(mkSet([EMPTY, mkSet([int(1)])]), int(7))]);
    expect(evalTerm(T('f(ℙ {1})'), new Map([['f', f]]), u)).toEqual(int(7));
  });
});

describe('quantifier bindings', () => {
  it('evaluates a guard before the declared sets of later variables (Z: f(b) does not matter for b ∉ dom f)', () => {
    const P = (n: string) => u.carriers.MEMBER.find((a) => a.k === 'atom' && a.name === n)!;
    const f = mkSet([pair(B('Dune'), mkSet([P('Ada'), P('Ben')])), pair(B('Emma'), EMPTY)]);
    const env = new Map<string, Value>([
      ['f', f],
      ['Ada', P('Ada')],
      ['Ben', P('Ben')],
    ]);
    for (const src of [
      '∀ b ∈ BOOK; m ∈ f(b) | b ∈ dom f . m ∈ MEMBER',
      '∀ b ∈ BOOK; m ∈ f(b) . b ∈ dom f ⇒ m ∈ MEMBER',
      '{ b ∈ BOOK; m ∈ f(b) | b ∈ dom f . m } = {Ada, Ben}',
    ]) {
      expect(evalPredChecked(T(src), env, u), src).toEqual({ value: true, bounded: false });
    }
    expect(evalPred(T('∀ b ∈ BOOK; m ∈ f(b) | b ∈ dom f . m = Ada'), env, u)).toBe(false);
    expect(evalPred(T('∃ b ∈ BOOK; m ∈ f(b) | b ∈ dom f . m = Ben'), env, u)).toBe(true);
    // without the guard, f(b) is undefined for books outside dom f
    expect(() => evalPred(T('∀ b ∈ BOOK; m ∈ f(b) . m ∈ MEMBER'), env, u)).toThrow('is undefined');
  });

  it('never sees a later variable bound in an earlier declared set', () => {
    const env = new Map<string, Value>([['x', mkSet([int(1)])]]);
    // y ∈ x refers to the outer x (x is only bound after y)
    expect(evalPred(T('∀ y ∈ x; x ∈ {{5}, {6}} . y = 1'), env, u)).toBe(true);
    expect(evalTerm(T('{ y ∈ x; x ∈ {{5}, {6}} . (y, x) }'), env, u)).toEqual(
      mkSet([tuple([int(1), mkSet([int(5)])]), tuple([int(1), mkSet([int(6)])])]),
    );
  });

  it('bounds the total work of nested and multi-variable quantifiers (≈ instead of freezing)', () => {
    const uX = makeUniverse({ X: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] });
    for (const src of [
      '∀ a, b ∈ ℙ X . a ∪ b = b ∪ a',
      '∀ a, b, c ∈ ℙ X . a ∪ (b ∪ c) = (a ∪ b) ∪ c',
      '∀ a ∈ ℙ X . ∀ b ∈ ℙ X . ∀ c ∈ ℙ X . a ∩ b ∩ c ⊆ a',
      '#{ a, b ∈ ℙ X | a ⊆ b } > 0',
    ]) {
      const t0 = performance.now();
      const r = evalPredChecked(T(src), new Map(), uX);
      expect(performance.now() - t0, src).toBeLessThan(500); // ~10 ms; minutes without the limit
      expect(r, src).toEqual({ value: true, bounded: true });
    }
    // a counterexample found within the limit still decides exactly
    expect(evalPredChecked(T('∀ a, b ∈ ℙ X . a ∪ b = a'), new Map(), uX)).toEqual({ value: false, bounded: false });
    // small quantifiers are not affected
    expect(evalPredChecked(T('∀ a, b ∈ ℙ {1, 2, 3} . a ∪ b = b ∪ a'), new Map(), uX)).toEqual({ value: true, bounded: false });
  });
});

describe('numbers and products in quantifiers', () => {
  const ub = makeUniverse({ ACCOUNT: ['DE4711', 'DE1001'], PATIENT: ['Ana', 'Ben'], DRUG: ['aspirin', 'insulin'] }, {
    intMin: -5,
    intMax: 20,
    infinite: ['ACCOUNT', 'PATIENT', 'DRUG'],
  });
  const A = (n: string) => ub.carriers.ACCOUNT.find((a) => a.k === 'atom' && a.name === n)!;
  const P = (n: string) => ub.carriers.PATIENT.find((a) => a.k === 'atom' && a.name === n)!;
  const Dr = (n: string) => ub.carriers.DRUG.find((a) => a.k === 'atom' && a.name === n)!;

  it('quantifiers over ℤ also try the numbers of the current values', () => {
    const env = new Map<string, Value>([
      ['balance', fn([A('DE1001'), int(-20)], [A('DE4711'), int(300)])],
      ['overdraft', fn([A('DE1001'), int(10)], [A('DE4711'), int(0)])],
      ['a?', A('DE4711')],
      ['b!', int(0)],
    ]);
    expect(evalPredChecked(T('∀ a ∈ dom balance; b ∈ ℤ . (a ↦ b) ∈ balance ⇒ b ≥ -overdraft(a)'), env, ub)).toEqual({ value: false, bounded: false });
    expect(evalPredChecked(T('∀ x ∈ ℤ . (a? ↦ x) ∈ balance ⇒ b! = x'), env, ub)).toEqual({ value: false, bounded: false });
    expect(evalPredChecked(T('∃ x ∈ ℕ . (a? ↦ x) ∈ balance'), env, ub)).toEqual({ value: true, bounded: false });
    // without a counterexample the verdict still rests on a sample
    expect(evalPredChecked(T('∀ x ∈ ℤ . (a? ↦ x) ∈ balance ⇒ x = 300'), env, ub)).toEqual({ value: true, bounded: true });
  });

  it('handles products of infinite given sets like separate variables', () => {
    const env = new Map<string, Value>([
      ['prescribed', fn([P('Ana'), Dr('aspirin')])],
      ['allergic', fn([P('Ana'), Dr('insulin')])],
      ['p?', P('Ben')],
      ['drug?', Dr('insulin')],
      ['Ben', P('Ben')],
      ['aspirin', Dr('aspirin')],
    ]);
    const exact = (src: string, value: boolean) => expect(evalPredChecked(T(src), env, ub), src).toEqual({ value, bounded: false });
    exact('prescribed ⊆ (PATIENT × DRUG) ∖ allergic', true);
    exact('allergic ⊆ (PATIENT × DRUG) ∖ allergic', false);
    exact('(Ben ↦ aspirin) ∈ (PATIENT × DRUG) ∖ allergic', true);
    exact('{ x ∈ PATIENT × DRUG | x ∈ prescribed ∨ x = (p? ↦ drug?) } = prescribed ∪ {p? ↦ drug?}', true);
    exact('∀ x ∈ PATIENT × DRUG | x ∈ allergic . x ∉ prescribed', true);
    exact('(PATIENT × DRUG) ∖ allergic = prescribed', false); // an infinite set is no finite one
  });
});
