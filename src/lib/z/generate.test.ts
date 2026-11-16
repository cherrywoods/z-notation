import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY, LOANS_OF } from './testing/library';
import type { SchemaDoc, SchemaRole, SpecDoc } from '../spec/model';
import { createSpec } from '../spec/topics';
import { exampleInit, exampleOperation, exampleState, exampleTypes, universeFor } from './generate';
import { analyseSpec } from './index';
import type { OpExample, ShownVar, StateExample } from './results';
import { evalPred, makeUniverse } from './eval';
import { dist } from './gen/dist';
import { makeRng } from './gen/rng';
import { parseTerm } from './parser';
import { mkSet, printValue, type Value } from './values';

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
  givenSets: { name: string; values?: string[] }[];
  fixedValues?: Record<string, string>;
  state: TSchema;
  init?: TSchema | null;
  operations: TSchema[];
  extraOperations?: TSchema[];
}

const TEMPLATES = Object.entries(
  import.meta.glob('/templates/*.json', { eager: true, import: 'default' }) as Record<string, Template>,
).map(([path, t]) => ({ ...t, id: path.replace(/^.*\//, '').replace(/\.json$/, '') }));

/** The template as the student first sees it (hidden lines left out), plus its fixed data. */
function studentSpec(t: Template): SpecDoc {
  const spec = createSpec(t.id);
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

/** Run `f`, return its result and the time it took (ms). */
function timed<T>(f: () => T): [T, number] {
  const t = performance.now();
  const r = f();
  return [r, performance.now() - t];
}

// ── universe ───────────────────────────────────────────────────────────────────

describe('universe', () => {
  const an = analyseSpec(LIBRARY);

  it('takes 4–6 values of each pool, in pool order', () => {
    for (const seed of SEEDS) {
      const u = universeFor(LIBRARY, an, seed);
      for (const set of ['BOOK', 'MEMBER']) {
        const names = u.carriers[set].map(printValue);
        expect(names.length).toBeGreaterThanOrEqual(4);
        expect(names.length).toBeLessThanOrEqual(6);
        const pool = LIBRARY.pools[set];
        const idx = names.map((n) => pool.indexOf(n));
        expect(idx.every((i) => i >= 0)).toBe(true);
        expect([...idx].sort((a, b) => a - b)).toEqual(idx);
      }
    }
    const variants = new Set(SEEDS.map((s) => universeFor(LIBRARY, an, s).carriers.BOOK.map(printValue).join()));
    expect(variants.size).toBeGreaterThan(5);
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

  it('flags borrower′ as free when the effect is missing', () => {
    const spec = lib((s) => (s.operations[1].preds = 'book? ∉ onLoan'));
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
      expect(ex.message).toBe('No state satisfies all predicates.');
      expect(ex.best?.failed.map((c) => c.text)).toContain('onLoan ≠ ∅');
    }
    expect(ms).toBeLessThan(100);
    const op = exampleOperation(spec, an2, 'op-lend', 1, 'applicable');
    expect(op).toMatchObject({ ok: false, reason: 'no-before', message: 'No state satisfies the invariant.' });
  });

  it('reports a contradiction that needs search', () => {
    const spec = lib((s) => (s.state.preds = 'onLoan = dom borrower\n#onLoan > 2\n#borrower < 2'));
    const ex = exampleState(spec, analyseSpec(spec), 4);
    expect(ex.ok).toBe(false);
  });

  it('reports preconditions that never hold', () => {
    const spec = lib((s) => (s.operations[1].preds = 'book? ∉ onLoan\nbook? ∈ onLoan\nborrower′ = borrower ∪ {book? ↦ member?}'));
    const ex = exampleOperation(spec, analyseSpec(spec), 'op-lend', 2, 'applicable');
    expect(ex).toMatchObject({ ok: false, reason: 'no-input', message: 'No state and inputs satisfy the preconditions.' });
  });

  it('reports an effect that breaks the invariant', () => {
    const spec = lib((s) => (s.operations[1].preds = 'book? ∉ onLoan\nonLoan′ = onLoan ∪ {book?}\nborrower′ = borrower'));
    const ex = exampleOperation(spec, analyseSpec(spec), 'op-lend', 2, 'applicable');
    expect(ex.ok).toBe(false);
    if (!ex.ok) {
      expect(ex.reason).toBe('no-after');
      expect(ex.message).toBe('No after-state fits: the effect breaks ‘onLoan′ = dom borrower′’.');
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

  it('ignores fixed data that does not fit the declaration', () => {
    const spec = lib((s) => (s.fixed = { borrower: '{Dune ↦ Ada, Dune ↦ Ben}', onLoan: '{Nobody}' }));
    const ex = okState(exampleState(spec, analyseSpec(spec), 1));
    expect(ex.vars.some((v) => v.fixed)).toBe(false);
  });
});

// ── internals: graded distance and value generation ────────────────────────────

describe('real numbers (ℝ)', () => {
  const ward: SpecDoc = {
    topicId: 'ward',
    title: 'Ward',
    given: '[SENSOR]',
    pools: { SENSOR: ['s1', 's2', 's3', 's4', 's5'] },
    state: {
      id: 'state',
      role: 'state',
      name: 'Ward',
      decls: 'temperature : SENSOR ⇸ ℝ\nalarms : ℕ\nprice : ℝ',
      preds: '∀ s : dom temperature • temperature(s) ≥ 0',
    },
    init: null,
    operations: [
      {
        id: 'op-rec',
        role: 'operation',
        opKind: 'update',
        name: 'Record',
        decls: 'ΔWard\ns? : SENSOR\nt? : ℝ',
        preds: 's? ∉ dom temperature\nt? > 36.5\ntemperature′ = temperature ∪ {s? ↦ t?}\nalarms′ = alarms\nprice′ = price',
      },
    ],
  };
  const readable = /^-?\d+(\.\d{1,2})?$/;
  const num = (v: Value) => (v.k === 'int' ? v.v : NaN);

  it('generates short decimals for ℝ and whole numbers for ℕ', () => {
    const an = analyseSpec(ward);
    expect(an.diagnostics).toEqual([]);
    let decimals = 0;
    for (const seed of SEEDS) {
      const st = okState(exampleState(ward, an, seed));
      expect(st.checks.every((c) => c.result === true)).toBe(true);
      const temps = elems(byName(st.vars, 'temperature').value).map((p) => (p.k === 'tuple' ? num(p.elems[1]) : NaN));
      for (const t of temps) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(String(t)).toMatch(readable);
        if (!Number.isInteger(t)) decimals++;
      }
      expect(Number.isInteger(num(byName(st.vars, 'alarms').value))).toBe(true);
      expect(byName(st.vars, 'price').text).toMatch(readable);
    }
    expect(decimals).toBeGreaterThan(10);
  });

  it('solves constraints on decimals', () => {
    const an = analyseSpec(ward);
    for (const seed of SEEDS.slice(0, 10)) {
      const ex = okOp(exampleOperation(ward, an, 'op-rec', seed, 'applicable'));
      expect(ex.checks.every((c) => c.result === true)).toBe(true);
      const t = byName(ex.inputs, 't?');
      expect(num(t.value)).toBeGreaterThan(36.5);
      expect(t.text).toMatch(readable);
      expect(byName(ex.after, 'temperature′').text).toContain(`↦ ${t.text}`);
    }
  });

  it('measures the distance of comparisons with decimals', () => {
    const T = (src: string) => parseTerm(src).term!;
    const u = makeUniverse({});
    const env = (x: number, y: number) => new Map<string, Value>([['x', { k: 'int', v: x }], ['y', { k: 'int', v: y }]]);
    expect(dist(T('x < y'), env(1, 1.5), u)).toBe(0);
    expect(dist(T('x > y'), env(1.5, 1.25), u)).toBe(0);
    expect(dist(T('x ≥ y'), env(1, 1.5), u)).toBeGreaterThan(0);
    // closer is better
    expect(dist(T('x > y'), env(1, 1.5), u)).toBeLessThan(dist(T('x > y'), env(1, 3), u));
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
    });
  }

  it('flags what the student has not specified yet as free (medication Prescribe)', () => {
    const t = TEMPLATES.find((x) => x.id === 'medication');
    if (!t) throw new Error('medication template missing');
    const spec = studentSpec(t);
    const an = analyseSpec(spec);
    const op = spec.operations.find((o) => o.opKind === 'update');
    if (!op) throw new Error('no update operation');
    for (const seed of SEEDS.slice(0, 5)) {
      const ex = okOp(exampleOperation(spec, an, op.id, seed, 'applicable'));
      expect(byName(ex.after, 'prescribed′').status).toBe('free');
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
