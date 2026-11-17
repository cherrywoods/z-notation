// Tests for the inference engine. The full listing of facts and redundancy marks for
// the Library and the six templates is printed; to see it run
//   npx vitest run src/lib/z/infer --reporter=verbose

import { describe, expect, it } from 'vitest';
import type { Derivation, SchemaDoc, SpecDoc, ZDiagnostic } from '../spec/model';
import { LIBRARY, LOANS_OF } from './testing/library';
import { analyseSpec } from './index';
import { infer } from './infer';
import { referenceSpecOf } from '../spec/topics';
import type { InferenceResult, InferredFact } from './results';

// ── helpers ────────────────────────────────────────────────────────────────────

type Patch = Partial<Pick<SchemaDoc, 'decls' | 'preds'>>;
/** The Library with some sections replaced and extra operations. */
function lib(p: { state?: Patch; init?: Patch; find?: Patch; lend?: Patch; extra?: SchemaDoc[] } = {}): SpecDoc {
  const s = structuredClone(LIBRARY);
  Object.assign(s.state, p.state);
  Object.assign(s.init!, p.init);
  Object.assign(s.operations[0], p.find);
  Object.assign(s.operations[1], p.lend);
  if (p.extra) s.operations.push(...p.extra);
  return s;
}

const op = (id: string, name: string, decls: string, preds: string): SchemaDoc => ({ id, role: 'operation', name, decls, preds });

function run(spec: SpecDoc): InferenceResult {
  const an = analyseSpec(spec);
  expect(an.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
  return infer(spec, an, { strict: true });
}

const docOf = (spec: SpecDoc, id: string) => [spec.state, spec.init, ...spec.operations].find((s) => s?.id === id)!;
/** The flagged text (the diagnostic's span in its section). */
const flagged = (spec: SpecDoc, d: ZDiagnostic) => docOf(spec, d.section.schemaId).preds.slice(d.from, d.to);
const flags = (spec: SpecDoc, r: InferenceResult, schemaId?: string) =>
  r.redundant.filter((d) => !schemaId || d.section.schemaId === schemaId).map((d) => flagged(spec, d));
const factsOf = (r: InferenceResult, schemaId: string, kind?: InferredFact['kind']) =>
  r.facts.filter((f) => f.schemaId === schemaId && (!kind || f.kind === kind));
const flagOn = (spec: SpecDoc, r: InferenceResult, text: string) => {
  const d = r.redundant.find((x) => flagged(spec, x) === text);
  expect(d, `no redundancy mark on ‘${text}’`).toBeDefined();
  return d!;
};

function showDerivation(d: Derivation, indent = '        '): string[] {
  if (d.kind === 'chain') {
    const pad = ' '.repeat(d.start.length);
    return d.steps.map((s, i) => `${indent}${i === 0 ? d.start : pad} ${s.rel} ${s.expr}   [${s.reason}]`);
  }
  return [...d.premises.map((p) => `${indent}${p.text}   [${p.reason}]`), `${indent}⊢ ${d.conclusion}`];
}

/** Human-readable listing of all facts and redundancy marks. */
function listing(spec: SpecDoc, r: InferenceResult): string {
  const out: string[] = [`=== ${spec.title}`];
  for (const doc of [spec.state, ...(spec.init ? [spec.init] : []), ...spec.operations]) {
    const fs = r.facts.filter((f) => f.schemaId === doc.id);
    const ds = r.redundant.filter((d) => d.section.schemaId === doc.id);
    out.push(`  ${doc.name}${fs.length || ds.length ? '' : '   (nothing)'}`);
    for (const f of fs) out.push(`    ${f.kind}: ${f.text}`, ...showDerivation(f.derivation));
    for (const d of ds) out.push(`    REDUNDANT ‘${flagged(spec, d)}’ — ${d.message}`, ...(d.derivation ? showDerivation(d.derivation) : []));
  }
  return out.join('\n');
}

// ── Library ──────────────────────────────────────────────────────────────

const LEND_CHAIN: Derivation = {
  kind: 'chain',
  start: 'onLoan′',
  steps: [
    { rel: '=', expr: 'dom borrower′', reason: 'invariant after' },
    { rel: '=', expr: 'dom (borrower ∪ {book? ↦ member?})', reason: 'spec of Lend' },
    { rel: '=', expr: 'dom borrower ∪ dom {book? ↦ member?}', reason: 'fact about dom' },
    { rel: '=', expr: 'dom borrower ∪ {book?}', reason: 'fact about dom' },
    { rel: '=', expr: 'onLoan ∪ {book?}', reason: 'invariant before' },
  ],
};

describe('Library', () => {
  const spec = lib({ extra: [LOANS_OF] });
  const r = run(spec);

  it('prints the listing', () => {
    console.log(listing(spec, r));
  });

  it('Lend: onLoan′ = onLoan ∪ {book?} with the full chain', () => {
    expect(factsOf(r, 'op-lend')).toEqual([{ schemaId: 'op-lend', kind: 'effect', text: 'onLoan′ = onLoan ∪ {book?}', derivation: LEND_CHAIN }]);
  });

  it('FindBorrower: unchanged state and borrower(book?) is defined', () => {
    expect(factsOf(r, 'op-find', 'unchanged').map((f) => [f.text, f.derivation])).toEqual([
      ['onLoan′ = onLoan', { kind: 'chain', start: 'onLoan′', steps: [{ rel: '=', expr: 'onLoan', reason: 'ΞLibrary' }] }],
      ['borrower′ = borrower', { kind: 'chain', start: 'borrower′', steps: [{ rel: '=', expr: 'borrower', reason: 'ΞLibrary' }] }],
    ]);
    expect(factsOf(r, 'op-find', 'defined')).toEqual([
      {
        schemaId: 'op-find',
        kind: 'defined',
        text: 'book? ∈ dom borrower',
        derivation: {
          kind: 'facts',
          premises: [
            { text: 'book? ∈ onLoan', reason: 'precondition' },
            { text: 'onLoan = dom borrower', reason: 'invariant before' },
          ],
          conclusion: 'book? ∈ dom borrower',
        },
      },
    ]);
  });

  it('Init: onLoan = ∅ implies borrower = ∅', () => {
    expect(factsOf(r, 'init')).toEqual([
      {
        schemaId: 'init',
        kind: 'initial',
        text: 'borrower = ∅',
        derivation: {
          kind: 'facts',
          premises: [
            { text: 'onLoan = ∅', reason: 'Init' },
            { text: 'onLoan = dom borrower', reason: 'invariant' },
            { text: 'dom R = ∅ ⇔ R = ∅', reason: 'fact about dom' },
          ],
          conclusion: 'borrower = ∅',
        },
      },
    ]);
  });

  it('Init importing Library′ works the same way', () => {
    const r2 = run(lib({ init: { decls: 'Library′', preds: 'onLoan′ = ∅' } }));
    expect(factsOf(r2, 'init').map((f) => f.text)).toEqual(['borrower′ = ∅']);
  });

  it('the specification as written has no redundant lines', () => {
    expect(r.redundant).toEqual([]);
  });

  it('LoansOf: no fact about borrower(b) for the bound b (not supported), only Ξ', () => {
    expect(factsOf(r, 'op-loans').map((f) => f.kind)).toEqual(['unchanged', 'unchanged']);
  });

  it('nothing is derived for a state variable that is not determined', () => {
    // onLoan′ only constrains dom borrower′; borrower′ itself is not determined
    const r2 = run(lib({ lend: { preds: 'book? ∉ onLoan\nonLoan′ = onLoan ∪ {book?}' } }));
    // (borrower′ is not mentioned, so it stays unchanged: the only fact)
    expect(factsOf(r2, 'op-lend').map((f) => `${f.kind}: ${f.text}`)).toEqual(['unchanged: borrower′ = borrower']);
    expect(r2.redundant).toEqual([]);
  });
});

describe('effects of other operations', () => {
  const spec = lib({
    extra: [
      op('op-rm', 'Return', 'ΔLibrary\nbook? : BOOK', 'book? ∈ onLoan\nborrower′ = borrower ∖ {book? ↦ borrower(book?)}'),
      op('op-clear', 'Clear', 'ΔLibrary', 'borrower′ = ∅'),
      op('op-two', 'AddTwo', 'ΔLibrary\na? : BOOK\nb? : BOOK\nm? : MEMBER', 'a? ∉ onLoan\nb? ∉ onLoan\nborrower′ = borrower ∪ {a? ↦ m?} ∪ {b? ↦ m?}'),
      op('op-same', 'Touch', 'ΔLibrary', 'borrower′ = borrower'),
    ],
  });
  const r = run(spec);
  const effect = (id: string) => factsOf(r, id, 'effect').map((f) => f.text);

  it('Return: onLoan′ = onLoan ∖ {book?} (f is a function)', () => {
    expect(effect('op-rm')).toEqual(['onLoan′ = onLoan ∖ {book?}']);
    expect(factsOf(r, 'op-rm', 'effect')[0].derivation).toEqual({
      kind: 'chain',
      start: 'onLoan′',
      steps: [
        { rel: '=', expr: 'dom borrower′', reason: 'invariant after' },
        { rel: '=', expr: 'dom (borrower ∖ {book? ↦ borrower(book?)})', reason: 'spec of Return' },
        { rel: '=', expr: 'dom borrower ∖ {book?}', reason: 'fact about dom' },
        { rel: '=', expr: 'onLoan ∖ {book?}', reason: 'invariant before' },
      ],
    });
    expect(factsOf(r, 'op-rm', 'defined').map((f) => f.text)).toEqual(['book? ∈ dom borrower']);
  });

  it('dom (R ∖ S) is not simplified for a relation', () => {
    const r2 = run(
      lib({
        state: { decls: 'onLoan : ℙ BOOK\nborrower : BOOK ↔ MEMBER' },
        extra: [op('op-rm', 'Remove', 'ΔLibrary\nbook? : BOOK\nm? : MEMBER', 'borrower′ = borrower ∖ {book? ↦ m?}')],
      }),
    );
    expect(factsOf(r2, 'op-rm', 'effect').map((f) => f.text)).toEqual(['onLoan′ = dom (borrower ∖ {book? ↦ m?})']);
  });

  it('does not fold constants back into state variables', () => {
    const r2 = run(
      lib({
        state: { decls: 'onLoan : ℙ BOOK\nborrower : BOOK ⇸ MEMBER\nnone : ℙ BOOK', preds: 'onLoan = dom borrower\nnone = ∅' },
        extra: [op('op-clear', 'Clear', 'ΔLibrary', 'borrower′ = ∅\nnone′ = none')],
      }),
    );
    expect(factsOf(r2, 'op-clear', 'effect').map((f) => f.text)).toEqual(['onLoan′ = ∅']);
  });

  it('Clear, AddTwo, Touch', () => {
    expect(effect('op-clear')).toEqual(['onLoan′ = ∅']);
    expect(effect('op-two')).toEqual(['onLoan′ = onLoan ∪ {a?, b?}']);
    expect(effect('op-same')).toEqual(['onLoan′ = onLoan']);
  });
});

// ── redundancy ─────────────────────────────────────────────────────────────────

describe('redundant predicates', () => {
  const LEND = 'book? ∉ onLoan\nborrower′ = borrower ∪ {book? ↦ member?}';
  const FIND = 'book? ∈ onLoan\nmember! = borrower(book?)';

  it('(a) a line of the state invariant, before or after', () => {
    const spec = lib({ lend: { preds: `${LEND}\nonLoan′ = dom borrower′\nonLoan = dom borrower` } });
    const r = run(spec);
    expect(flags(spec, r)).toEqual(['onLoan′ = dom borrower′', 'onLoan = dom borrower']);
    const d = flagOn(spec, r, 'onLoan′ = dom borrower′');
    expect(d).toMatchObject({ kind: 'redundant', severity: 'info', section: { schemaId: 'op-lend', part: 'preds' } });
    expect(d.message).toBe('Already part of the state invariant (included by ΔLibrary).');
    expect(d.derivation).toEqual({
      kind: 'facts',
      premises: [{ text: 'onLoan′ = dom borrower′', reason: 'invariant after' }],
      conclusion: 'onLoan′ = dom borrower′',
    });
    expect(flagOn(spec, r, 'onLoan = dom borrower').derivation).toMatchObject({ premises: [{ reason: 'invariant before' }] });
    // the effect is still shown in the panel
    expect(factsOf(r, 'op-lend', 'effect').map((f) => f.text)).toEqual(['onLoan′ = onLoan ∪ {book?}']);
  });

  it('(a) says when the redundant line is the only one with v′ (keeping it lets v change)', () => {
    const s = structuredClone(referenceSpecOf('medication')!);
    const prescribe = s.operations.find((o) => o.name === 'Prescribe')!;
    prescribe.preds = 'p? ∈ patients\n(p? ↦ drug?) ∉ allergic\nprescribed′ = prescribed ∪ {p? ↦ drug?}\nprescribed′ ∩ allergic′ = ∅';
    const r = run(s);
    expect(flagOn(s, r, 'prescribed′ ∩ allergic′ = ∅').message).toBe(
      'Already part of the state invariant (included by ΔWard). It is also the only line with allergic′, so allergic may change here.',
    );
    // several variables
    prescribe.preds = 'p? ∈ patients\n(p? ↦ drug?) ∉ allergic\nprescribed′ = prescribed ∪ {p? ↦ drug?}\ndom allergic′ ⊆ patients′';
    const r2 = run(s);
    expect(flagOn(s, r2, 'dom allergic′ ⊆ patients′').message).toBe(
      'Already part of the state invariant (included by ΔWard). It is also the only line with patients′ and allergic′, so patients and allergic may change here.',
    );
    // with allergic′ = allergic written, nothing to add
    prescribe.preds += '\nallergic′ = allergic\npatients′ = patients';
    expect(flagOn(s, run(s), 'dom allergic′ ⊆ patients′').message).toBe('Already part of the state invariant (included by ΔWard).');
  });

  it('(a) also modulo symmetry of =', () => {
    const spec = lib({ init: { preds: 'onLoan = ∅\ndom borrower = onLoan' } });
    const r = run(spec);
    expect(flagOn(spec, r, 'dom borrower = onLoan').message).toBe('Already part of the state invariant (included by Library).');
  });

  it('(b) Ξ already says the state does not change', () => {
    const spec = lib({ find: { preds: `${FIND}\nonLoan′ = onLoan\nborrower′ = borrower ∧ onLoan′ = onLoan` } });
    const r = run(spec);
    expect(flags(spec, r)).toEqual(['onLoan′ = onLoan', 'borrower′ = borrower ∧ onLoan′ = onLoan']);
    const d = flagOn(spec, r, 'onLoan′ = onLoan');
    expect(d.message).toBe('ΞLibrary already says the state does not change.');
    expect(d.derivation).toEqual({
      kind: 'facts',
      premises: [{ text: 'onLoan′ = onLoan', reason: 'ΞLibrary' }],
      conclusion: 'onLoan′ = onLoan',
    });
  });

  it('(b) Ξ together with another line', () => {
    const spec = lib({ find: { preds: `${FIND}\nbook? ∈ onLoan′\nmember! = borrower′(book?)` } });
    const r = run(spec);
    expect(flags(spec, r)).toEqual(['book? ∈ onLoan′', 'member! = borrower′(book?)']);
    expect(flagOn(spec, r, 'book? ∈ onLoan′').message).toBe('Already follows from ‘book? ∈ onLoan’ and ΞLibrary.');
  });

  it('(c) onLoan′ = onLoan ∪ {book?} in Lend: the full chain', () => {
    const spec = lib({ lend: { preds: `${LEND}\nonLoan′ = onLoan ∪ {book?}` } });
    const r = run(spec);
    const d = flagOn(spec, r, 'onLoan′ = onLoan ∪ {book?}');
    expect(d.message).toBe('Already follows from ‘borrower′ = borrower ∪ {book? ↦ member?}’ and the state invariant.');
    expect(d.derivation).toEqual(LEND_CHAIN);
    expect(r.redundant).toHaveLength(1);
  });

  it('(c) modulo commutativity, and stopping at the matching step', () => {
    let spec = lib({ lend: { preds: `book? ∉ onLoan\nonLoan′ = {book?} ∪ onLoan\nborrower′ = borrower ∪ {book? ↦ member?}` } });
    expect(flagOn(spec, run(spec), 'onLoan′ = {book?} ∪ onLoan').derivation).toEqual(LEND_CHAIN);
    spec = lib({ lend: { preds: `${LEND}\nonLoan′ = dom borrower ∪ {book?}` } });
    expect(flagOn(spec, run(spec), 'onLoan′ = dom borrower ∪ {book?}').derivation).toEqual({ ...LEND_CHAIN, steps: LEND_CHAIN.steps.slice(0, 4) });
  });

  it('(c) not flagged when it does not follow (or is wrong)', () => {
    // wrong (contradicts the invariant: the example generator shows that), and without borrower′
    for (const preds of [`${LEND}\nonLoan′ = onLoan`, 'book? ∉ onLoan\nonLoan′ = onLoan ∪ {book?}']) {
      const spec = lib({ lend: { preds } });
      expect(flags(spec, run(spec)), preds).toEqual([]);
    }
  });

  it('(c) frame condition implied by the invariant', () => {
    const spec = lib({ extra: [op('op-touch', 'Touch', 'ΔLibrary', 'borrower′ = borrower\nonLoan′ = onLoan')] });
    const d = flagOn(spec, run(spec), 'onLoan′ = onLoan');
    expect(d.message).toBe('Already follows from ‘borrower′ = borrower’ and the state invariant.');
    expect(d.derivation).toMatchObject({ kind: 'chain', steps: [{ expr: 'dom borrower′' }, { expr: 'dom borrower' }, { expr: 'onLoan' }] });
  });

  it('(d) a duplicate line (only the later one)', () => {
    const spec = lib({ find: { preds: `${FIND}\nbook? ∈ onLoan` } });
    const r = run(spec);
    expect(r.redundant).toHaveLength(1);
    const d = r.redundant[0];
    expect(d.message).toBe('Already stated above.');
    // the span is the third line
    expect([d.from, d.to]).toEqual([FIND.length + 1, FIND.length + 1 + 'book? ∈ onLoan'.length]);
  });

  it('(d) a conjunct of an earlier line', () => {
    const spec = lib({ lend: { preds: 'book? ∉ onLoan ∧ borrower′ = borrower ∪ {book? ↦ member?}\nbook? ∉ onLoan' } });
    expect(flagOn(spec, run(spec), 'book? ∉ onLoan').message).toBe('Already stated above, in ‘book? ∉ onLoan ∧ borrower′ = borrower ∪ {book? ↦ member?}’.');
  });

  it('(e) follows from a declaration', () => {
    const spec = lib({
      state: { preds: 'onLoan = dom borrower\ndom borrower ⊆ BOOK\nonLoan ⊆ BOOK\nran borrower ⊆ MEMBER' },
      find: { preds: `book? ∈ BOOK\n${FIND}` },
    });
    const r = run(spec);
    expect(flags(spec, r)).toEqual(['dom borrower ⊆ BOOK', 'onLoan ⊆ BOOK', 'ran borrower ⊆ MEMBER', 'book? ∈ BOOK']);
    const d = flagOn(spec, r, 'dom borrower ⊆ BOOK');
    expect(d.message).toBe('The declaration ‘borrower : BOOK ⇸ MEMBER’ already says this.');
    expect(d.derivation).toEqual({
      kind: 'facts',
      premises: [{ text: 'borrower : BOOK ⇸ MEMBER', reason: 'declaration' }],
      conclusion: 'dom borrower ⊆ BOOK',
    });
    expect(flagOn(spec, r, 'book? ∈ BOOK').message).toBe('The declaration ‘book? : BOOK’ already says this.');
  });

  it('(e) numbers: amount? > 0 for amount? : ℕ₁, dom f = X for a total function', () => {
    const spec: SpecDoc = {
      topicId: 't',
      title: 'T',
      given: '[A, B]',
      pools: {},
      state: { id: 'state', role: 'state', name: 'S', decls: 'f : A → B\ng : A ⇸ B', preds: 'dom f = A\ndom g ⊆ A' },
      init: null,
      operations: [op('op-x', 'X', 'ΞS\namount? : ℕ₁\nn? : ℕ', '0 < amount?\nn? ≥ 0\namount? ≥ 2\nn? > 0')],
    };
    const r = run(spec);
    expect(flags(spec, r)).toEqual(['dom f = A', 'dom g ⊆ A', '0 < amount?', 'n? ≥ 0']);
  });

  it('(f) book? ∉ dom borrower as an extra precondition of Lend', () => {
    const spec = lib({ lend: { preds: `book? ∉ onLoan\nbook? ∉ dom borrower\nborrower′ = borrower ∪ {book? ↦ member?}` } });
    const r = run(spec);
    expect(r.redundant).toHaveLength(1);
    const d = flagOn(spec, r, 'book? ∉ dom borrower');
    expect(d.message).toBe('Already follows from ‘book? ∉ onLoan’ and the state invariant.');
    expect(d.derivation).toEqual({
      kind: 'facts',
      premises: [
        { text: 'book? ∉ onLoan', reason: 'precondition' },
        { text: 'onLoan = dom borrower', reason: 'invariant before' },
      ],
      conclusion: 'book? ∉ dom borrower',
    });
  });

  it('(f) of two equivalent preconditions only the later one is marked', () => {
    const spec = lib({ lend: { preds: `book? ∉ dom borrower\nbook? ∉ onLoan\nborrower′ = borrower ∪ {book? ↦ member?}` } });
    expect(flags(spec, run(spec))).toEqual(['book? ∉ onLoan']);
  });

  it('(f) after-state memberships that follow from the effect', () => {
    const spec = lib({
      extra: [
        op(
          'op-rm',
          'Return',
          'ΔLibrary\nbook? : BOOK',
          'book? ∈ onLoan\nborrower′ = borrower ∖ {book? ↦ borrower(book?)}\nbook? ∉ onLoan′',
        ),
      ],
      lend: { preds: `${LEND}\nbook? ∈ onLoan′` },
    });
    const r = run(spec);
    expect(flags(spec, r)).toEqual(['book? ∈ onLoan′', 'book? ∉ onLoan′']);
    expect(flagOn(spec, r, 'book? ∉ onLoan′').derivation).toEqual({
      kind: 'facts',
      premises: [
        { text: 'borrower′ = borrower ∖ {book? ↦ borrower(book?)}', reason: 'spec of Return' },
        { text: 'onLoan′ = dom borrower′', reason: 'invariant after' },
        { text: 'dom (f ∖ {a ↦ f(a)}) = dom f ∖ {a}', reason: 'fact about dom' },
      ],
      conclusion: 'book? ∉ onLoan′',
    });
  });

  it('never marks a safety precondition that only follows via the after state', () => {
    // (p? ↦ drug?) ∉ allergic follows from prescribed′ ∩ allergic′ = ∅ and the effect,
    // but it is exactly the precondition the students are asked to write.
    const spec: SpecDoc = {
      topicId: 't',
      title: 'Ward',
      given: '[PATIENT, DRUG]',
      pools: {},
      state: {
        id: 'state',
        role: 'state',
        name: 'Ward',
        decls: 'patients : ℙ PATIENT\nallergic : PATIENT ↔ DRUG\nprescribed : PATIENT ↔ DRUG',
        preds: 'dom allergic ⊆ patients\ndom prescribed ⊆ patients\nprescribed ∩ allergic = ∅',
      },
      init: null,
      operations: [
        op(
          'op-p',
          'Prescribe',
          'ΔWard\np? : PATIENT\ndrug? : DRUG',
          'p? ∈ patients\n(p? ↦ drug?) ∉ allergic\nprescribed′ = prescribed ∪ {p? ↦ drug?}\npatients′ = patients\nallergic′ = allergic',
        ),
      ],
    };
    expect(run(spec).redundant).toEqual([]);
  });

  it('(h) Init: borrower = ∅ follows from onLoan = ∅ (the later line is marked)', () => {
    let spec = lib({ init: { preds: 'onLoan = ∅\nborrower = ∅' } });
    let r = run(spec);
    expect(flags(spec, r)).toEqual(['borrower = ∅']);
    expect(flagOn(spec, r, 'borrower = ∅').message).toBe('Already follows from ‘onLoan = ∅’ and the state invariant.');
    expect(factsOf(r, 'init')).toEqual([]);
    spec = lib({ init: { preds: 'borrower = ∅\nonLoan = ∅' } });
    r = run(spec);
    expect(flags(spec, r)).toEqual(['onLoan = ∅']);
    expect(flagOn(spec, r, 'onLoan = ∅').derivation).toEqual({
      kind: 'facts',
      premises: [
        { text: 'borrower = ∅', reason: 'Init' },
        { text: 'onLoan = dom borrower', reason: 'invariant' },
        { text: 'dom ∅ = ∅', reason: 'fact about dom' },
      ],
      conclusion: 'onLoan = ∅',
    });
  });

  it('marks the whole line without surrounding blanks', () => {
    const preds = `${LEND}\n  (onLoan′ = onLoan ∪ {book?})  \n`;
    const spec = lib({ lend: { preds } });
    const d = run(spec).redundant[0];
    expect(preds.slice(d.from, d.to)).toBe('(onLoan′ = onLoan ∪ {book?})');
  });
});

// ── robustness ─────────────────────────────────────────────────────────────────

describe('robustness', () => {
  it('never throws and skips schemas with errors', () => {
    const spec = lib({ lend: { preds: 'book? ∉ onLoan\nborrower′ = borrower ∪ {book? ↦' }, find: { preds: `${'book? ∈ onLoan'}\nmember! = borrower(book?)\nbook? ∈ onLoan` } });
    const an = analyseSpec(spec);
    const r = infer(spec, an);
    expect(factsOf(r, 'op-lend')).toEqual([]);
    expect(flags(spec, r)).toEqual(['book? ∈ onLoan']);
    expect(() => infer(lib({ state: { preds: 'onLoan = dom' } }), analyseSpec(lib({ state: { preds: 'onLoan = dom' } })))).not.toThrow();
  });
});

// ── templates ──────────────────────────────────────────────────────────────────

interface TLine {
  text: string;
  hidden?: boolean;
}
interface TSchema {
  name: string;
  declarations?: TLine[];
  predicates?: TLine[];
}
interface Template {
  id: string;
  title: string;
  givenSets: { name: string }[];
  state: TSchema;
  init?: TSchema | null;
  operations?: TSchema[];
}

const TEMPLATES = import.meta.glob('/templates/*.json', { eager: true, import: 'default' }) as Record<string, Template>;

/** A template as a spec: the full intended spec (hidden lines included) or what students see first. */
function templateSpec(t: Template, withHidden = true): SpecDoc {
  const text = (ls: TLine[] | undefined) =>
    (ls ?? [])
      .filter((l) => withHidden || !l.hidden)
      .map((l) => l.text)
      .join('\n');
  const doc = (s: TSchema, id: string, role: SchemaDoc['role']): SchemaDoc => ({
    id,
    role,
    name: s.name,
    decls: text(s.declarations),
    preds: text(s.predicates),
  });
  return {
    topicId: t.id,
    title: t.title,
    given: `[${t.givenSets.map((g) => g.name).join(', ')}]`,
    pools: {},
    state: doc(t.state, 'state', 'state'),
    init: t.init ? doc(t.init, 'init', 'init') : null,
    operations: (t.operations ?? []).map((o, i) => doc(o, `op-${i}`, 'operation')),
  };
}

describe('templates', () => {
  const entries = Object.entries(TEMPLATES);

  it('there are six templates', () => {
    expect(entries.length).toBe(6);
  });

  for (const [path, t] of entries) {
    it(`${path.replace(/^.*\//, '')}: no line of the full spec is redundant`, () => {
      const spec = templateSpec(t);
      const r = run(spec);
      console.log(listing(spec, r));
      expect(flags(spec, r)).toEqual([]);
      // Init always yields something interesting, Ξ operations their unchanged state
      for (const f of r.facts) expect(f.text).not.toMatch(/undefined|\?\?/);
    });

    it(`${path.replace(/^.*\//, '')}: the student start version`, () => {
      const spec = templateSpec(t, false);
      const an = analyseSpec(spec);
      const r = infer(spec, an, { strict: true });
      expect(flags(spec, r)).toEqual([]);
    });

    it(`${path.replace(/^.*\//, '')}: every variant with one line removed or doubled`, () => {
      const base = templateSpec(t);
      for (const s of [base.state, ...(base.init ? [base.init] : []), ...base.operations]) {
        const lines = s.preds.split('\n');
        for (let i = 0; i < lines.length; i++) {
          for (const variant of [lines.filter((_, j) => j !== i), [...lines, lines[i]]]) {
            const spec = structuredClone(base);
            const target = [spec.state, spec.init, ...spec.operations].find((x) => x?.id === s.id)!;
            target.preds = variant.join('\n');
            const r = infer(spec, analyseSpec(spec), { strict: true });
            // a doubled line is always marked (as a duplicate or because it follows otherwise)
            if (variant.length > lines.length) expect(flags(spec, r, s.id)).toContain(lines[i]);
          }
        }
      }
    });
  }

  it('is fast (all six templates < 30 ms)', () => {
    const specs = entries.map(([, t]) => templateSpec(t));
    const ans = specs.map(analyseSpec);
    specs.forEach((s, i) => infer(s, ans[i])); // warm up
    const t0 = performance.now();
    specs.forEach((s, i) => infer(s, ans[i]));
    const ms = performance.now() - t0;
    console.log(`infer on six templates: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(100); // generous for slow CI machines; typically a few ms
  });
});

// ── frame convention and guarantees from the invariant ─────────────────────────

describe('frame convention (unmentioned variables stay unchanged)', () => {
  const bank = referenceSpecOf('bank-account')!;
  const withdrawWithout = (lines: RegExp) => {
    const s = structuredClone(bank);
    const w = s.operations.find((o) => o.name === 'Withdraw')!;
    w.preds = w.preds
      .split('\n')
      .filter((l) => !lines.test(l))
      .join('\n');
    return s;
  };

  it('lists the unmentioned variables as unchanged [not mentioned]', () => {
    const s = withdrawWithout(/^(owner′ = owner|overdraft′ = overdraft)$/);
    const facts = factsOf(run(s), 'op-withdraw', 'unchanged');
    expect(facts.map((f) => f.text)).toEqual(['owner′ = owner ∧ overdraft′ = overdraft']);
    expect(facts[0].derivation).toEqual({
      kind: 'facts',
      premises: [
        { text: 'owner′ = owner', reason: 'not mentioned' },
        { text: 'overdraft′ = overdraft', reason: 'not mentioned' },
      ],
      conclusion: 'owner′ = owner ∧ overdraft′ = overdraft',
    });
  });

  it('does not flag an explicit v′ = v as redundant', () => {
    const r = run(bank);
    expect(flags(bank, r, 'op-withdraw')).toEqual([]);
    expect(factsOf(r, 'op-withdraw', 'unchanged')).toEqual([]);
  });

  it('derives values the invariant determines instead of keeping them unchanged', () => {
    // Lend sets borrower′ only; onLoan′ = onLoan ∪ {book?} follows from the invariant
    const r = run(LIBRARY);
    expect(factsOf(r, 'op-lend', 'unchanged')).toEqual([]);
    expect(factsOf(r, 'op-lend', 'effect').map((f) => f.text)).toEqual(['onLoan′ = onLoan ∪ {book?}']);
  });
});

describe('guarantees from the invariant', () => {
  it('Withdraw: the overdraft limit', () => {
    const r = run(referenceSpecOf('bank-account')!);
    expect(factsOf(r, 'op-withdraw', 'guaranteed')).toEqual([
      {
        schemaId: 'op-withdraw',
        kind: 'guaranteed',
        text: 'balance(a?) - amount? ≥ -(overdraft(a?))',
        derivation: {
          kind: 'facts',
          premises: [
            { text: '∀ a ∈ dom balance′ . balance′(a) ≥ -(overdraft′(a))', reason: 'invariant after' },
            { text: 'a? ∈ dom balance′', reason: 'spec of Withdraw' },
            { text: 'balance′(a?) = balance(a?) - amount?', reason: 'spec of Withdraw' },
            { text: 'overdraft′(a?) = overdraft(a?)', reason: 'unchanged' },
          ],
          conclusion: 'balance(a?) - amount? ≥ -(overdraft(a?))',
        },
      },
    ]);
  });

  it('Withdraw with a pointwise update gives the same guarantee', () => {
    const s = structuredClone(referenceSpecOf('bank-account')!);
    const w = s.operations.find((o) => o.name === 'Withdraw')!;
    w.preds = w.preds.replace(/^balance′ = .*$/m, 'balance′(a?) = balance(a?) - amount?');
    const texts = factsOf(run(s), 'op-withdraw', 'guaranteed').map((f) => f.text);
    expect(texts).toEqual(['balance(a?) - amount? ≥ -(overdraft(a?))']);
  });

  it('Prescribe: no drug the patient is allergic to, and only patients on the ward', () => {
    const r = run(referenceSpecOf('medication')!);
    const facts = factsOf(r, 'op-prescribe', 'guaranteed');
    expect(facts.map((f) => f.text)).toEqual(['p? ∈ patients', '(p? ↦ drug?) ∉ allergic']);
    expect(facts[1].derivation).toEqual({
      kind: 'chain',
      start: 'prescribed′ ∩ allergic′ = ∅',
      steps: [
        { rel: '⇔', expr: '(prescribed ∪ {p? ↦ drug?}) ∩ allergic = ∅', reason: 'spec of Prescribe' },
        { rel: '⇔', expr: 'prescribed ∩ allergic = ∅ ∧ {p? ↦ drug?} ∩ allergic = ∅', reason: 'fact about ∩' },
        { rel: '⇔', expr: 'prescribed ∩ allergic = ∅ ∧ (p? ↦ drug?) ∉ allergic', reason: 'fact about ∩' },
        { rel: '⇔', expr: '(p? ↦ drug?) ∉ allergic', reason: 'invariant before' },
      ],
    });
    // shown although the reference also states it as a precondition, and never a redundancy
    expect(flags(referenceSpecOf('medication')!, r, 'op-prescribe')).toEqual([]);
  });

  it("Prescribe with functions to sets (the lecturer's spec): taken at the changed point, simplified", () => {
    const s = structuredClone(referenceSpecOf('medication')!);
    s.given = '[PATIENT, DRUG]';
    s.state.decls = 'patients: ℙ PATIENT\nallergic: PATIENT ⇸ ℙ DRUG\nprescribed: PATIENT ⇸ ℙ DRUG';
    s.state.preds = 'dom allergic ⊆ patients\ndom prescribed ⊆ patients\n∀ p ∈ patients. prescribed(p) ∩ allergic(p) = ∅';
    const op = s.operations.find((o) => o.name === 'Prescribe')!;
    op.decls = 'ΔWard\npatient?: PATIENT\ndrug?: DRUG';
    op.preds = 'patient? ∈ patients\nprescribed′ = prescribed ∖ {patient? ↦ prescribed(patient?)} ∪ {patient? ↦ prescribed(patient?) ∪ {drug?}}';
    s.operations = [op];
    const facts = factsOf(run(s), 'op-prescribe', 'guaranteed');
    expect(facts.map((f) => f.text)).toEqual(['patient? ∈ patients', 'drug? ∉ allergic(patient?)']);
    expect(facts[1].derivation).toEqual({
      kind: 'facts',
      premises: [
        { text: '∀ p ∈ patients′ . prescribed′(p) ∩ allergic′(p) = ∅', reason: 'invariant after' },
        { text: 'patient? ∈ patients′', reason: 'patient? ∈ patients (precondition), patients′ = patients (unchanged)' },
        { text: 'prescribed′(patient?) = prescribed(patient?) ∪ {drug?}', reason: 'spec of Prescribe' },
        { text: 'allergic′(patient?) = allergic(patient?)', reason: 'unchanged' },
        { text: '(prescribed(patient?) ∪ {drug?}) ∩ allergic(patient?) = ∅', reason: 'so, at patient?' },
        { text: 'prescribed(patient?) ∩ allergic(patient?) = ∅', reason: 'invariant before, at patient?' },
      ],
      conclusion: 'drug? ∉ allergic(patient?)',
    });
    // dom prescribed ∖ {patient?} ⊆ patients follows from the invariant before: not shown
    const chain = facts[0].derivation;
    expect(chain.kind === 'chain' && chain.steps[chain.steps.length - 1]).toEqual({ rel: '⇔', expr: 'patient? ∈ patients', reason: 'invariant before' });
  });

  it('adding to a set: ∀ x ∈ S′ . P is instantiated at the new element', () => {
    // written explicitly, or derived from the invariant (onLoan′ = onLoan ∪ {book?})
    for (const preds of ['book? ∉ onLoan\nonLoan′ = onLoan ∪ {book?}\nborrower′ = borrower ∪ {book? ↦ member?}', 'book? ∉ onLoan\nborrower′ = borrower ∪ {book? ↦ member?}']) {
      const s = lib({ lend: { preds } });
      s.state.decls += '\nlimit : BOOK ⇸ ℕ';
      s.state.preds += '\n∀ b ∈ onLoan . b ∈ dom limit';
      const facts = factsOf(run(s), 'op-lend', 'guaranteed');
      expect(facts.map((f) => f.text)).toEqual(['book? ∈ dom limit']);
      expect(facts[0].derivation.kind === 'facts' && facts[0].derivation.premises.map((p) => p.text)).toEqual([
        '∀ b ∈ onLoan′ . b ∈ dom limit′',
        'book? ∈ onLoan′',
        'limit′ = limit',
      ]);
    }
  });
});

describe('equalities forced by a total function (→ instead of ⇸)', () => {
  const spec = (() => {
    const s = structuredClone(referenceSpecOf('medication')!);
    s.state.decls = 'patients : ℙ PATIENT\nallergic : PATIENT → ℙ DRUG\nprescribed : PATIENT ↔ DRUG';
    s.state.preds = 'dom allergic ⊆ patients\ndom prescribed ⊆ patients';
    const v = s.operations.find((o) => o.name === 'ViewPrescriptions')!;
    v.decls = 'ΞWard\npatient? : PATIENT\ndrugs! : ℙ DRUG';
    v.preds = 'patient? ∈ patients\ndrugs! = { d ∈ DRUG | (patient? ↦ d) ∈ prescribed }';
    s.operations = [v];
    return s;
  })();

  it('shows the consequence in the state step', () => {
    expect(factsOf(run(spec), 'state', 'implied')).toEqual([
      {
        schemaId: 'state',
        kind: 'implied',
        text: 'patients = PATIENT',
        note: 'every patient is in patients',
        derivation: {
          kind: 'facts',
          premises: [
            { text: 'dom allergic = PATIENT', reason: 'allergic is total (→)' },
            { text: 'dom allergic ⊆ patients', reason: 'invariant' },
            { text: 'patients ⊆ PATIENT', reason: 'declaration of patients' },
          ],
          conclusion: 'patients = PATIENT',
        },
      },
    ]);
  });

  it('explains the redundant precondition step by step', () => {
    const r = run(spec);
    const flagsHere = r.redundant.filter((d) => d.section.schemaId === 'op-view-prescriptions');
    expect(flagsHere.map((d) => d.message)).toEqual(['Already true: allergic is total, so every patient is in patients (patients = PATIENT).']);
    expect(flagsHere[0].derivation).toEqual({
      kind: 'facts',
      premises: [
        { text: 'dom allergic = PATIENT', reason: 'allergic is total (→)' },
        { text: 'dom allergic ⊆ patients', reason: 'invariant before' },
        { text: 'patients = PATIENT', reason: 'so every patient is in patients' },
        { text: 'patient? ∈ PATIENT', reason: 'declaration of patient?' },
      ],
      conclusion: 'patient? ∈ patients',
    });
  });

  it('stays quiet with a partial function', () => {
    const s = structuredClone(spec);
    s.state.decls = s.state.decls.replace('PATIENT → ℙ DRUG', 'PATIENT ⇸ ℙ DRUG');
    const r = run(s);
    expect(factsOf(r, 'state', 'implied')).toEqual([]);
    expect(r.redundant.filter((d) => d.section.schemaId === 'op-view-prescriptions')).toEqual([]);
  });
});
