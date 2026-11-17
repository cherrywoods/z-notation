import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SchemaDoc, SpecDoc } from '../spec/model';
import { LIBRARY, LOANS_OF } from './testing/library';
import { analyseSpec, type Analysis } from './index';
import { parseTerm } from './parser';
import { printTerm } from './print';
import { TypeChecker, type Scope } from './typecheck';
import { exampleOperation } from './generate';
import { referenceSpecOf } from '../spec/topics';
import { infer } from './infer';
import { describeType, given, power, relation, typeToString, INT } from './types';
import { useWorkClock } from './gen/clock';

// Example searches count work instead of milliseconds here (gen/clock), so the results
// do not depend on the machine's speed or load.
beforeAll(() => useWorkClock(true));
afterAll(() => useWorkClock(false));

const LIB_WITH_LOANS: SpecDoc = { ...LIBRARY, operations: [...LIBRARY.operations, LOANS_OF] };

type Patch = Partial<Pick<SchemaDoc, 'decls' | 'preds'>>;
/** The Library with some sections replaced. */
function lib(p: { given?: string; state?: Patch; init?: Patch | null; find?: Patch; lend?: Patch } = {}): SpecDoc {
  const s = structuredClone(LIBRARY);
  if (p.given !== undefined) s.given = p.given;
  Object.assign(s.state, p.state);
  if (p.init === null) s.init = null;
  else Object.assign(s.init!, p.init);
  Object.assign(s.operations[0], p.find);
  Object.assign(s.operations[1], p.lend);
  return s;
}

/** A small spec built from texts. */
function spec(given: string, state: [string, string, string], ops: [string, string, string][] = [], init?: [string, string, string]): SpecDoc {
  const doc = (id: string, role: SchemaDoc['role'], [name, decls, preds]: [string, string, string]): SchemaDoc => ({ id, role, name, decls, preds });
  return {
    topicId: 'test',
    title: 'Test',
    given,
    pools: {},
    state: doc('state', 'state', state),
    init: init ? doc('init', 'init', init) : null,
    operations: ops.map((o, i) => doc(`op-${i}`, 'operation', o)),
  };
}

const messages = (a: Analysis) => a.diagnostics.map((d) => d.message);
const fmt = (a: Analysis) => a.diagnostics.map((d) => `${d.section.schemaId}:${d.section.part} ${d.kind}/${d.severity} ${d.from}-${d.to}: ${d.message}`);

describe('Library', () => {
  const a = analyseSpec(LIB_WITH_LOANS);

  it('analyses without diagnostics', () => {
    expect(fmt(a)).toEqual([]);
    expect(a.ok).toBe(true);
    expect(a.givenSets).toEqual(['BOOK', 'MEMBER']);
    expect(a.stateName).toBe('Library');
    expect(a.stateVars).toEqual(['onLoan', 'borrower']);
    expect(a.schemas.map((s) => [s.id, s.ok])).toEqual([
      ['state', true],
      ['init', true],
      ['op-find', true],
      ['op-lend', true],
      ['op-loans', true],
    ]);
  });

  it('types the state variables', () => {
    const st = a.byId.state;
    expect(st.vars.map((v) => [v.name, v.role, typeToString(v.type), printTerm(v.declared)])).toEqual([
      ['onLoan', 'state', 'ℙ BOOK', 'ℙ BOOK'],
      ['borrower', 'state', 'ℙ (BOOK × MEMBER)', 'BOOK ⇸ MEMBER'],
    ]);
    expect(st.vars[1].section).toEqual({ schemaId: 'state', part: 'decls' });
    expect(st.vars[1].span).toEqual({ from: 16, to: 24 });
    expect(st.preds.map((p) => [p.origin, printTerm(p.term), p.index, p.ok])).toEqual([['own', 'onLoan = dom borrower', 0, true]]);
  });

  it('imports the unprimed state into Init', () => {
    const init = a.byId.init;
    expect(init.initImport).toBe('unprimed');
    expect(init.vars.map((v) => `${v.name}:${v.role}`)).toEqual(['onLoan:state', 'borrower:state']);
    expect(init.preds.map((p) => `${p.origin}: ${printTerm(p.term)}`)).toEqual(['own: onLoan = ∅', 'invariant: onLoan = dom borrower']);
    expect(init.preds[1].section).toEqual({ schemaId: 'state', part: 'preds' });
  });

  it('accepts Init importing the primed state', () => {
    const b = analyseSpec(lib({ init: { decls: 'Library′', preds: 'onLoan′ = ∅' } }));
    expect(fmt(b)).toEqual([]);
    const init = b.byId.init;
    expect(init.initImport).toBe('primed');
    expect(init.vars.map((v) => `${v.name}:${v.role}`)).toEqual(['onLoan′:state′', 'borrower′:state′']);
    expect(init.preds.map((p) => `${p.origin}: ${printTerm(p.term)}`)).toEqual(['own: onLoan′ = ∅', 'invariant′: onLoan′ = dom borrower′']);
  });

  it('FindBorrower: Ξ imports both states, the invariant twice and v′ = v', () => {
    const op = a.byId['op-find'];
    expect(op.imports).toBe('Ξ');
    expect(op.vars.map((v) => `${v.name}:${v.role}`)).toEqual([
      'onLoan:state',
      'borrower:state',
      'onLoan′:state′',
      'borrower′:state′',
      'book?:input',
      'member!:output',
    ]);
    const primed = op.vars.find((v) => v.name === 'borrower′')!;
    expect(printTerm(primed.declared)).toBe('BOOK ⇸ MEMBER');
    expect(primed.section).toEqual({ schemaId: 'state', part: 'decls' });
    expect(typeToString(op.vars.find((v) => v.name === 'member!')!.type)).toBe('MEMBER');
    expect(op.preds.map((p) => `${p.origin}: ${printTerm(p.term)}`)).toEqual([
      'own: book? ∈ onLoan',
      'own: member! = borrower(book?)',
      'invariant: onLoan = dom borrower',
      'invariant′: onLoan′ = dom borrower′',
      'xi: onLoan′ = onLoan',
      'xi: borrower′ = borrower',
    ]);
    expect(op.preds[1]).toMatchObject({ section: { schemaId: 'op-find', part: 'preds' }, index: 1, ok: true });
  });

  it('Lend: Δ imports both states and the invariant twice', () => {
    const op = a.byId['op-lend'];
    expect(op.imports).toBe('Δ');
    expect(op.vars.filter((v) => v.role === 'input').map((v) => v.name)).toEqual(['book?', 'member?']);
    expect(op.preds.map((p) => `${p.origin}: ${printTerm(p.term)}`)).toEqual([
      'own: book? ∉ onLoan',
      'own: borrower′ = borrower ∪ {book? ↦ member?}',
      'invariant: onLoan = dom borrower',
      'invariant′: onLoan′ = dom borrower′',
    ]);
  });

  it('LoansOf: comprehension output', () => {
    const op = a.byId['op-loans'];
    expect(op.vars.map((v) => `${v.name}:${v.role}`).slice(4)).toEqual(['member?:input', 'books!:output']);
    expect(typeToString(op.vars[5].type)).toBe('ℙ BOOK');
    const t = op.preds[0].term;
    expect(t.kind === 'rel' && typeToString(a.typeOf(t.right)!)).toBe('ℙ BOOK');
  });

  it('records the type of every sub-term', () => {
    const t = a.byId.state.preds[0].term;
    expect(a.typeOf(t)).toEqual({ k: 'bool' });
    if (t.kind !== 'rel') throw new Error();
    expect(typeToString(a.typeOf(t.right)!)).toBe('ℙ BOOK');
    // the primed invariant copies are typed as well
    const inv = a.byId['op-lend'].preds.find((p) => p.origin === 'invariant′')!.term;
    expect(inv.kind === 'rel' && typeToString(a.typeOf(inv.left)!)).toBe('ℙ BOOK');
  });
});

describe('scope diagnostics', () => {
  it('suggests a close name', () => {
    const a = analyseSpec(lib({ state: { preds: 'onLaon = dom borrower' } }));
    expect(fmt(a)).toEqual(['state:preds scope/error 0-6: Unknown name ‘onLaon’ — did you mean ‘onLoan’?']);
    expect(a.byId.state.ok).toBe(false);
    expect(a.byId['op-lend'].ok).toBe(false); // it imports the broken state
  });

  it('suggests the same name with another decoration', () => {
    expect(messages(analyseSpec(lib({ find: { preds: 'book ∈ onLoan\nmember! = borrower(member?)' } })))).toEqual([
      'Unknown name ‘book’ — did you mean ‘book?’?',
      'Unknown name ‘member?’ — did you mean ‘member!’?',
    ]);
  });

  it('explains unknown types and undeclared inputs', () => {
    expect(messages(analyseSpec(lib({ lend: { preds: 'x? ∈ onLoan\nTIME = TIME' } })))).toEqual([
      '‘x?’ is not declared — add ‘x? : …’ to the declarations.',
      'Unknown name ‘TIME’ — if it is a type, add it to the given sets [ … ].',
      'Unknown name ‘TIME’ — if it is a type, add it to the given sets [ … ].',
    ]);
  });

  it('rejects primed names in the state schema', () => {
    expect(messages(analyseSpec(lib({ state: { preds: 'onLoan′ = dom borrower' } })))).toEqual([
      '‘onLoan′’ is the after-state of ‘onLoan’; it only exists in operations (with Δ or Ξ). Here, write ‘onLoan’.',
    ]);
    const a = analyseSpec(lib({ state: { decls: 'onLoan′ : ℙ BOOK\nborrower : BOOK ⇸ MEMBER' } }));
    // no follow-up "unknown name ‘onLoan’" errors in the other schemas
    expect(fmt(a)).toEqual([
      'state:decls scope/error 0-7: State variables are declared without ′ — write ‘onLoan’. The after-state ‘onLoan′’ comes automatically with ‘ΔLibrary’ in operations.',
    ]);
  });

  it('rejects inputs and outputs in the state schema', () => {
    const a = analyseSpec(lib({ state: { decls: 'onLoan : ℙ BOOK\nborrower : BOOK ⇸ MEMBER\nmember? : MEMBER', preds: 'onLoan = dom borrower\nresult! = onLoan' } }));
    expect(messages(a)).toEqual([
      'Inputs (?) and outputs (!) belong in operations, not in the state schema — write ‘member’ for a state variable.',
      'Inputs and outputs (like ‘result!’) only exist in operations.',
    ]);
  });

  it('checks the name after Δ / Ξ', () => {
    const a = analyseSpec(spec('[PATIENT]', ['Ward', 'patients : ℙ PATIENT', ''], [['Admit', 'ΔFoo\np? : PATIENT', "patients′ = patients ∪ {p?}"]]));
    expect(fmt(a)).toEqual(['op-0:decls scope/error 0-4: The state schema is called ‘Ward’ — write ‘ΔWard’.']);
  });

  it('warns about an operation without Δ / Ξ and explains state names there', () => {
    const a = analyseSpec(lib({ lend: { decls: 'book? : BOOK\nmember? : MEMBER', preds: 'book? ∉ onLoan' } }));
    expect(fmt(a)).toEqual([
      'op-lend:decls scope/warning 0-12: Start with ‘ΔLibrary’ (the operation may change the state) or ‘ΞLibrary’ (the state stays the same).',
      'op-lend:preds scope/error 8-14: ‘onLoan’ belongs to the state — add ‘ΔLibrary’ or ‘ΞLibrary’ to the declarations to use it.',
    ]);
    expect(analyseSpec(lib({ lend: { decls: 'book? : BOOK', preds: 'book? = book?' } })).byId['op-lend'].ok).toBe(true); // only a warning
  });

  it('explains how the state is imported into Init', () => {
    expect(messages(analyseSpec(lib({ init: { decls: '', preds: 'onLoan = ∅' } })))).toEqual([
      'Start the declarations with the state schema name ‘Library’ to import the state.',
      'Import the state by writing ‘Library’ in the first line of the declarations.',
    ]);
    expect(messages(analyseSpec(lib({ init: { preds: 'onLoan′ = ∅' } })))).toEqual([
      'Init imports ‘Library’ (without ′), so write ‘onLoan’ here — or import ‘Library′’ instead.',
    ]);
    expect(messages(analyseSpec(lib({ init: { decls: 'Library′' } })))).toEqual([
      'Init imports ‘Library′’, so write ‘onLoan′’ here — or import ‘Library’ instead.',
    ]);
    expect(messages(analyseSpec(lib({ init: { decls: 'Libary' } })))).toEqual([
      'The state schema is called ‘Library’ — write ‘Library’ here.',
    ]);
    expect(messages(analyseSpec(lib({ init: { decls: 'ΔLibrary' } })))).toEqual([
      'Init describes the initial state: import it with ‘Library’ (or ‘Library′’), not with Δ.',
    ]);
  });

  it('rejects redeclaring state variables in operations', () => {
    expect(messages(analyseSpec(lib({ lend: { decls: 'ΔLibrary\nonLoan′ : ℙ BOOK\nborrower : BOOK ⇸ MEMBER\nbook? : BOOK\nmember? : BOOK' } })))).toEqual([
      '‘onLoan′’ is already part of ‘ΔLibrary’ — no need to declare it.',
      '‘borrower’ is already a state variable (from ‘ΔLibrary’).',
      '‘∪’ needs two sets of the same type, but ‘borrower’ is a relation BOOK ↔ MEMBER and ‘{book? ↦ member?}’ is a relation BOOK ↔ BOOK.',
    ]);
    expect(messages(analyseSpec(lib({ lend: { decls: 'Library\nbook? : BOOK\nmember? : MEMBER' } })))).toEqual([
      'In an operation, import the state with ‘ΔLibrary’ (it may change) or ‘ΞLibrary’ (it stays the same).',
    ]);
  });

  it('only allows types in declarations', () => {
    expect(messages(analyseSpec(lib({ lend: { decls: 'ΔLibrary\nbook? : onLoan\nmember? : MEMBER' } })))).toEqual([
      '‘onLoan’ is a variable, not a type. Declare book? with a type, ‘book? : BOOK’, and add ‘book? ∈ onLoan’ as a predicate.',
    ]);
    expect(messages(analyseSpec(lib({ state: { decls: 'onLoan : ℙ BOOK\nborrower : onLoan ⇸ MEMBER' } })))).toEqual([
      '‘onLoan’ is a variable, not a type. Declare borrower with a type, ‘borrower : BOOK ⇸ MEMBER’, and add ‘dom borrower ⊆ onLoan’ as a predicate.',
    ]);
  });

  it('spells out how to declare a type instead of a set built from variables', () => {
    const rail = (decls: string, preds = '') =>
      analyseSpec(
        spec('[TRAIN, BLOCK, SIGNAL]', ['Rail', 'at : TRAIN ⇸ BLOCK\ngreen : ℙ SIGNAL', ''], [['Move', `ΔRail\n${decls}`, preds]]),
      );
    expect(messages(rail('t? : dom at'))).toEqual([
      '‘at’ is a variable, not a type. Declare t? with a type, ‘t? : TRAIN’, and add ‘t? ∈ dom at’ as a predicate.',
    ]);
    expect(messages(rail('s? : SIGNAL ∖ green'))).toEqual([
      '‘green’ is a variable, not a type. Declare s? with a type, ‘s? : SIGNAL’, and add ‘s? ∈ SIGNAL ∖ green’ as a predicate.',
    ]);
    expect(messages(rail('b? : ran at′'))).toEqual([
      '‘at′’ is a variable, not a type. Declare b? with a type, ‘b? : BLOCK’, and add ‘b? ∈ ran at′’ as a predicate.',
    ]);
    expect(messages(rail('gs? : ℙ green'))).toEqual([
      '‘green’ is a variable, not a type. Declare gs? with a type, ‘gs? : ℙ SIGNAL’, and add ‘gs? ⊆ green’ as a predicate.',
    ]);
    expect(messages(rail('w! : dom at → ran at'))).toEqual([
      '‘at’ is a variable, not a type. Declare w! with a type, ‘w! : TRAIN ⇸ BLOCK’, and add ‘dom w! = dom at’ and ‘ran w! ⊆ ran at’ as predicates.',
    ]);
    expect(messages(rail('ts? : ℙ TRAIN\nt? : ts?'))).toEqual([
      '‘ts?’ is a variable, not a type. Declare t? with a type, ‘t? : TRAIN’, and add ‘t? ∈ ts?’ as a predicate.',
    ]);
    // the declared variable gets the type, so the predicates are checked as usual
    const msg = '‘at’ is a variable, not a type. Declare t? with a type, ‘t? : TRAIN’, and add ‘t? ∈ dom at’ as a predicate.';
    expect(messages(rail('t? : dom at\nb? : BLOCK', 'at′ = at ∪ {t? ↦ b?}'))).toEqual([msg]);
    expect(messages(rail('t? : dom at', 'green′ = green ∪ {t?}'))).toEqual([
      msg,
      '‘∪’ needs two sets of the same type, but ‘green’ is a set of SIGNAL and ‘{t?}’ is a set of TRAIN.',
    ]);

    const ward = spec('[PATIENT, DRUG]', ['Ward', 'patients : ℙ PATIENT\nallergic : patients ↔ DRUG', '']);
    expect(messages(analyseSpec(ward))).toEqual([
      '‘patients’ is a variable, not a type. Declare allergic with a type, ‘allergic : PATIENT ↔ DRUG’, and add ‘dom allergic ⊆ patients’ as a predicate.',
    ]);
    expect(analyseSpec(ward).ok).toBe(false);
  });

  it('reports duplicates and schema names used as values', () => {
    expect(messages(analyseSpec(lib({ given: '[BOOK, MEMBER, BOOK]' })))).toEqual(['‘BOOK’ is declared twice.']);
    expect(messages(analyseSpec(lib({ lend: { preds: 'Library' } })))).toEqual([
      '‘Library’ is a schema, not a variable (combining schemas is not part of this tutorial).',
    ]);
    expect(messages(analyseSpec(lib({ find: { decls: 'ΞLibrary\nbook? : BOOK\nbook? : BOOK\nmember! : MEMBER' } })))).toEqual([
      '‘book?’ is declared twice.',
    ]);
  });

  it('reports syntax errors with their section', () => {
    const a = analyseSpec(lib({ find: { preds: 'book? ∈ onLoan\nmember! = borrower(book?' } }));
    expect(fmt(a)).toEqual(['op-find:preds syntax/error 33-34: Missing ‘)’ to close this ‘(’']);
    // the other line is still there
    expect(a.byId['op-find'].preds.filter((p) => p.origin === 'own').map((p) => printTerm(p.term))).toEqual(['book? ∈ onLoan']);
    expect(a.byId['op-find'].ok).toBe(false);
  });
});

describe('type errors in student terms', () => {
  const lend = (preds: string) => messages(analyseSpec(lib({ lend: { preds } })));

  it('dom on a set', () => {
    expect(messages(analyseSpec(lib({ state: { preds: 'onLoan = dom onLoan' } })))).toEqual([
      'dom needs a relation (a set of pairs), but ‘onLoan’ is a set of BOOK.',
    ]);
  });

  it('membership in a relation', () => {
    expect(lend('book? ∉ borrower')).toEqual([
      '‘book?’ is a BOOK, but ‘borrower’ is a relation BOOK ↔ MEMBER (its elements are pairs). Did you mean ‘book? ∉ dom borrower’?',
    ]);
    expect(lend('member? ∈ borrower')).toEqual([
      '‘member?’ is a MEMBER, but ‘borrower’ is a relation BOOK ↔ MEMBER (its elements are pairs). Did you mean ‘member? ∈ ran borrower’?',
    ]);
    expect(lend('member? ∈ onLoan')).toEqual(['‘member?’ is a MEMBER, but ‘onLoan’ is a set of BOOK.']);
  });

  it('missing braces', () => {
    expect(lend('borrower′ = borrower ∪ (book? ↦ member?)')).toEqual([
      '‘∪’ needs a set on both sides, but ‘book? ↦ member?’ is a pair BOOK ↦ MEMBER. Did you mean ‘{book? ↦ member?}’?',
    ]);
    expect(lend('onLoan′ = onLoan ∪ book?')).toEqual(['‘∪’ needs a set on both sides, but ‘book?’ is a BOOK. Did you mean ‘{book?}’?']);
    expect(lend('onLoan′ = book?')).toEqual([
      'Both sides of ‘=’ must have the same type, but ‘onLoan′’ is a set of BOOK and ‘book?’ is a BOOK. Did you mean ‘{book?}’?',
    ]);
    expect(lend('book? = onLoan')).toEqual([
      'Both sides of ‘=’ must have the same type, but ‘book?’ is a BOOK and ‘onLoan’ is a set of BOOK. Did you mean ‘book? ∈ onLoan’?',
    ]);
  });

  it('wrong argument, wrong function, values as predicates', () => {
    expect(lend('member? = borrower(member?)')).toEqual(['‘borrower’ expects a BOOK as argument, but ‘member?’ is a MEMBER.']);
    expect(lend('member? = onLoan(book?)')).toEqual([
      '‘onLoan’ is a set of BOOK, not a function, so it cannot be applied to ‘book?’.',
    ]);
    expect(lend('borrower(book?)\nonLoan')).toEqual([
      '‘borrower(book?)’ is a value (a MEMBER), not a predicate — compare it with something, e.g. ‘… = …’ or ‘… ∈ …’.',
      '‘onLoan’ is a value (a set of BOOK), not a predicate — compare it with something, e.g. ‘… = …’ or ‘… ∈ …’.',
    ]);
    expect(lend('onLoan = (book? ∈ onLoan)')).toEqual(['‘book? ∈ onLoan’ is a predicate (true or false), not a value.']);
  });

  it('numbers', () => {
    expect(lend('#onLoan < book?\n#book? = 1\nonLoan + 1 = 2')).toEqual([
      '‘<’ compares numbers, but ‘book?’ is a BOOK.',
      '# counts the elements of a set, but ‘book?’ is a BOOK.',
      '‘+’ needs numbers, but ‘onLoan’ is a set of BOOK.',
    ]);
  });

  it('subsets, sets of mixed elements, declarations', () => {
    expect(lend('book? ⊆ onLoan\n{book?, member?} = onLoan\n∀ b : book? • b ∈ onLoan')).toEqual([
      '‘⊆’ compares two sets, but ‘book?’ is a BOOK. Did you mean ‘∈’?',
      'All elements of a set must have the same type, but ‘book?’ is a BOOK and ‘member?’ is a MEMBER.',
      'After ‘:’ comes a set (a type like NAME or ℙ NAME), but ‘book?’ is a BOOK.',
    ]);
  });

  it('does not cascade after an unknown name', () => {
    expect(lend('dom (borrowr ∪ {book? ↦ member?}) = onLoan ∪ {book?}')).toEqual(['Unknown name ‘borrowr’ — did you mean ‘borrower’?']);
  });

  it('does not add follow-up errors about erroneous operands', () => {
    const state = (preds: string) => messages(analyseSpec(lib({ state: { preds: `onLoan = dom borrower\n${preds}` } })));
    expect(state('onLoan = {Dune, 1}')).toEqual(['Unknown name ‘Dune’.']);
    expect(state('onLoan = Dune .. 3')).toEqual(['Unknown name ‘Dune’.']);
    expect(state('onLoan = {Dune .. 3}')).toEqual(['Unknown name ‘Dune’.']);
    expect(state('#onLoan = #{Dune} + Emma')).toEqual(['Unknown name ‘Dune’.', 'Unknown name ‘Emma’.']);
    expect(state('borrower(Dune) = onLoan')).toEqual(['Unknown name ‘Dune’.']);
    // an error inside an operand does not hide errors elsewhere
    expect(state('onLoan = {Dune}\n#onLoan = onLoan')).toEqual([
      'Unknown name ‘Dune’.',
      'Both sides of ‘=’ must have the same type, but ‘#onLoan’ is a number and ‘onLoan’ is a set of BOOK.',
    ]);
    // a declaration with an unknown element keeps its other errors to itself
    const a = analyseSpec(lib({ state: { decls: 'onLoan : ℙ BOOK\nborrower : BOOK ⇸ MEMBER\nx : {Dune, 1}', preds: 'onLoan = dom borrower\nx ∈ onLoan' } }));
    expect(messages(a)).toEqual(['Unknown name ‘Dune’.']);
  });

  it('infers the type of ∅', () => {
    expect(lend('borrower′ = ∅\nonLoan = ∅ ∪ {book?}\n∅ = ∅')).toEqual([]);
    expect(lend('onLoan = {member?} ∪ ∅')).toEqual([
      'Both sides of ‘=’ must have the same type, but ‘onLoan’ is a set of BOOK and ‘{member?} ∪ ∅’ is a set of MEMBER.',
    ]);
  });
});

describe('realistic specifications', () => {
  it('bank: integers, negation, application by juxtaposition', () => {
    const a = analyseSpec(
      spec(
        '[ACCOUNT, CUSTOMER]',
        ['Bank', 'owner : ACCOUNT ⇸ CUSTOMER\nbalance : ACCOUNT ⇸ ℤ\noverdraft : ACCOUNT ⇸ ℕ', 'dom balance = dom owner\ndom overdraft = dom owner\n∀ a : dom balance • balance(a) ≥ -overdraft(a)'],
        [
          ['Deposit', 'ΔBank\na? : ACCOUNT\namount? : ℕ₁', 'a? ∈ dom balance\nbalance′ = balance ∖ {a? ↦ balance a?} ∪ {a? ↦ balance a? + amount?}\nowner′ = owner\noverdraft′ = overdraft'],
          ['Enquiry', 'ΞBank\na? : ACCOUNT\nb! : ℤ', 'a? ∈ dom balance\nb! = balance a?'],
        ],
        ['InitBank', 'Bank′', 'owner′ = ∅\nbalance′ = ∅\noverdraft′ = ∅'],
      ),
    );
    expect(fmt(a)).toEqual([]);
    expect(typeToString(a.byId.state.vars[1].type)).toBe('ℙ (ACCOUNT × ℤ)');
    expect(a.byId['op-0'].vars.find((v) => v.name === 'amount?')).toMatchObject({ role: 'input', type: { k: 'int' } });
  });

  it('medication: nested functions, comprehension; ⊕ and ⦇⦈ are out of scope', () => {
    const prescribe = 'p? ∈ patients\nrx′ = rx ⊕ {p? ↦ {d? ↦ dose?}}\n∀ p : patients • prescribed⦇{p}⦈ = ∅\nprescribed′ = prescribed';
    const a = analyseSpec(
      spec(
        '[PATIENT, DRUG]',
        ['Ward', 'patients : ℙ PATIENT\nprescribed : PATIENT ↔ DRUG\nrx : PATIENT ⇸ (DRUG ⇸ ℕ₁)', 'dom prescribed ⊆ patients\ndom rx = patients\n∀ p : patients; d : dom (rx p) • (rx p) d ≤ 1000'],
        [
          ['View', 'ΞWard\np? : PATIENT\ncurrent! : ℙ DRUG', 'p? ∈ patients\ncurrent! = { d ∈ DRUG | (p? ↦ d) ∈ prescribed }'],
          ['Prescribe', 'ΔWard\np? : PATIENT\nd? : DRUG\ndose? : ℕ₁', prescribe],
        ],
      ),
    );
    const at = (s: string) => `${prescribe.indexOf(s)}-${prescribe.indexOf(s) + 1}`;
    expect(fmt(a)).toEqual([
      `op-1:preds syntax/error ${at('⊕')}: ‘⊕’ (override) is not part of this tutorial — use ∪ and ∖ instead`,
      `op-1:preds syntax/error ${at('⦇')}: ‘⦇ ⦈’ (relational image) is not part of this tutorial — use a set comprehension, e.g. { y : Y | (x ↦ y) ∈ R }`,
    ]);
    expect(a.byId['op-0'].ok).toBe(true);
    expect(a.byId['op-1'].ok).toBe(false);
    expect(a.byId['op-1'].preds.filter((p) => p.origin === 'own').map((p) => [printTerm(p.term), p.index])).toEqual([
      ['p? ∈ patients', 0],
      ['prescribed′ = prescribed', 3],
    ]);
    expect(typeToString(a.byId.state.vars[2].type, { relations: true })).toBe('PATIENT ↔ DRUG ↔ ℤ');
  });

  it('voting: cardinality of a comprehension; railway: ⩤ is out of scope', () => {
    const v = analyseSpec(
      spec('[VOTER, CANDIDATE]', ['Election', 'registered : ℙ VOTER\nballot : VOTER ⇸ CANDIDATE', 'dom ballot ⊆ registered\n#{ v ∈ registered | v ∈ dom ballot } ≤ #registered']),
    );
    expect(fmt(v)).toEqual([]);
    const r = analyseSpec(spec('[TRAIN, BLOCK]', ['Line', 'at : TRAIN ⇸ BLOCK', ''], [['Leave', 'ΔLine\nt? : TRAIN', 't? ∈ dom at\nat′ = {t?} ⩤ at']]));
    expect(messages(r)).toEqual(['‘⩤’ (domain subtraction) is not part of this tutorial — use ∖ or a set comprehension instead']);
  });
});

describe('importing the state as ‘S’ and ‘S′’', () => {
  const lend = (decls: string): SpecDoc => {
    const s = structuredClone(LIBRARY);
    s.operations[1].decls = decls;
    return s;
  };
  const delta = lend('ΔLibrary\nbook? : BOOK\nmember? : MEMBER');

  it('is exactly ΔS: same analysis, examples and inference', () => {
    for (const decls of ['Library\nLibrary′\nbook? : BOOK\nmember? : MEMBER', 'book? : BOOK\nLibrary′\nmember? : MEMBER\nLibrary']) {
      const two = lend(decls);
      const a = analyseSpec(two);
      const b = analyseSpec(delta);
      expect(fmt(a)).toEqual([]);
      const op = a.byId['op-lend'];
      const ref = b.byId['op-lend'];
      expect(op.imports).toBe('Δ');
      expect(op.ok).toBe(true);
      expect(op.vars.map((v) => `${v.name}:${v.role}:${typeToString(v.type)}`)).toEqual(ref.vars.map((v) => `${v.name}:${v.role}:${typeToString(v.type)}`));
      expect(op.preds.map((p) => `${p.origin}: ${printTerm(p.term)}`)).toEqual(ref.preds.map((p) => `${p.origin}: ${printTerm(p.term)}`));
      for (const seed of [1, 2, 3]) {
        expect(exampleOperation(two, a, 'op-lend', seed, 'applicable')).toEqual(exampleOperation(delta, b, 'op-lend', seed, 'applicable'));
      }
      expect(JSON.stringify(infer(two, a))).toBe(JSON.stringify(infer(delta, b)));
    }
  });

  it('explains a lone or doubled import', () => {
    expect(messages(analyseSpec(lend('Library′\nbook? : BOOK\nmember? : MEMBER')))).toEqual(['Write ‘ΔLibrary’ to import the state before and after.']);
    expect(messages(analyseSpec(lend('Library\nbook? : BOOK\nmember? : MEMBER')))).toEqual([
      'In an operation, import the state with ‘ΔLibrary’ (it may change) or ‘ΞLibrary’ (it stays the same).',
    ]);
    expect(messages(analyseSpec(lend('ΔLibrary\nLibrary\nLibrary′\nbook? : BOOK\nmember? : MEMBER')))).toEqual([
      '‘Library’ and ‘Library′’ together already mean ‘ΔLibrary’ — remove one of the imports.',
    ]);
    expect(messages(analyseSpec(lend('Library\nLibrary′\nLibrary′\nbook? : BOOK\nmember? : MEMBER')))).toEqual(['The state is already imported.']);
  });
});

describe('names from outside the tutorial', () => {
  const lendPreds = (preds: string) => {
    const s = structuredClone(LIBRARY);
    s.operations[1].preds = preds;
    return messages(analyseSpec(s));
  };

  it('explains seq, min, max, succ and ASCII number sets', () => {
    expect(lendPreds('#onLoan < max onLoan')).toEqual(['‘max’ is not part of this tutorial — say it with ∀, e.g. m ∈ S ∧ (∀ x ∈ S . x ≤ m).']);
    expect(lendPreds('#onLoan = min(onLoan)')).toEqual(['‘min’ is not part of this tutorial — say it with ∀, e.g. m ∈ S ∧ (∀ x ∈ S . m ≤ x).']);
    expect(lendPreds('#onLoan′ = succ(#onLoan)')).toEqual(['‘succ’ is not part of this tutorial — write ‘n + 1’.']);
    expect(lendPreds('#onLoan ∈ N')).toEqual(['Unknown name ‘N’ — did you mean ℕ (type NN)?']);
    expect(lendPreds('#onLoan ∈ ZZ')).toEqual(['Unknown name ‘ZZ’ — did you mean ℤ (type ZZ and a space)?']);
    const s = structuredClone(LIBRARY);
    s.state.decls += '\nqueue : seq MEMBER';
    expect(messages(analyseSpec(s))).toEqual(['Sequences (‘seq’, ‘⟨ ⟩’) are not part of this tutorial.']);
  });

  it('a declared variable called max is fine', () => {
    const s = structuredClone(LIBRARY);
    s.state.decls += '\nmax : ℕ';
    s.state.preds += '\n#onLoan ≤ max';
    expect(messages(analyseSpec(s))).toEqual([]);
  });
});

describe('declarations with ∅', () => {
  const withX = (type: string, preds = '') =>
    analyseSpec(lib({ state: { decls: `onLoan : ℙ BOOK\nborrower : BOOK ⇸ MEMBER\nx : ${type}`, preds: `onLoan = dom borrower${preds}` } }));

  it('reports an empty set as a type', () => {
    for (const t of ['∅', '{}']) {
      const a = withX(t, '\nx = 1');
      expect(fmt(a), t).toEqual([
        `state:decls type/error 45-${45 + t.length}: ‘∅’ is the empty set, so this variable could never have a value. After ‘:’ comes a type like NAME or ℙ NAME.`,
      ]);
      expect(a.ok).toBe(false);
    }
    expect(messages(withX('ℙ ∅', '\nx = 1'))).toEqual([
      '‘ℙ ∅’ does not tell the type (∅ could be a set of anything). After ‘:’ comes a type like NAME or ℙ NAME.',
    ]);
    expect(messages(withX('∅ ⇸ BOOK'))).toHaveLength(1);
    const op = lib({ lend: { decls: 'ΔLibrary\nbook? : BOOK\nmember? : ∅' } });
    expect(messages(analyseSpec(op))).toEqual([
      '‘∅’ is the empty set, so this variable could never have a value. After ‘:’ comes a type like NAME or ℙ NAME.',
    ]);
  });

  it('keeps ∅ in quantifiers and comprehensions', () => {
    expect(messages(withX('ℙ BOOK', '\nx = { b ∈ ∅ | b ∈ onLoan }\n∀ b ∈ ∅ . b ∈ x'))).toEqual([]);
  });

  it('never mixes up the unknown types of different checkers', () => {
    const empty = parseTerm('∅').term!;
    const tc1 = new TypeChecker({ section: { schemaId: 'x', part: 'preds' } });
    const tc2 = new TypeChecker({ section: { schemaId: 'x', part: 'preds' } });
    const t1 = tc1.checkExpression(empty, new Map());
    const t2 = tc2.checkExpression(empty, new Map());
    expect(t1).toMatchObject({ k: 'power', elem: { k: 'var' } });
    expect(t2).toMatchObject({ k: 'power', elem: { k: 'var' } });
    expect(t1).not.toEqual(t2);
  });
});

describe('a!=b', () => {
  it('means ≠ where there is no output a!', () => {
    const a = analyseSpec(lib({ state: { decls: 'onLoan : ℙ BOOK\nborrower : BOOK ⇸ MEMBER\na : BOOK\nb : BOOK', preds: 'onLoan = dom borrower\na!=b' } }));
    expect(fmt(a)).toEqual(['state:preds syntax/error 23-25: Write ‘≠’ (or ‘/=’) for “not equal”: ‘a ≠ b’.']);
    const lend = (preds: string, decls = 'ΔLibrary\nbook? : BOOK\nmember? : MEMBER') => messages(analyseSpec(lib({ lend: { decls, preds } })));
    expect(lend('book? ∉ onLoan\nborrower′ = borrower ∪ {book? ↦ member?}\nonLoan!= ∅')).toEqual([
      'Write ‘≠’ (or ‘/=’) for “not equal”: ‘onLoan ≠ ∅’.',
    ]);
  });

  it('is x! = … in an operation with the output x!', () => {
    const decls = 'ΞLibrary\nbook? : BOOK\nonLoan! : ℙ BOOK';
    const s = lib({ find: { decls, preds: 'onLoan!=onLoan' } });
    expect(messages(analyseSpec(s))).toEqual([]);
  });

  it('keeps the message for outputs in the state schema', () => {
    expect(messages(analyseSpec(lib({ state: { preds: 'onLoan = dom borrower\nout! = onLoan' } })))).toEqual([
      'Inputs and outputs (like ‘out!’) only exist in operations.',
    ]);
  });
});

describe('names that are also JavaScript properties', () => {
  it('are plain names', () => {
    const a = analyseSpec({ ...structuredClone(LIBRARY), given: '[BOOK, MEMBER, constructor]' });
    expect(fmt(a)).toEqual([]);
    const b = analyseSpec(lib({ state: { preds: 'onLoan = dom borrower\ntoString = 1\nhasOwnProperty ∈ onLoan' } }));
    expect(messages(b)).toEqual(['Unknown name ‘toString’.', 'Unknown name ‘hasOwnProperty’.']);
    expect(b.diagnostics.every((d) => typeof d.message === 'string')).toBe(true);
  });
});

describe('given sets', () => {
  it('warns about N, Z and R', () => {
    const a = analyseSpec({ ...structuredClone(LIBRARY), given: '[BOOK, MEMBER, N, Z, R]' });
    expect(fmt(a)).toEqual([
      'types:given scope/warning 15-16: Did you mean ℕ (type NN)? ‘N’ is declared here as a new given set.',
      'types:given scope/warning 18-19: Did you mean ℤ (type ZZ)? ‘Z’ is declared here as a new given set.',
      'types:given scope/warning 21-22: Real numbers are not part of this tutorial — did you mean ℤ (type ZZ)? ‘R’ is declared here as a new given set.',
    ]);
    expect(a.ok).toBe(true); // warnings only
  });

  it('defines every name it can read', () => {
    const a = analyseSpec({ ...structuredClone(LIBRARY), given: '[BOOK MEMBER]' });
    expect(a.givenSets).toEqual(['BOOK', 'MEMBER']);
    expect(messages(a)).toEqual(['Separate the names with ‘,’']);
    expect(analyseSpec({ ...structuredClone(LIBRARY), given: '[BOOK, MEMBER, ℕ]' }).givenSets).toEqual(['BOOK', 'MEMBER']);
  });
});

describe('frame convention and pointwise updates', () => {
  const bank = referenceSpecOf('bank-account')!;
  const withdraw = (f: (preds: string) => string): SpecDoc => {
    const s = structuredClone(bank);
    const w = s.operations.find((o) => o.name === 'Withdraw')!;
    w.preds = f(w.preds);
    return s;
  };
  const frameOf = (s: SpecDoc) =>
    analyseSpec(s)
      .byId['op-withdraw'].preds.filter((p) => p.origin === 'frame')
      .map((p) => printTerm(p.term));
  const noFrameLines = (p: string) => p.replace('\nowner′ = owner', '').replace('\noverdraft′ = overdraft', '');

  it('adds v′ = v for state variables the Δ operation does not mention', () => {
    expect(frameOf(bank)).toEqual([]);
    expect(frameOf(withdraw(noFrameLines))).toEqual(['owner′ = owner', 'overdraft′ = overdraft']);
    // a line that does not parse yet still counts as mentioning owner′
    expect(frameOf(withdraw((p) => noFrameLines(p) + '\nowner′ = owner ∪'))).toEqual(['overdraft′ = overdraft']);
    // Ξ operations have their own v′ = v; only Δ gets the frame
    expect(analyseSpec(bank).byId['op-query-balance'].preds.filter((p) => p.origin === 'frame')).toEqual([]);
  });

  it('does not freeze what the invariant determines (onLoan′ = dom borrower′)', () => {
    expect(analyseSpec(LIBRARY).byId['op-lend'].preds.filter((p) => p.origin === 'frame')).toEqual([]);
  });

  it('shows unmentioned variables as unchanged in examples', () => {
    const s = withdraw(noFrameLines);
    const ex = exampleOperation(s, analyseSpec(s), 'op-withdraw', 1, 'applicable');
    if (!ex.ok) throw new Error(ex.message);
    expect(ex.after.map((v) => `${v.name}:${v.status}`)).toEqual(['owner′:unchanged', 'balance′:computed', 'overdraft′:unchanged']);
  });

  it('warns when a function is only fixed at one point', () => {
    const pointwise = withdraw((p) => p.replace(/^balance′ = .*$/m, 'balance′(a?) = balance(a?) - amount?'));
    const a = analyseSpec(pointwise);
    const warnings = a.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings.map((d) => d.message)).toEqual([
      'This only fixes balance′(a?). Other values of balance′ could change too — say what happens to the whole function, e.g. ‘balance′ = …’.',
    ]);
    const doc = pointwise.operations.find((o) => o.name === 'Withdraw')!;
    expect(doc.preds.slice(warnings[0].from, warnings[0].to)).toBe('balance′(a?) = balance(a?) - amount?');
    expect(a.ok).toBe(true); // valid Z: only a warning
    // the standard meaning: no frame for balance, and the other values are open
    expect(a.byId['op-withdraw'].preds.filter((p) => p.origin === 'frame').map((p) => printTerm(p.term))).toEqual([]);
    const ex = exampleOperation(pointwise, a, 'op-withdraw', 1, 'applicable');
    expect(ex.ok && ex.after.find((v) => v.name === 'balance′')?.status).toBe('free');
  });

  it('does not warn for whole-function updates', () => {
    expect(analyseSpec(bank).diagnostics).toEqual([]);
    const both = withdraw((p) => p.replace(/^balance′ = .*$/m, 'balance′(a?) = balance(a?) - amount?\ndom balance′ = dom balance'));
    expect(analyseSpec(both).diagnostics).toEqual([]);
  });
});

describe('TypeChecker directly', () => {
  const scope: Scope = new Map([
    ['NAME', { kind: 'given', type: power(given('NAME')) }],
    ['f', { kind: 'var', type: relation(given('NAME'), INT) }],
  ]);
  it('returns expression types', () => {
    const tc = new TypeChecker({ section: { schemaId: 'x', part: 'preds' } });
    const ty = (s: string) => typeToString(tc.checkExpression(parseTerm(s).term!, scope), { relations: true });
    expect(ty('f')).toBe('NAME ↔ ℤ');
    expect(ty('NAME ⇸ ℕ')).toBe('ℙ (NAME ↔ ℤ)');
    expect(ty('{ n : NAME • f(n) + 1 }')).toBe('ℙ ℤ');
    expect(ty('{ n : NAME; m : ℕ | f(n) = m }')).toBe('NAME ↔ ℤ');
    expect(ty('(1, ∅)')).toBe('ℤ × ℙ ?');
    expect(ty('dom f × ran f')).toBe('NAME ↔ ℤ');
    expect(ty('2 + 3')).toBe('ℤ');
    expect(tc.errorCount).toBe(0);
  });
  it('describes types in words', () => {
    expect(describeType(relation(given('NAME'), given('DATE')))).toBe('a relation NAME ↔ DATE');
    expect(describeType(given('ACCOUNT'))).toBe('an ACCOUNT');
    expect(describeType(given('UNIT'))).toBe('a UNIT');
    expect(describeType(power(INT))).toBe('a set of numbers');
  });
});
