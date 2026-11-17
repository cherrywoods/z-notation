import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY, LOANS_OF } from './testing/library';
import type { SchemaDoc, SchemaRole, SpecDoc } from '../spec/model';
import { createSpec } from '../spec/topics';
import { exampleInit, exampleOperation, exampleState, exampleTypes, universeFor } from './generate';
import { analyseSpec } from './index';
import type { OpExample, ShownVar, StateExample } from './results';
import { evalPred, makeUniverse } from './eval';
import { deterministically, now, useWorkClock } from './gen/clock';
import { dist } from './gen/dist';
import { makeRng } from './gen/rng';
import { parseTerm } from './parser';
import { printTerm } from './print';
import { EMPTY, atom, mkSet, printValue, tuple, type Value } from './values';

// Example searches count work instead of milliseconds here (gen/clock), so the results
// do not depend on the machine's speed or load.
beforeAll(() => useWorkClock(true));
afterAll(() => useWorkClock(false));

// ── fixtures ───────────────────────────────────────────────────────────────────

interface TLine {
  text: string;
  hidden?: boolean;
}
interface TSchema {
  name: string;
  kind?: 'query' | 'update';
  declarations?: TLine[];
  predicates?: TLine[];
}
interface Template {
  id: string;
  title: string;
  givenSets: { name: string; values?: string[]; infinite?: boolean }[];
  fixedValues?: Record<string, string>;
  state: TSchema;
  init?: TSchema | null;
  operations: TSchema[];
  extraOperations?: TSchema[];
}

const TEMPLATES = Object.entries(
  import.meta.glob('/templates/*.json', { eager: true, import: 'default' }) as Record<string, Template>,
).map(([path, t]) => ({ ...t, id: path.replace(/^.*\//, '').replace(/\.json$/, '') }));

/**
 * A student half-way through: the template's non-hidden lines written, the key
 * (hidden) lines still missing. (The app itself starts completely bare.)
 */
function studentSpec(t: Template): SpecDoc {
  const spec = createSpec(t.id);
  const shown = (ls?: TLine[]) =>
    (ls ?? [])
      .filter((l) => !(l as TLine & { hidden?: boolean }).hidden)
      .map((l) => l.text)
      .join('\n');
  spec.given = `[${t.givenSets.map((g) => g.name).join(', ')}]`;
  spec.state.decls = shown(t.state.declarations);
  spec.state.preds = shown(t.state.predicates);
  if (spec.init && t.init) {
    spec.init.decls = shown(t.init.declarations);
    spec.init.preds = shown(t.init.predicates);
  }
  t.operations.forEach((o, i) => {
    spec.operations[i].decls = shown(o.declarations);
    spec.operations[i].preds = shown(o.predicates);
  });
  if (t.fixedValues) spec.fixed = { ...t.fixedValues };
  return spec;
}

/** The complete template (all lines, extra operations too). */
function fullSpec(t: Template): SpecDoc {
  const text = (ls?: TLine[]) => (ls ?? []).map((l) => l.text).join('\n');
  const schema = (s: TSchema, id: string, role: SchemaRole): SchemaDoc => ({
    id,
    role,
    name: s.name,
    decls: text(s.declarations),
    preds: text(s.predicates),
  });
  const pools: Record<string, string[]> = {};
  for (const g of t.givenSets) if (g.values) pools[g.name] = g.values;
  return {
    topicId: t.id,
    title: t.title,
    given: `[${t.givenSets.map((g) => g.name).join(', ')}]`,
    pools,
    infinite: t.givenSets.filter((g) => g.infinite).map((g) => g.name),
    fixed: t.fixedValues,
    state: schema(t.state, 'state', 'state'),
    init: t.init ? schema(t.init, 'init', 'init') : null,
    operations: [...t.operations, ...(t.extraOperations ?? [])].map((o, i) => schema(o, `op-${i}`, 'operation')),
  };
}

const lib = (patch: (s: SpecDoc) => void = () => {}): SpecDoc => {
  const s = structuredClone(LIBRARY);
  patch(s);
  return s;
};

const SEEDS = Array.from({ length: 20 }, (_, i) => i * 7919 + 13);

const byName = (vars: ShownVar[], name: string): ShownVar => {
  const v = vars.find((x) => x.name === name);
  if (!v) throw new Error(`no variable ${name} in ${vars.map((x) => x.name).join(', ')}`);
  return v;
};
const elems = (v: Value) => (v.k === 'set' ? v.elems : []);
const dom = (v: Value) => mkSet(elems(v).map((p) => (p.k === 'tuple' ? p.elems[0] : p)));

function okState(ex: StateExample): Extract<StateExample, { ok: true }> {
  if (!ex.ok) throw new Error(`state example failed: ${ex.message} ${JSON.stringify(ex.best?.failed.map((c) => c.text))}`);
  return ex;
}
function okOp(ex: OpExample): Extract<OpExample, { ok: true }> {
  if (!ex.ok) throw new Error(`operation example failed (${ex.reason}): ${ex.message} ${JSON.stringify(ex.failed?.map((c) => c.text))}`);
  return ex;
}

/**
 * Run `f` on the work clock (gen/clock: the budgets count work, not milliseconds, so
 * the result is the same under any load); its result and the work time it took (ms).
 */
function timed<T>(f: () => T): [T, number] {
  return deterministically(() => {
    const t = now();
    const r = f();
    return [r, now() - t];
  });
}

// ── universe ───────────────────────────────────────────────────────────────────

describe('universe', () => {
  const an = analyseSpec(LIBRARY);

  it('uses the whole pool, in pool order, the same for every seed', () => {
    for (const seed of SEEDS) {
      const u = universeFor(LIBRARY, an, seed);
      for (const set of ['BOOK', 'MEMBER']) expect(u.carriers[set].map(printValue)).toEqual(LIBRARY.pools[set]);
    }
    for (const t of TEMPLATES) {
      const spec = studentSpec(t);
      const an2 = analyseSpec(spec);
      const carriers = (seed: number) => JSON.stringify(universeFor(spec, an2, seed).carriers);
      expect(new Set(SEEDS.map(carriers)).size, t.id).toBe(1);
    }
  });

  it('changes the carriers only when the pools change', () => {
    const spec = lib((s) => (s.pools.BOOK = ['Dune', 'Emma', 'Walden']));
    expect(universeFor(spec, analyseSpec(spec), 3).carriers.BOOK.map(printValue)).toEqual(['Dune', 'Emma', 'Walden']);
    expect(exampleTypes(spec, analyseSpec(spec), 1)).toEqual(exampleTypes(spec, analyseSpec(spec), 99));
  });

  it('names values of sets without a pool after the set', () => {
    const spec = lib((s) => {
      s.given = '[BOOK, MEMBER, TRAIN]';
      s.state.decls += '\ntrains : ℙ TRAIN';
    });
    const ex = exampleTypes(spec, analyseSpec(spec), 1);
    expect(ex.carriers.map((c) => c.name)).toEqual(['BOOK', 'MEMBER', 'TRAIN']);
    expect(ex.carriers[2].values).toEqual(['train1', 'train2', 'train3', 'train4', 'train5']);
  });

  it('always contains the values of fixed data', () => {
    for (const t of TEMPLATES.filter((t) => t.fixedValues)) {
      const spec = studentSpec(t);
      const an2 = analyseSpec(spec);
      for (const seed of SEEDS) {
        const u = universeFor(spec, an2, seed);
        const all = new Set(Object.values(u.carriers).flatMap((c) => c.map(printValue)));
        for (const text of Object.values(t.fixedValues ?? {})) {
          for (const name of text.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) expect(all.has(name)).toBe(true);
        }
      }
    }
  });
});

// ── Library ──────────────────────────────────────────────────────────────

describe('Library', () => {
  const an = analyseSpec(LIBRARY);

  it('generates states with onLoan = dom borrower, mostly non-empty', () => {
    let nonEmpty = 0;
    const texts = new Set<string>();
    for (const seed of SEEDS) {
      const ex = okState(exampleState(LIBRARY, an, seed));
      const onLoan = byName(ex.vars, 'onLoan').value;
      const borrower = byName(ex.vars, 'borrower').value;
      expect(printValue(onLoan)).toBe(printValue(dom(borrower)));
      expect(ex.checks).toHaveLength(1);
      expect(ex.checks[0]).toMatchObject({ origin: 'own', text: 'onLoan = dom borrower', result: true, index: 0 });
      expect(ex.checks[0].section).toEqual({ schemaId: 'state', part: 'preds' });
      if (elems(borrower).length > 0) nonEmpty++;
      expect(elems(borrower).length).toBeLessThanOrEqual(5);
      texts.add(byName(ex.vars, 'borrower').text);
    }
    expect(nonEmpty).toBeGreaterThanOrEqual(18);
    expect(texts.size).toBeGreaterThan(10);
  });

  it('generates the initial state', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const ex = okState(exampleInit(LIBRARY, an, seed));
      expect(ex.vars.map((v) => `${v.name} = ${v.text}`)).toEqual(['onLoan = ∅', 'borrower = ∅']);
      expect(ex.vars.map((v) => v.status)).toEqual(['computed', 'computed']);
      expect(ex.checks.every((c) => c.result === true)).toBe(true);
    }
  });

  it('Lend: lends a book that is not on loan, onLoan′ is computed', () => {
    for (const seed of SEEDS) {
      const ex = okOp(exampleOperation(LIBRARY, an, 'op-lend', seed, 'applicable'));
      expect(ex.status).toBe('applicable');
      const onLoan = byName(ex.before, 'onLoan').value;
      const borrower = byName(ex.before, 'borrower').value;
      const book = byName(ex.inputs, 'book?').value;
      const member = byName(ex.inputs, 'member?').value;
      expect(elems(onLoan).some((k) => printValue(k) === printValue(book))).toBe(false);
      const b2 = byName(ex.after, 'borrower′');
      expect(b2.text).toBe(printValue(mkSet([...elems(borrower), { k: 'tuple', elems: [book, member] }])));
      expect(b2.status).toBe('computed');
      const k2 = byName(ex.after, 'onLoan′');
      expect(k2.text).toBe(printValue(mkSet([...elems(onLoan), book])));
      expect(k2.status).toBe('computed');
      expect(ex.outputs).toEqual([]);
      expect(ex.checks.every((c) => c.result === true)).toBe(true);
      expect(ex.checks.map((c) => c.origin)).toEqual(['own', 'own', 'invariant', 'invariant′']);
    }
  });

  it('FindBorrower: member! = borrower(book?), the state is unchanged', () => {
    for (const seed of SEEDS) {
      const ex = okOp(exampleOperation(LIBRARY, an, 'op-find', seed, 'applicable'));
      const borrower = byName(ex.before, 'borrower').value;
      const book = printValue(byName(ex.inputs, 'book?').value);
      const pair = elems(borrower).find((p) => p.k === 'tuple' && printValue(p.elems[0]) === book);
      expect(pair).toBeDefined();
      const member = byName(ex.outputs, 'member!');
      expect(member.text).toBe(printValue((pair as Extract<Value, { k: 'tuple' }>).elems[1]));
      expect(member.status).toBe('computed');
      for (const v of ex.after) expect(v.status).toBe('unchanged');
      expect(byName(ex.after, 'onLoan′').text).toBe(byName(ex.before, 'onLoan').text);
    }
  });

  it('blocked Lend: book? ∈ onLoan', () => {
    for (const seed of SEEDS) {
      const ex = okOp(exampleOperation(LIBRARY, an, 'op-lend', seed, 'blocked'));
      expect(ex.status).toBe('blocked');
      const onLoan = byName(ex.before, 'onLoan').value;
      const book = byName(ex.inputs, 'book?').value;
      expect(elems(onLoan).some((k) => printValue(k) === printValue(book))).toBe(true);
      expect(ex.after).toEqual([]);
      expect(ex.failed?.map((c) => c.text)).toEqual(['book? ∉ onLoan']);
      // the invariant holds in the blocked case
      expect(ex.checks.find((c) => c.origin === 'invariant')?.result).toBe(true);
    }
  });

  it('FindBorrower blocked: book? ∉ onLoan', () => {
    const ex = okOp(exampleOperation(LIBRARY, an, 'op-find', 5, 'blocked'));
    expect(ex.failed?.map((c) => c.text)).toEqual(['book? ∈ onLoan']);
  });

  it('keeps variables the operation does not mention unchanged (frame convention)', () => {
    const spec = lib((s) => (s.operations[1].preds = 'book? ∉ onLoan'));
    const an2 = analyseSpec(spec);
    expect(an2.byId['op-lend'].preds.filter((p) => p.origin === 'frame').map((p) => printTerm(p.term))).toEqual([
      'onLoan′ = onLoan',
      'borrower′ = borrower',
    ]);
    for (const seed of SEEDS.slice(0, 5)) {
      const ex = okOp(exampleOperation(spec, an2, 'op-lend', seed, 'applicable'));
      expect(ex.after.map((v) => v.status)).toEqual(['unchanged', 'unchanged']);
    }
  });

  it('flags borrower′ as free when the effect is incomplete', () => {
    const spec = lib((s) => (s.operations[1].preds = 'book? ∉ onLoan\nbook? ∈ dom borrower′'));
    const an2 = analyseSpec(spec);
    for (const seed of SEEDS.slice(0, 10)) {
      const ex = okOp(exampleOperation(spec, an2, 'op-lend', seed, 'applicable'));
      const b2 = byName(ex.after, 'borrower′');
      expect(b2.status).toBe('free');
      expect(b2.alternative).toBeDefined();
      expect(b2.alternative).not.toBe(b2.text);
      // the alternative is a valid partial function BOOK ⇸ MEMBER
      expect(b2.alternative).toMatch(/^(∅|\{.*\})$/);
      expect(byName(ex.after, 'onLoan′').status).toBe('free');
    }
  });

  it('does not call a value free when the predicates pin it down without an equation', () => {
    const spec = lib(
      (s) => (s.operations[1].preds = 'book? ∉ onLoan\nborrower′ ⊆ borrower ∪ {book? ↦ member?}\nborrower ∪ {book? ↦ member?} ⊆ borrower′'),
    );
    const an2 = analyseSpec(spec);
    for (const seed of SEEDS.slice(0, 5)) {
      const ex = okOp(exampleOperation(spec, an2, 'op-lend', seed, 'applicable'));
      expect(byName(ex.after, 'borrower′').status).toBe('computed');
      expect(byName(ex.after, 'onLoan′').status).toBe('computed');
    }
  });

  it('finds an alternative when the effect is only bounded', () => {
    const spec = lib((s) => (s.operations[1].preds = 'book? ∉ onLoan\nborrower ⊆ borrower′\n(book? ↦ member?) ∈ borrower′'));
    const an2 = analyseSpec(spec);
    let free = 0;
    for (const seed of SEEDS) {
      const ex = okOp(exampleOperation(spec, an2, 'op-lend', seed, 'applicable'));
      const b2 = byName(ex.after, 'borrower′');
      expect(ex.checks.every((c) => c.result === true)).toBe(true);
      // determined only if borrower′ must cover all books of the example
      const full = elems(dom(b2.value)).length === universeFor(spec, an2, seed).carriers.BOOK.length;
      const onLoan = byName(ex.before, 'onLoan').value;
      if (elems(onLoan).length + 1 === universeFor(spec, an2, seed).carriers.BOOK.length) {
        expect(full).toBe(true);
        expect(b2.status).toBe('computed');
      } else {
        expect(b2.status).toBe('free');
        expect(b2.alternative).not.toBe(b2.text);
        free++;
      }
    }
    expect(free).toBeGreaterThan(10);
  });

  it('claims computed only when the predicates fix the value', () => {
    const counter = (stateDecls: string, opPreds: string, opDecls = 'ΔCounter'): SpecDoc => ({
      topicId: 't',
      title: 'T',
      given: '[]',
      pools: {},
      infinite: [],
      state: { id: 'state', role: 'state', name: 'Counter', decls: stateDecls, preds: '' },
      init: null,
      operations: [{ id: 'op', role: 'operation', name: 'Op', decls: opDecls, preds: opPreds }],
    });
    const statusIn = (spec: SpecDoc, name: string, seed: number) => {
      const ex = okOp(exampleOperation(spec, analyseSpec(spec), 'op', seed, 'applicable'));
      return byName([...ex.after, ...ex.outputs], name);
    };
    for (const seed of SEEDS.slice(0, 5)) {
      // only a few small numbers are candidates, but x! = 21 is not the only answer
      const x = statusIn(counter('c : ℕ', 'x! > 20', 'ΞCounter\nx! : ℕ'), 'x!', seed);
      expect(x).toMatchObject({ text: '21', status: 'free', alternative: '22' });
      const c = statusIn(counter('c : ℕ', 'c = 9\nc′ > c'), 'c′', seed);
      expect(c).toMatchObject({ text: '10', status: 'free', alternative: '11' });
      // all of 0 .. 10 tried: a proof
      const d = statusIn(counter('c : 0 .. 10', 'c′ > 9'), 'c′', seed);
      expect(d.text).toBe('10');
      expect(['computed', 'unchanged']).toContain(d.status);
      // c′ = 10 is the only value (c′ ≤ 10 by the invariant), but only small numbers were
      // tried: chosen, not computed
      const spec = counter('c : ℕ', 'c′ > 9');
      spec.state.preds = 'c ≤ 10';
      expect(statusIn(spec, 'c′', seed)).toMatchObject({ text: '10', status: 'chosen' });
    }
  });

  it('flags an unconstrained output as free', () => {
    const spec = lib((s) => {
      s.operations[0].preds = 'book? ∈ onLoan';
    });
    const ex = okOp(exampleOperation(spec, analyseSpec(spec), 'op-find', 3, 'applicable'));
    const d = byName(ex.outputs, 'member!');
    expect(d.status).toBe('free');
    expect(d.alternative).not.toBe(d.text);
    for (const v of ex.after) expect(v.status).toBe('unchanged');
  });

  it('computes set comprehensions (LoansOf)', () => {
    const spec = lib((s) => s.operations.push(structuredClone(LOANS_OF)));
    const an2 = analyseSpec(spec);
    for (const seed of SEEDS.slice(0, 5)) {
      const ex = okOp(exampleOperation(spec, an2, 'op-loans', seed, 'applicable'));
      const borrower = byName(ex.before, 'borrower').value;
      const member = printValue(byName(ex.inputs, 'member?').value);
      const expected = mkSet(elems(borrower).flatMap((p) => (p.k === 'tuple' && printValue(p.elems[1]) === member ? [p.elems[0]] : [])));
      const books = byName(ex.outputs, 'books!');
      expect(books.text).toBe(printValue(expected));
      expect(books.status).toBe('computed');
    }
    expect(exampleOperation(spec, an2, 'op-loans', 1, 'blocked')).toMatchObject({ ok: false, reason: 'no-blocked' });
  });

  it('reports a contradictory invariant', () => {
    const spec = lib((s) => (s.state.preds = 'onLoan = dom borrower\nonLoan = ∅\nonLoan ≠ ∅'));
    const an2 = analyseSpec(spec);
    const [ex, ms] = timed(() => exampleState(spec, an2, 1));
    expect(ex.ok).toBe(false);
    if (!ex.ok) {
      expect(ex.message).toBe('No example found with small values.');
      expect(ex.best?.failed.map((c) => c.text)).toContain('onLoan ≠ ∅');
    }
    expect(ms).toBeLessThan(100);
    const op = exampleOperation(spec, an2, 'op-lend', 1, 'applicable');
    expect(op).toMatchObject({ ok: false, reason: 'no-before', message: 'No example state found with small values.' });
  });

  it('reports a contradiction that needs search', () => {
    const spec = lib((s) => (s.state.preds = 'onLoan = dom borrower\n#onLoan > 2\n#borrower < 2'));
    const ex = exampleState(spec, analyseSpec(spec), 4);
    expect(ex.ok).toBe(false);
  });

  it('reports preconditions that never hold', () => {
    const spec = lib((s) => (s.operations[1].preds = 'book? ∉ onLoan\nbook? ∈ onLoan\nborrower′ = borrower ∪ {book? ↦ member?}'));
    const ex = exampleOperation(spec, analyseSpec(spec), 'op-lend', 2, 'applicable');
    expect(ex).toMatchObject({ ok: false, reason: 'no-input', message: 'No example found with small values in which the preconditions hold.' });
  });

  it('reports an effect that breaks the invariant', () => {
    const spec = lib((s) => (s.operations[1].preds = 'book? ∉ onLoan\nonLoan′ = onLoan ∪ {book?}\nborrower′ = borrower'));
    const ex = exampleOperation(spec, analyseSpec(spec), 'op-lend', 2, 'applicable');
    expect(ex.ok).toBe(false);
    if (!ex.ok) {
      expect(ex.reason).toBe('no-after');
      expect(ex.message).toBe('No after-state found with small values: ‘onLoan′ = dom borrower′’ fails.');
      expect(ex.failed?.map((c) => c.text)).toContain('onLoan′ = dom borrower′');
      expect(ex.before?.length).toBe(2);
    }
  });

  it('marks undefined applications in checks', () => {
    // without the precondition, a blocked case does not exist, but the state example still checks fine
    const spec = lib((s) => (s.state.preds = 'onLoan = dom borrower\nborrower(book) = borrower(book)'));
    expect(() => exampleState(spec, analyseSpec(spec), 1)).not.toThrow();
    const ex = okOp(exampleOperation(LIBRARY, an, 'op-find', 11, 'blocked'));
    expect(ex.failed?.[0].result).toBe(false);
  });

  it('is deterministic per seed and varies between seeds', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      expect(exampleState(LIBRARY, an, seed)).toEqual(exampleState(LIBRARY, an, seed));
      expect(exampleInit(LIBRARY, an, seed)).toEqual(exampleInit(LIBRARY, an, seed));
      for (const mode of ['applicable', 'blocked'] as const) {
        expect(exampleOperation(LIBRARY, an, 'op-lend', seed, mode)).toEqual(exampleOperation(LIBRARY, an, 'op-lend', seed, mode));
      }
    }
    const runs = new Set(SEEDS.map((s) => JSON.stringify(okOp(exampleOperation(LIBRARY, an, 'op-lend', s, 'applicable')).inputs.map((v) => v.text))));
    expect(runs.size).toBeGreaterThan(8);
  });
});

// ── robustness ─────────────────────────────────────────────────────────────────

describe('robustness', () => {
  // The public functions catch unexpected errors (and log them): none may occur here.
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, 'error');
  });
  afterEach(() => {
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('works for an empty state schema (own topic skeleton)', () => {
    const spec = createSpec('custom', 'Parking Garage');
    const an = analyseSpec(spec);
    expect(okState(exampleState(spec, an, 1)).vars).toEqual([]);
    expect(exampleInit(spec, an, 1)).toMatchObject({ ok: false });
    for (const op of spec.operations) {
      const ex = okOp(exampleOperation(spec, an, op.id, 1, 'applicable'));
      expect(ex.before).toEqual([]);
      expect(exampleOperation(spec, an, op.id, 1, 'blocked')).toMatchObject({ ok: false, reason: 'no-blocked' });
    }
    expect(exampleTypes(spec, an, 1).carriers).toEqual([]);
  });

  it('skips broken predicates and declarations without throwing', () => {
    const broken = [
      (s: SpecDoc) => (s.state.preds = 'onLoan = dom borrower\nonLoan = borrower\nonLoan ⊆'),
      (s: SpecDoc) => (s.state.decls = 'onLoan : ℙ BOOK\nborrower : BOOK ⇸ MEMBR'),
      (s: SpecDoc) => (s.given = '[BOOK, MEMBER'),
      (s: SpecDoc) => (s.operations[1].preds = 'book? ∉ onLon\nborrower′ = borrower ∪ {book? ↦ member?}'),
      (s: SpecDoc) => (s.operations[1].decls = 'ΔLibrary\nbook? : BOOK'),
      (s: SpecDoc) => (s.operations[0].decls = 'book? : BOOK\nmember! : MEMBER'),
      (s: SpecDoc) => (s.state.preds = '∀ n : ℕ • n ∈ onLoan'),
      (s: SpecDoc) => (s.state.preds = 'onLoan = { n : ℕ | n > 3 }'),
      (s: SpecDoc) => (s.state.decls = 'onLoan : ℙ BOOK\nborrower : BOOK → MEMBER\ncount : ℕ\nf : BOOK ⇸ ℙ MEMBER'),
    ];
    for (const patch of broken) {
      const spec = lib(patch);
      const an = analyseSpec(spec);
      for (const seed of [1, 2]) {
        expect(() => exampleTypes(spec, an, seed)).not.toThrow();
        expect(() => exampleState(spec, an, seed)).not.toThrow();
        expect(() => exampleInit(spec, an, seed)).not.toThrow();
        for (const op of spec.operations) {
          for (const mode of ['applicable', 'blocked'] as const) {
            const [, ms] = timed(() => exampleOperation(spec, an, op.id, seed, mode));
            expect(ms).toBeLessThan(150);
          }
        }
      }
    }
  });

  it('handles numbers, nested functions and total functions', () => {
    const spec = lib((s) => {
      s.state.decls = 'stock : BOOK ⇸ ℕ\nlimit : ℕ\nplan : BOOK ⇸ (MEMBER ⇸ ℕ₁)\nday : MEMBER → BOOK';
      s.state.preds = '∀ n : dom stock • stock(n) ≤ limit\nlimit ≥ 3\ndom plan ⊆ dom stock';
      s.init = null;
      s.operations = [
        {
          id: 'op-take',
          role: 'operation',
          name: 'Take',
          decls: 'ΔLibrary\nn? : BOOK\nk? : ℕ₁',
          preds: 'n? ∈ dom stock\nk? ≤ stock(n?)\nstock′ = (stock ∖ {n? ↦ stock(n?)}) ∪ {n? ↦ stock(n?) - k?}\nlimit′ = limit\nplan′ = plan\nday′ = day',
        },
      ];
    });
    const an = analyseSpec(spec);
    expect(an.ok).toBe(true);
    for (const seed of SEEDS.slice(0, 10)) {
      const st = okState(exampleState(spec, an, seed));
      expect(st.checks.every((c) => c.result === true)).toBe(true);
      const day = byName(st.vars, 'day').value;
      expect(elems(day).length).toBe(universeFor(spec, an, seed).carriers.MEMBER.length);
      const ex = okOp(exampleOperation(spec, an, 'op-take', seed, 'applicable'));
      expect(ex.checks.every((c) => c.result === true)).toBe(true);
      expect(byName(ex.after, 'stock′').status).toBe('computed');
      expect(byName(ex.after, 'day′').status).toBe('unchanged');
    }
  });

  it('generates tuples that contain sets (BOOK × ℙ MEMBER)', () => {
    const spec = lib((s) => {
      s.state.decls = 'onLoan : ℙ BOOK\nborrower : BOOK ⇸ MEMBER\nx : BOOK × ℙ MEMBER';
      s.operations[1].decls = 'ΔLibrary\nbook? : BOOK\nmember? : MEMBER\ne? : BOOK × ℙ MEMBER';
    });
    const an = analyseSpec(spec);
    for (const seed of SEEDS.slice(0, 5)) {
      const x = byName(okState(exampleState(spec, an, seed)).vars, 'x').value;
      expect(x.k === 'tuple' && x.elems[0].k === 'atom' && x.elems[1].k === 'set').toBe(true);
      const e = byName(okOp(exampleOperation(spec, an, 'op-lend', seed, 'applicable')).inputs, 'e?').value;
      expect(e.k === 'tuple' && e.elems[1].k === 'set').toBe(true);
    }
  });

  it('ignores fixed data that does not fit the declaration', () => {
    const spec = lib((s) => (s.fixed = { borrower: '{Dune ↦ Ada, Dune ↦ Ben}', onLoan: '{Nobody}' }));
    const ex = okState(exampleState(spec, analyseSpec(spec), 1));
    expect(ex.vars.some((v) => v.fixed)).toBe(false);
  });
});

// ── internals: graded distance and value generation ────────────────────────────

describe('operations from a given state', () => {
  const an = analyseSpec(LIBRARY);
  const u = universeFor(LIBRARY, an, 1);
  const book = (n: string) => u.carriers.BOOK.find((b) => printValue(b) === n)!;
  const member = (n: string) => u.carriers.MEMBER.find((m) => printValue(m) === n)!;
  const loans = (pairs: [string, string][]) => ({
    onLoan: mkSet(pairs.map(([b]) => book(b))),
    borrower: mkSet(pairs.map(([b, m]) => tuple([book(b), member(m)]))),
  });
  const texts = (vs: ShownVar[]) => Object.fromEntries(vs.map((v) => [v.name, v.text]));

  it('keeps the state of the state example and varies the rest', () => {
    const st = okState(exampleState(LIBRARY, an, 3));
    const before = Object.fromEntries(st.vars.map((v) => [v.name, v.value]));
    const inputs = new Set<string>();
    for (const seed of SEEDS) {
      const ex = okOp(exampleOperation(LIBRARY, an, 'op-lend', seed, 'applicable', { before }));
      expect(texts(ex.before)).toEqual(texts(st.vars));
      expect(ex.freshBefore).toBeUndefined();
      expect(ex.checks.every((c) => c.result === true)).toBe(true);
      inputs.add(JSON.stringify(texts(ex.inputs)));
    }
    expect(inputs.size).toBeGreaterThan(3);
  });

  it('finds a blocked case in the given state', () => {
    const before = loans([
      ['Dune', 'Ada'],
      ['Emma', 'Ben'],
    ]);
    for (const seed of SEEDS.slice(0, 8)) {
      const ex = okOp(exampleOperation(LIBRARY, an, 'op-lend', seed, 'blocked', { before }));
      expect(ex.status).toBe('blocked');
      expect(texts(ex.before)).toEqual({ onLoan: '{Dune, Emma}', borrower: '{Dune ↦ Ada, Emma ↦ Ben}' });
      expect(['Dune', 'Emma']).toContain(texts(ex.inputs)['book?']); // lending a book that is on loan
      expect(ex.failed?.map((c) => c.text)).toEqual(['book? ∉ onLoan']);
    }
  });

  it('says when no input works in the given state', () => {
    const all = loans(LIBRARY.pools.BOOK.map((b) => [b, 'Ada'] as [string, string]));
    const lend = exampleOperation(LIBRARY, an, 'op-lend', 1, 'applicable', { before: all });
    expect(lend).toMatchObject({
      ok: false,
      reason: 'no-input-for-state',
      message: 'No input meets the precondition in this example state — try a new example state.',
    });
    expect(lend.ok === false && lend.before?.map((v) => v.text)).toEqual([printValue(all.onLoan), printValue(all.borrower)]);
    // nothing is on loan: FindBorrower has no input, and Lend is never blocked
    const none = loans([]);
    expect(exampleOperation(LIBRARY, an, 'op-find', 1, 'applicable', { before: none })).toMatchObject({ ok: false, reason: 'no-input-for-state' });
    expect(exampleOperation(LIBRARY, an, 'op-lend', 1, 'blocked', { before: none })).toMatchObject({
      ok: false,
      reason: 'no-blocked',
      message: 'No input is blocked in this example state — try a new example state.',
    });
  });

  it('generates variables the given state lacks, keeping the others', () => {
    const { onLoan } = loans([
      ['Dune', 'Ada'],
      ['Hamlet', 'Ben'],
    ]);
    for (const seed of SEEDS.slice(0, 5)) {
      const ex = okOp(exampleOperation(LIBRARY, an, 'op-lend', seed, 'applicable', { before: { onLoan } }));
      expect(texts(ex.before).onLoan).toBe('{Dune, Hamlet}');
      expect(printValue(dom(byName(ex.before, 'borrower').value))).toBe('{Dune, Hamlet}'); // fits the invariant
      expect(ex.checks.every((c) => c.result === true)).toBe(true);
    }
    // a value that no longer fits its declaration (e.g. the pool changed) is generated anew
    const stale = { ...loans([['Dune', 'Ada']]), borrower: mkSet([tuple([book('Dune'), atom('MEMBER', 'Zed', 99)])]) };
    const ex = okOp(exampleOperation(LIBRARY, an, 'op-lend', 2, 'applicable', { before: stale }));
    expect(texts(ex.before)).toEqual({ onLoan: '{Dune}', borrower: expect.stringMatching(/^\{Dune ↦ \w+\}$/) });
    expect(ex.freshBefore).toBeUndefined();
  });

  it('uses a fresh state if the given one no longer fits the spec', () => {
    const broken = { onLoan: mkSet([book('Dune')]), borrower: EMPTY }; // onLoan ≠ dom borrower
    const ex = okOp(exampleOperation(LIBRARY, an, 'op-lend', 1, 'applicable', { before: broken }));
    expect(ex.freshBefore).toBe(true);
    expect(ex.checks.every((c) => c.result === true)).toBe(true);
  });

  it('is unchanged without a given state (the goal checker relies on it)', () => {
    for (const seed of [1, 2, 3]) {
      expect(exampleOperation(LIBRARY, an, 'op-lend', seed, 'applicable', {})).toEqual(exampleOperation(LIBRARY, an, 'op-lend', seed, 'applicable'));
    }
  });
});

describe('infinite sets and the search limits', () => {
  const one = (decls: string, preds: string, given = '[]', infinite: string[] = []): SpecDoc => ({
    topicId: 't',
    title: 'T',
    given,
    pools: {},
    infinite,
    state: { id: 'state', role: 'state', name: 'S', decls, preds },
    init: null,
    operations: [],
  });

  it('marks verdicts that rely on cutting off ℕ as bounded', () => {
    const spec = one('x : ℕ', '∀ n : ℕ • n ≥ 0\nx = 3\n∀ n : 0 .. x • n ≤ 3');
    const ex = okState(exampleState(spec, analyseSpec(spec), 1));
    expect(ex.checks.map((c) => [c.text, c.result, c.bounded ?? false])).toEqual([
      ['∀ n ∈ ℕ . n ≥ 0', true, true],
      ['x = 3', true, false],
      ['∀ n ∈ 0 .. x . n ≤ 3', true, false],
    ]);
  });

  it('uses the numbers of the spec as candidates', () => {
    const spec = one('x : ℕ', '∃ a : ℕ • ∃ b : ℕ • a * b = x ∧ x > 1000');
    const ex = okState(exampleState(spec, analyseSpec(spec), 1));
    expect(ex.vars[0].text).toBe('1001');
    expect(ex.checks[0]).toMatchObject({ result: true });
    expect(ex.checks[0].bounded).toBeUndefined(); // a witness decides exactly
  });

  it('honestly finds no example when only infinite values would do', () => {
    for (const spec of [
      one('s : ℙ ℕ', 's = { n : ℕ | n > 0 }'),
      one('s : ℙ ℕ', '∀ n : ℕ • n ∈ s'),
      one('f : NAME ⇸ DATE', '#f > 1000', '[NAME, DATE]', ['DATE']),
      one('f : DATE ⇸ ℕ', '∀ d : DATE • d ∈ dom f', '[DATE]', ['DATE']),
    ]) {
      const ex = exampleState(spec, analyseSpec(spec), 1);
      expect(ex).toMatchObject({ ok: false, message: 'No example found with small values.' });
    }
  });

  it('checks comprehensions over infinite given sets exactly', () => {
    const spec = one('f : DATE ⇸ ℕ\ns : ℙ DATE', 's = { d : DATE | d ∈ dom f ∧ f(d) > 2 }\n#DATE > 0', '[DATE]', ['DATE']);
    const ex = okState(exampleState(spec, analyseSpec(spec), 1));
    expect(ex.checks.map((c) => [c.result, c.bounded ?? false])).toEqual([
      [true, false],
      [true, true], // #DATE only counts the example dates
    ]);
  });

  it('stays fast for quantifiers over many bindings (the verdict is then ≈)', () => {
    for (const extra of ['∀ a, b ∈ ℙ BOOK . a ∪ b = b ∪ a', '∀ a, b, c ∈ ℙ BOOK . a ∪ (b ∪ c) = (a ∪ b) ∪ c']) {
      const spec = lib((s) => (s.state.preds += `\n${extra}`));
      const an = analyseSpec(spec);
      const wall = performance.now();
      const [st, ms] = timed(() => exampleState(spec, an, 1));
      const [op, ms2] = timed(() => exampleOperation(spec, an, 'op-lend', 1, 'applicable'));
      expect(ms + ms2, extra).toBeLessThan(100);
      expect(performance.now() - wall).toBeLessThan(2000); // (minutes before the work limit)
      const mine = (c: { text: string }) => c.text.startsWith(extra.slice(0, 14));
      expect(okState(st).checks.find(mine)).toMatchObject({ result: true, bounded: true });
      expect(okOp(op).checks.filter(mine).map((c) => [c.origin, c.result, c.bounded])).toEqual([
        ['invariant', true, true],
        ['invariant′', true, true],
      ]);
    }
  });

  it('gives exact verdicts for all templates (none relies on a cut-off)', () => {
    for (const t of TEMPLATES) {
      const spec = fullSpec(t);
      const an = analyseSpec(spec);
      const checks = [
        ...okState(exampleState(spec, an, 1)).checks,
        ...spec.operations.flatMap((op) => okOp(exampleOperation(spec, an, op.id, 1, 'applicable')).checks),
      ];
      expect(checks.filter((c) => c.bounded).map((c) => c.text), t.id).toEqual([]);
    }
  });
});

describe('distance used by the search', () => {
  const T = (src: string) => {
    const r = parseTerm(src);
    if (!r.term) throw new Error(src);
    return r.term;
  };
  const u = makeUniverse({ BOOK: ['Dune', 'Emma', 'Hamlet', 'Ulysses'], MEMBER: ['Ada', 'Ben', 'Cleo'] }, { intMin: -5, intMax: 20 });
  const preds = [
    'onLoan = dom borrower',
    'onLoan ⊆ dom borrower',
    'onLoan ⊂ dom borrower',
    'dom borrower ∩ onLoan = ∅',
    'book? ∈ onLoan ∨ borrower(book?) = member?',
    'book? ∈ onLoan ⇒ borrower(book?) = member?',
    'borrower(book?) = member? ⇒ book? ∈ onLoan',
    'book? ∉ onLoan ∧ borrower(book?) = member?',
    '∀ b : onLoan • borrower(b) ≠ member?',
    '∀ b : BOOK | b ∈ onLoan • borrower(b) ≠ member?',
    '∀ a, b : dom borrower • borrower(a) = borrower(b) ⇒ a = b',
    '∀ a, b : BOOK; m : MEMBER • (a ↦ m) ∈ borrower ∧ borrower(b) = m ⇒ a = b',
    '∀ a : BOOK; m : MEMBER • borrower(a) = m ⇒ a ∈ onLoan',
    '∃ b : onLoan • borrower(b) = member?',
    '#onLoan ≤ count',
    '#onLoan + count > 4',
    '¬ (onLoan = ∅)',
    'onLoan = ∅ ⇔ borrower = ∅',
    '{ b : onLoan | borrower(b) = member? } = onLoan',
    '∀ n : ℕ • n ≤ count + 20',
    '∀ n : ℕ | n > 3 • n ≥ count',
    '∃ n : ℕ • n > count * 100',
    '{ n : ℕ | n < count } = 0 .. count - 1',
  ];
  const rng = makeRng(42, 'dist-test');
  const books = u.carriers.BOOK;
  const members = u.carriers.MEMBER;

  it('is 0 exactly when the evaluator says true', () => {
    for (let i = 0; i < 300; i++) {
      const onLoan = mkSet(rng.sample(books, rng.int(5)));
      const borrower = mkSet(rng.sample(books, rng.int(5)).map((b) => ({ k: 'tuple' as const, elems: [b, rng.pick(members)] })));
      const env = new Map<string, Value>([
        ['onLoan', onLoan],
        ['borrower', borrower],
        ['book?', rng.pick(books)],
        ['member?', rng.pick(members)],
        ['count', { k: 'int', v: rng.int(6) }],
      ]);
      for (const src of preds) {
        const t = T(src);
        let expected: boolean;
        try {
          expected = evalPred(t, env, u);
        } catch {
          expected = false;
        }
        expect(dist(t, env, u) === 0, `${src} in ${[...env].map(([k, v]) => `${k} = ${printValue(v)}`).join('; ')}`).toBe(expected);
      }
    }
  });
});

// ── the six templates ──────────────────────────────────────────────────────────

describe('templates', () => {
  it('has the six templates', () => {
    expect(TEMPLATES.length).toBe(6);
  });

  const variants = [
    { label: 'student', make: studentSpec },
    { label: 'full', make: fullSpec },
  ];

  for (const { label, make } of variants) {
    it(`produce applicable examples within the time budget (${label} version)`, () => {
      const wall = performance.now();
      const times: number[] = [];
      const rows: string[] = [];
      for (const t of TEMPLATES) {
        const spec = make(t);
        const an = analyseSpec(spec);
        expect(an.ok, `${t.id}: ${an.diagnostics.map((d) => d.message).join('; ')}`).toBe(true);
        exampleState(spec, an, 0); // warm-up
        const perKind: Record<string, number[]> = {};
        const note = (kind: string, ms: number) => {
          (perKind[kind] ??= []).push(ms);
          times.push(ms);
        };
        for (const seed of SEEDS) {
          const [st, ms1] = timed(() => exampleState(spec, an, seed));
          note('state', ms1);
          const s = okState(st);
          expect(s.checks.every((c) => c.result === true)).toBe(true);
          for (const [name, text] of Object.entries(spec.fixed ?? {})) {
            const v = byName(s.vars, name);
            expect(v.fixed, `${t.id} ${name}`).toBe(true);
            for (const m of text.replace(/^\{|\}$/g, '').split(', ')) expect(v.text).toContain(m);
          }
          if (spec.init) {
            const [ini, ms2] = timed(() => exampleInit(spec, an, seed));
            note('init', ms2);
            expect(okState(ini).checks.every((c) => c.result === true)).toBe(true);
          }
          for (const op of spec.operations) {
            const [ex, ms3] = timed(() => exampleOperation(spec, an, op.id, seed, 'applicable'));
            note(op.name, ms3);
            const e = okOp(ex);
            expect(e.checks.every((c) => c.result === true), `${t.id} ${op.name} ${seed}`).toBe(true);
            for (const v of [...e.after, ...e.outputs]) {
              expect(v.status).toBeDefined();
              if (v.status === 'free') expect(v.alternative).toBeDefined();
            }
            for (const v of e.before) if (spec.fixed?.[v.name]) expect(v.fixed).toBe(true);
            const [bl, ms4] = timed(() => exampleOperation(spec, an, op.id, seed, 'blocked'));
            note(op.name + ' (blocked)', ms4);
            if (bl.ok) {
              expect(bl.status).toBe('blocked');
              expect(bl.failed?.length).toBeGreaterThan(0);
              expect(bl.checks.filter((c) => c.origin === 'invariant').every((c) => c.result === true)).toBe(true);
            } else expect(bl.reason).toBe('no-blocked');
          }
        }
        for (const [kind, ms] of Object.entries(perKind)) {
          const sorted = [...ms].sort((a, b) => a - b);
          rows.push(`${t.id.padEnd(22)} ${kind.padEnd(28)} median ${sorted[sorted.length >> 1].toFixed(1).padStart(5)} ms   max ${sorted[sorted.length - 1].toFixed(1).padStart(5)} ms`);
        }
      }
      console.log(`example timings (${label} templates, ${SEEDS.length} seeds):\n${rows.join('\n')}`);
      const sorted = [...times].sort((a, b) => a - b);
      expect(sorted[Math.floor(sorted.length * 0.95)]).toBeLessThan(30);
      expect(sorted[sorted.length - 1]).toBeLessThan(90);
      // and in real time (~1–2 s on a laptop; generous, as tests may run under load)
      expect(performance.now() - wall).toBeLessThan(30000);
    }, 60000); // (vitest's 5 s are too short when several runs share the machine)
  }

  it('finds blocked cases that follow from the invariant after (medication Prescribe)', () => {
    const t = TEMPLATES.find((x) => x.id === 'medication');
    if (!t) throw new Error('medication template missing');
    const spec = fullSpec(t);
    const op = spec.operations.find((o) => o.name === 'Prescribe')!;
    op.preds = 'prescribed′ = prescribed ∪ {p? ↦ drug?}';
    const an = analyseSpec(spec);
    let outside = 0;
    for (const seed of SEEDS.slice(0, 8)) {
      const ex = okOp(exampleOperation(spec, an, op.id, seed, 'blocked'));
      expect(ex.status).toBe('blocked');
      const patients = byName(ex.before, 'patients').value;
      const allergic = byName(ex.before, 'allergic').value;
      const p = byName(ex.inputs, 'p?').value;
      const pd = tuple([p, byName(ex.inputs, 'drug?').value]);
      const notAdmitted = !elems(patients).some((x) => printValue(x) === printValue(p));
      const isAllergic = elems(allergic).some((x) => printValue(x) === printValue(pd));
      // no after-state satisfies the invariant: p? is not a patient, or p? is allergic to drug?
      expect(notAdmitted || isAllergic).toBe(true);
      if (notAdmitted) outside++;
      expect(ex.failed?.length).toBeGreaterThan(0);
      expect(ex.failed!.map((c) => c.text)).toContain(notAdmitted ? 'dom prescribed′ ⊆ patients′' : 'prescribed′ ∩ allergic′ = ∅');
      expect(ex.checks.filter((c) => c.origin === 'invariant').every((c) => c.result === true)).toBe(true);
    }
    expect(outside).toBeGreaterThan(0);
  });

  it('says "never blocked" only when that is certain', () => {
    const access = TEMPLATES.find((x) => x.id === 'access-control');
    if (!access) throw new Error('access-control template missing');
    const spec = fullSpec(access);
    const grant = spec.operations.find((o) => o.name === 'GrantPermission')!;
    expect(exampleOperation(spec, analyseSpec(spec), grant.id, 1, 'blocked')).toMatchObject({
      ok: false,
      reason: 'no-blocked',
      message: 'GrantPermission has no precondition, so it is never blocked.',
    });
    // LoansOf is never blocked either, but books! = { b ∈ onLoan | borrower(b) = member? } needs
    // the invariant to be defined: not certain here
    const lib2 = lib((s) => s.operations.push(structuredClone(LOANS_OF)));
    expect(exampleOperation(lib2, analyseSpec(lib2), 'op-loans', 1, 'blocked')).toMatchObject({
      ok: false,
      reason: 'no-blocked',
      message: 'No blocked case found.',
    });
  });

  it('checks number quantifiers against the numbers in the example (bank)', () => {
    const t = TEMPLATES.find((x) => x.id === 'bank-account');
    if (!t) throw new Error('bank-account template missing');
    const spec = fullSpec(t);
    spec.state.preds = 'dom balance = dom owner\ndom overdraft = dom owner\n∀ a ∈ dom balance; b ∈ ℤ . (a ↦ b) ∈ balance ⇒ b ≥ -overdraft(a)';
    const query = spec.operations.find((o) => o.name === 'QueryBalance')!;
    query.preds = 'a? ∈ dom owner\nowner(a?) = p?\n∀ x ∈ ℤ . (a? ↦ x) ∈ balance ⇒ b! = x';
    const an = analyseSpec(spec);
    const u = universeFor(spec, an, 1);
    for (const seed of SEEDS.slice(0, 8)) {
      const st = okState(exampleState(spec, an, seed));
      const env = new Map(st.vars.map((v) => [v.name, v.value] as [string, Value]));
      expect(evalPred(parseTerm('∀ a ∈ dom balance . balance(a) ≥ -overdraft(a)').term!, env, u)).toBe(true);
      const ex = okOp(exampleOperation(spec, an, query.id, seed, 'applicable'));
      const opEnv = new Map([...ex.before, ...ex.inputs, ...ex.outputs].map((v) => [v.name, v.value] as [string, Value]));
      expect(evalPred(parseTerm('b! = balance(a?)').term!, opEnv, u)).toBe(true);
    }
  });

  it('works with products of infinite given sets (medication)', () => {
    const t = TEMPLATES.find((x) => x.id === 'medication');
    if (!t) throw new Error('medication template missing');
    const spec = fullSpec(t);
    spec.state.preds = 'dom allergic ⊆ patients\ndom prescribed ⊆ patients\nprescribed ⊆ (PATIENT × DRUG) ∖ allergic';
    const op = spec.operations.find((o) => o.name === 'Prescribe')!;
    op.preds = 'p? ∈ patients\n(p? ↦ drug?) ∉ allergic\nprescribed′ = { x ∈ PATIENT × DRUG | x ∈ prescribed ∨ x = (p? ↦ drug?) }';
    const an = analyseSpec(spec);
    for (const seed of SEEDS.slice(0, 5)) {
      const st = okState(exampleState(spec, an, seed));
      expect(st.checks.every((c) => c.result === true && !c.bounded)).toBe(true);
      const ex = okOp(exampleOperation(spec, an, op.id, seed, 'applicable'));
      expect(ex.checks.every((c) => c.result === true && !c.bounded)).toBe(true);
      expect(byName(ex.after, 'prescribed′').status).toBe('computed');
    }
  });

  it('says when an undefined application is why there is no example (air traffic)', () => {
    const t = TEMPLATES.find((x) => x.id === 'air-traffic-control');
    if (!t) throw new Error('air-traffic-control template missing');
    const spec = fullSpec(t);
    spec.state.preds = spec.state.preds.replace('∀ a₁, a₂ ∈ dom cleared .', '∀ a₁, a₂ ∈ AIRCRAFT .');
    const an = analyseSpec(spec);
    const why = 'cleared(a₁) is undefined when a₁ ∉ dom cleared.';
    const st = exampleState(spec, an, 1);
    expect(st).toMatchObject({ ok: false, message: `No example found with small values: ${why}` });
    if (!st.ok) expect(st.best?.failed[0].message).toMatch(/^cleared\(a₁\) is undefined: a₁ = \w+ ∉ dom cleared$/);
    expect(exampleOperation(spec, an, spec.operations[0].id, 1, 'applicable')).toMatchObject({
      ok: false,
      reason: 'no-before',
      message: `No example state found with small values: ${why}`,
    });
  });

  it('takes value pools and fixed data through a binding (renamed sets and variables)', () => {
    const rail = TEMPLATES.find((x) => x.id === 'railway-interlocking');
    const blood = TEMPLATES.find((x) => x.id === 'blood-transfusion');
    if (!rail || !blood) throw new Error('template missing');
    // [Trains, Blocks, Signals] with protection renamed
    const r = fullSpec(rail);
    const rename = (text: string) =>
      text.replace(/\bTRAIN\b/g, 'Trains').replace(/\bBLOCK\b/g, 'Blocks').replace(/\bSIGNAL\b/g, 'Signals').replace(/\bprotects\b/g, 'guards');
    r.given = rename(r.given);
    r.state.decls = rename(r.state.decls);
    r.state.preds = rename(r.state.preds);
    r.init = null;
    r.operations = [];
    const rb = { givens: { Trains: 'TRAIN', Blocks: 'BLOCK', Signals: 'SIGNAL' }, vars: { guards: { ref: 'protects' } } };
    const ra = analyseSpec(r);
    expect(ra.ok).toBe(true);
    expect(exampleTypes(r, ra, 1, rb).carriers.map((c) => [c.name, c.values[0]])).toEqual([
      ['Trains', 'ICE5'],
      ['Blocks', 'B1'],
      ['Signals', 'S1'],
    ]);
    const rs = okState(exampleState(r, ra, 1, { binding: rb }));
    expect(byName(rs.vars, 'guards')).toMatchObject({ fixed: true, text: '{S1 ↦ B2, S2 ↦ B3, S3 ↦ B4, S4 ↦ B3, S5 ↦ B2, S6 ↦ B1}' });
    // without the binding: generated names, no fixed data
    expect(exampleTypes(r, ra, 1).carriers[0].values[0]).toBe('trains1');
    // values the student gave the set (Types panel) win over the bound pool
    const own = { ...r, pools: { ...r.pools, Trains: ['T1', 'T2'] } };
    expect(exampleTypes(own, ra, 1, rb).carriers[0].values).toEqual(['T1', 'T2']);

    // blood transfusion: compatible renamed, or written the other way round
    const b = fullSpec(blood);
    b.state.decls = b.state.decls.replace('compatible : BLOODTYPE ↔ BLOODTYPE', 'canReceiveFrom : BLOODTYPE ↔ BLOODTYPE');
    b.state.preds = b.state.preds.replace('(unitType(u) ↦ patientType(issued(u))) ∈ compatible', '(patientType(issued(u)) ↦ unitType(u)) ∈ canReceiveFrom');
    b.init = null;
    b.operations = [];
    const ba = analyseSpec(b);
    expect(ba.ok).toBe(true);
    const bb = { givens: { UNIT: 'UNIT', PATIENT: 'PATIENT', BLOODTYPE: 'BLOODTYPE' }, vars: { canReceiveFrom: { ref: 'compatible', inverse: true } } };
    const bs = okState(exampleState(b, ba, 1, { binding: bb }));
    const table = byName(bs.vars, 'canReceiveFrom');
    expect(table.fixed).toBe(true);
    expect(table.text).toContain('Opos ↦ Oneg'); // compatible has Oneg ↦ Opos
    expect(table.text).not.toContain('Oneg ↦ Opos');
    expect(bs.checks.every((c) => c.result === true)).toBe(true);
  });

  it('uses fixed values whatever the time budget (blood transfusion: compatible)', () => {
    const t = TEMPLATES.find((x) => x.id === 'blood-transfusion');
    if (!t) throw new Error('blood-transfusion template missing');
    const spec = fullSpec(t);
    const an = analyseSpec(spec);
    const table = printValue(okState(exampleState(spec, an, 1)).vars.find((v) => v.name === 'compatible')!.value);
    let shown = 0;
    for (const budgetMs of [0.05, 0.2, 0.5, 1, 2, 4]) {
      for (const seed of SEEDS.slice(0, 5)) {
        const runs: ShownVar[][] = [];
        const st = exampleState(spec, an, seed, { budgetMs });
        if (st.ok) runs.push(st.vars);
        for (const op of spec.operations) {
          const ex = exampleOperation(spec, an, op.id, seed, 'applicable', { budgetMs: budgetMs * 2 });
          if (ex.ok) runs.push(ex.before);
        }
        for (const vars of runs) {
          const c = byName(vars, 'compatible');
          expect(c.fixed, `budget ${budgetMs}, seed ${seed}`).toBe(true);
          expect(c.text).toBe(table);
          shown++;
        }
      }
    }
    expect(shown).toBeGreaterThan(20);
  });

  it('shows what the student has not specified yet as unchanged (medication Prescribe)', () => {
    const t = TEMPLATES.find((x) => x.id === 'medication');
    if (!t) throw new Error('medication template missing');
    const spec = studentSpec(t);
    const an = analyseSpec(spec);
    const op = spec.operations.find((o) => o.opKind === 'update');
    if (!op) throw new Error('no update operation');
    for (const seed of SEEDS.slice(0, 5)) {
      const ex = okOp(exampleOperation(spec, an, op.id, seed, 'applicable'));
      // prescribed′ is not mentioned yet, so it stays unchanged (frame convention)
      expect(byName(ex.after, 'prescribed′').status).toBe('unchanged');
      expect(byName(ex.after, 'patients′').status).toBe('unchanged');
      expect(byName(ex.after, 'allergic′').status).toBe('unchanged');
    }
  });

  it('flags initial values that Init leaves open (air traffic: occupied)', () => {
    const t = TEMPLATES.find((x) => x.id === 'air-traffic-control');
    if (!t) throw new Error('air-traffic-control template missing');
    const spec = studentSpec(t);
    const an = analyseSpec(spec);
    for (const seed of SEEDS.slice(0, 5)) {
      const ex = okState(exampleInit(spec, an, seed));
      expect(byName(ex.vars, 'approaching').status).toBe('computed');
      expect(byName(ex.vars, 'cleared')).toMatchObject({ text: '∅', status: 'computed' });
      const occ = byName(ex.vars, 'occupied');
      expect(occ.status).toBe('free');
      expect(occ.alternative).not.toBe(occ.text);
    }
  });

  it('shows changes in update operations', () => {
    for (const t of TEMPLATES) {
      const spec = fullSpec(t);
      const an = analyseSpec(spec);
      const op = spec.operations.find((o) => o.decls.startsWith('Δ'));
      if (!op) continue;
      let changed = 0;
      for (const seed of SEEDS) {
        const ex = okOp(exampleOperation(spec, an, op.id, seed, 'applicable'));
        if (ex.after.some((v) => v.status === 'computed')) changed++;
      }
      expect(changed, t.id).toBeGreaterThanOrEqual(18);
    }
  });
});
