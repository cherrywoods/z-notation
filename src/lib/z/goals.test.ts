import { describe, expect, it } from 'vitest';
import type { SpecDoc } from '../spec/model';
import { TOPICS, createSpec, goalsOf, referenceSpecOf } from '../spec/topics';
import { checkGoals, clearGoalCache, exampleBinding, type GoalStatus, type TemplateGoals } from './goals';
import { analyseSpec } from './index';
import { lex } from './lexer';

interface T {
  id: string;
  ref: SpecDoc;
  goals: TemplateGoals;
}
const TEMPLATES: T[] = TOPICS.flatMap((t) => {
  const ref = referenceSpecOf(t.id);
  const goals = goalsOf(t.id);
  return ref && goals ? [{ id: t.id, ref, goals }] : [];
});
const byId = (id: string) => TEMPLATES.find((t) => t.id === id)!;

const run = (spec: SpecDoc, t: T) => checkGoals(spec, analyseSpec(spec), t.ref, t.goals);
/** Flat list "step: goal" of goals with the given status. */
const listed = (r: Record<string, GoalStatus[]>, achieved: boolean) =>
  Object.entries(r).flatMap(([k, gs]) => gs.filter((g) => g.achieved === achieved).map((g) => `${k}: ${g.text}`));
/** Goals whose status differs between two results. */
const flipped = (a: Record<string, GoalStatus[]>, b: Record<string, GoalStatus[]>) =>
  Object.entries(a).flatMap(([k, gs]) => gs.filter((g, i) => b[k][i].achieved !== g.achieved).map((g) => `${k}: ${g.text}`));

/** A copy of the spec with one predicate line removed from a schema. */
function withoutLine(spec: SpecDoc, opName: string | 'state', line: string): SpecDoc {
  const s = structuredClone(spec);
  const doc = opName === 'state' ? s.state : s.operations.find((o) => o.name === opName)!;
  const lines = doc.preds.split('\n');
  expect(lines, `${opName} has ${line}`).toContain(line);
  doc.preds = lines.filter((l) => l !== line).join('\n');
  return s;
}

/** Rename every state variable, input and output (all occurrences, decorations kept). */
function renameVariables(spec: SpecDoc): SpecDoc {
  const an = analyseSpec(spec);
  const bases = [...new Set(an.schemas.flatMap((s) => s.vars.filter((v) => v.role !== 'local').map((v) => v.base)))];
  const names = new Map(bases.map((b, i) => [b, `zq${i}`]));
  const fix = (text: string) => {
    let out = '';
    let pos = 0;
    for (const t of lex(text)) {
      if (t.kind !== 'ident' || !names.has(t.base!)) continue;
      out += text.slice(pos, t.from) + names.get(t.base!) + (t.decoration ?? '');
      pos = t.to;
    }
    return out + text.slice(pos);
  };
  const s = structuredClone(spec);
  for (const d of [s.state, s.init, ...s.operations]) {
    if (!d) continue;
    d.decls = fix(d.decls);
    d.preds = fix(d.preds);
  }
  return s;
}

describe('goals of the templates', () => {
  it('has goals for every template', () => {
    expect(TEMPLATES.length).toBe(6);
    expect(TEMPLATES.every((t) => Object.keys(t.goals.ops ?? {}).length > 0)).toBe(true);
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as [string, T]))('the reference spec achieves all goals: %s', (_, t) => {
    const r = run(t.ref, t);
    expect(listed(r, false)).toEqual([]);
    // every operation with goals has a result under its id
    for (const name of Object.keys(t.goals.ops ?? {})) {
      const id = t.ref.operations.find((o) => o.name === name)?.id;
      expect(id && r[id], name).toBeTruthy();
    }
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as [string, T]))('the bare start achieves none: %s', (_, t) => {
    expect(listed(run(createSpec(t.id), t), true)).toEqual([]);
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as [string, T]))('names never matter: %s', (_, t) => {
    const renamed = renameVariables(t.ref);
    expect(analyseSpec(renamed).ok).toBe(true);
    expect(renamed.state.decls).not.toBe(t.ref.state.decls);
    expect(listed(run(renamed, t), false)).toEqual([]);
  });

  it('is fast, and faster again when nothing changed', () => {
    for (const t of TEMPLATES) {
      clearGoalCache();
      const an = analyseSpec(t.ref);
      const t0 = performance.now();
      checkGoals(t.ref, an, t.ref, t.goals);
      const cold = performance.now() - t0;
      const t1 = performance.now();
      checkGoals(t.ref, an, t.ref, t.goals);
      const warm = performance.now() - t1;
      expect(cold, t.id).toBeLessThan(600); // ~30–130 ms on a laptop
      expect(warm, t.id).toBeLessThan(20); // < 1 ms: everything is memoised
    }
  });
});

describe('goals react to the right changes', () => {
  const bank = byId('bank-account');
  const access = byId('access-control');
  const medication = byId('medication');

  it('meets frame goals without frame lines (unmentioned variables stay unchanged)', () => {
    const noFrame = withoutLine(withoutLine(bank.ref, 'Withdraw', 'owner′ = owner'), 'Withdraw', 'overdraft′ = overdraft');
    expect(flipped(run(bank.ref, bank), run(noFrame, bank))).toEqual([]);
    expect(flipped(run(access.ref, access), run(withoutLine(access.ref, 'AssignRole', 'grants′ = grants'), access))).toEqual([]);
  });

  it('a weaker frame line flips exactly its goal', () => {
    const s = structuredClone(bank.ref);
    const op = s.operations.find((o) => o.name === 'Withdraw')!;
    op.preds = op.preds.replace('owner′ = owner', 'dom owner′ = dom owner'); // owner′ is mentioned, but may change
    expect(flipped(run(bank.ref, bank), run(s, bank))).toEqual(['op-withdraw: Leave owners and limits unchanged']);
  });

  it('dropping a safety precondition flips exactly its goal', () => {
    expect(flipped(run(bank.ref, bank), run(withoutLine(bank.ref, 'Withdraw', 'owner(a?) = p?'), bank))).toEqual([
      'op-withdraw: Only the owner may withdraw',
    ]);
    expect(flipped(run(bank.ref, bank), run(withoutLine(bank.ref, 'QueryBalance', 'owner(a?) = p?'), bank))).toEqual([
      'op-query-balance: Only the owner may ask',
    ]);
  });

  it('dropping an invariant flips its goal', () => {
    expect(flipped(run(medication.ref, medication), run(withoutLine(medication.ref, 'state', 'prescribed ∩ allergic = ∅'), medication))).toEqual([
      'state: Nobody gets a drug they are allergic to',
    ]);
  });

  it('a contradictory invariant makes every “holds” goal false', () => {
    const s = structuredClone(medication.ref);
    s.state.preds += '\n#patients > 3 ∧ #patients < 2';
    const r = run(s, medication);
    const holds = (step: string) => {
      const gs = step === 'state' || step === 'init' ? medication.goals[step]! : Object.values(medication.goals.ops ?? {}).flat();
      return gs.filter((g) => g.check.holds).map((g) => g.text);
    };
    expect(r.state.filter((g) => !g.achieved).map((g) => g.text)).toEqual([...holds('state'), 'Allows every state the requirements allow']);
    expect(r.init.every((g) => !g.achieved)).toBe(true);
    // variables still count
    expect(r.state.filter((g) => g.achieved).length).toBe(medication.goals.state!.filter((g) => !g.check.holds).length);
  });

  it('matches given sets by name (case and plural ignored) and variables by type', () => {
    const s = structuredClone(medication.ref);
    s.given = '[Patients, drug]';
    s.pools = { Patients: s.pools.PATIENT ?? [], drug: s.pools.DRUG ?? [] };
    for (const d of [s.state, s.init!, ...s.operations]) {
      d.decls = d.decls.replace(/PATIENT/g, 'Patients').replace(/DRUG/g, 'drug');
      d.preds = d.preds.replace(/PATIENT/g, 'Patients').replace(/DRUG/g, 'drug');
    }
    // the two relations of the same type in the other order
    s.state.decls = s.state.decls.split('\n').reverse().join('\n');
    expect(analyseSpec(s).ok).toBe(true);
    expect(listed(run(s, medication), false)).toEqual([]);
  });

  it('accepts ‘Ward’ and ‘Ward′’ instead of ΔWard', () => {
    const s = structuredClone(medication.ref);
    const op = s.operations.find((o) => o.name === 'Prescribe')!;
    op.decls = op.decls.replace('ΔWard', 'Ward\nWard′');
    expect(listed(run(s, medication), false)).toEqual([]);
  });

  it('reports a missing operation as not achieved', () => {
    const s = structuredClone(medication.ref);
    s.operations = s.operations.filter((o) => o.name !== 'Prescribe');
    const r = run(s, medication);
    expect(r['op-prescribe'].every((g) => !g.achieved)).toBe(true);
    expect(r.state.every((g) => g.achieved)).toBe(true);
  });
});

describe('other encodings: a relation X ↔ Y as a function to sets X → ℙ Y', () => {
  const medication = byId('medication');
  const setOp = (s: SpecDoc, name: string, decls: string, preds: string) => {
    const op = s.operations.find((o) => o.name === name)!;
    op.decls = decls;
    op.preds = preds;
  };
  /** The Medication spec with allergic / prescribed as functions to sets. */
  function asFunctions(total: boolean): SpecDoc {
    const s = structuredClone(medication.ref);
    const arrow = total ? '→' : '⇸';
    const P = total ? 'PATIENT' : 'patients';
    s.state.decls = `patients : ℙ PATIENT\nallergic : PATIENT ${arrow} ℙ DRUG\nprescribed : PATIENT ${arrow} ℙ DRUG`;
    s.state.preds = total
      ? '∀ p ∈ PATIENT . p ∉ patients ⇒ allergic(p) = ∅ ∧ prescribed(p) = ∅\n∀ p ∈ PATIENT . prescribed(p) ∩ allergic(p) = ∅'
      : 'dom allergic = patients\ndom prescribed = patients\n∀ p ∈ patients . prescribed(p) ∩ allergic(p) = ∅';
    setOp(s, 'ViewPrescriptions', 'ΞWard\np? : PATIENT\ndrugs! : ℙ DRUG', 'p? ∈ patients\ndrugs! = prescribed(p?)');
    setOp(
      s,
      'Prescribe',
      'ΔWard\np? : PATIENT\ndrug? : DRUG',
      'p? ∈ patients\ndrug? ∉ allergic(p?)\nprescribed′ = (prescribed ∖ {p? ↦ prescribed(p?)}) ∪ {p? ↦ prescribed(p?) ∪ {drug?}}',
    );
    void P;
    return s;
  }

  it.each([
    ['partial', false],
    ['total', true],
  ] as [string, boolean][])('achieves the same goals as the reference (%s functions)', (_, total) => {
    const s = asFunctions(total);
    expect(analyseSpec(s).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    // (deterministic: the searches count work, not milliseconds, so load does not matter)
    const r = checkGoals(s, analyseSpec(s), medication.ref, medication.goals);
    expect(listed(r, false)).toEqual([]);
    expect(r.state.find((g) => g.text === 'Nobody gets a drug they are allergic to')?.achieved).toBe(true);
  });

  it('still notices a missing safety condition', () => {
    const s = asFunctions(false);
    setOp(
      s,
      'Prescribe',
      'ΔWard\np? : PATIENT\ndrug? : DRUG',
      'p? ∈ patients\nprescribed′ = (prescribed ∖ {p? ↦ prescribed(p?)}) ∪ {p? ↦ prescribed(p?) ∪ {drug?}}',
    );
    s.state.preds = 'dom allergic = patients\ndom prescribed = patients'; // and no invariant either
    const r = run(s, medication);
    expect(listed(r, false)).toEqual([
      'state: Nobody gets a drug they are allergic to',
      'op-prescribe: Never a drug the patient is allergic to',
    ]);
  });

  it("the lecturer's spec: partial functions to sets", () => {
    const s = structuredClone(medication.ref);
    s.given = '[PATIENT, DRUG]';
    s.state.decls = 'patients: ℙ PATIENT\nallergic: PATIENT ⇸ ℙ DRUG\nprescribed: PATIENT ⇸ ℙ DRUG';
    s.state.preds = 'dom allergic ⊆ patients\ndom prescribed ⊆ patients\n∀ p ∈ patients. prescribed(p) ∩ allergic(p) = ∅';
    setOp(s, 'ViewPrescriptions', 'ΞWard\npatient?: PATIENT\ndrugs!: ℙ DRUG', 'patient? ∈ patients\ndrugs! = prescribed(patient?)');
    s.operations = s.operations.filter((o) => o.name === 'ViewPrescriptions');
    const an = analyseSpec(s);
    expect(an.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const r = checkGoals(s, an, medication.ref, medication.goals);
    expect(r.state.map((g) => [g.text, g.achieved])).toEqual([...medication.goals.state!.map((g) => [g.text, true]), ['Allows every state the requirements allow', true]]);
    expect(r['op-view-prescriptions'].map((g) => [g.text, g.achieved])).toEqual([
      ['Take a patient as input and output drugs', true],
      ['Only for patients on the ward', true],
      ["Output exactly the patient's prescribed drugs", true],
      ["Don't change anything", true],
      ['Runs whenever it should', true],
    ]);
  });

  it('prefers identical types, so the reference still matches itself', () => {
    expect(listed(run(medication.ref, medication), false)).toEqual([]);
  });

  it('works the other way round: a reference with functions to sets, a student with relations', () => {
    const reference = asFunctions(true);
    const goals: TemplateGoals = {
      state: [
        { text: 'Allergies', check: { var: 'allergic' } },
        { text: 'No allergic prescriptions', check: { holds: '∀ p ∈ patients . prescribed(p) ∩ allergic(p) = ∅' } },
      ],
      ops: {
        Prescribe: [
          { text: 'Add the drug', check: { holds: 'prescribed′(p?) = prescribed(p?) ∪ {drug?}' } },
          { text: 'Safety', check: { holds: 'drug? ∉ allergic(p?)' } },
          { text: 'Allergies unchanged', check: { holds: 'allergic′ = allergic' } },
        ],
      },
    };
    const r = checkGoals(medication.ref, analyseSpec(medication.ref), reference, goals);
    expect(listed(r, false)).toEqual([]);
    expect(listed(r, true).length).toBe(7); // with "Allows every state …" and "Runs whenever it should"
  });
});

describe('unmatched reference variables', () => {
  const medication = byId('medication');
  const bank = byId('bank-account');
  const setOp = (s: SpecDoc, name: string, preds: string) => (s.operations.find((o) => o.name === name)!.preds = preds);
  /** Medication without allergies yet (optionally with them as DRUG ↔ PATIENT). */
  function noAllergies(inverse = false): SpecDoc {
    const s = structuredClone(medication.ref);
    s.state.decls = 'patients : ℙ PATIENT\nprescribed : PATIENT ↔ DRUG' + (inverse ? '\nallergic : DRUG ↔ PATIENT' : '');
    s.state.preds = 'dom prescribed ⊆ patients' + (inverse ? '\nran allergic ⊆ patients' : '');
    setOp(s, 'Prescribe', 'p? ∈ patients\nprescribed′ = prescribed ∪ {p? ↦ drug?}' + (inverse ? '\n(drug? ↦ p?) ∉ allergic' : ''));
    return s;
  }

  it('leaves a reference variable unmatched rather than taking another variable of its type', () => {
    const s = noAllergies();
    expect(analyseSpec(s).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const r = run(s, medication);
    expect(listed(r, true)).toEqual([
      'types: A type for patients',
      'types: A type for drugs',
      'state: Which patients are on the ward',
      'state: Which drugs each patient is prescribed',
      'init: The ward starts empty',
      'op-view-prescriptions: Take a patient as input and output drugs',
      'op-view-prescriptions: Only for patients on the ward',
      "op-view-prescriptions: Output exactly the patient's prescribed drugs",
      // "unchanged" goals leave out the variables the student does not have (yet)
      "op-view-prescriptions: Don't change anything",
      'op-prescribe: Take a patient and a drug as inputs',
      'op-prescribe: Only for patients on the ward',
      "op-prescribe: Add the drug to the patient's prescriptions",
      'op-prescribe: Leave patients and allergies unchanged',
    ]);
  });

  it('matches the allergies once they are there (as the inverse relation)', () => {
    const r = run(noAllergies(true), medication);
    const ok = listed(r, true);
    for (const g of [
      'state: Which drugs each patient is allergic to',
      'state: Which drugs each patient is prescribed',
      "op-view-prescriptions: Output exactly the patient's prescribed drugs",
      'op-prescribe: Never a drug the patient is allergic to',
      "op-prescribe: Add the drug to the patient's prescriptions",
    ])
      expect(ok).toContain(g);
  });

  it('breaks ties by name', () => {
    const s = structuredClone(medication.ref);
    s.state.decls = 'patients : ℙ PATIENT\nprescribed : PATIENT ↔ DRUG';
    s.state.preds = '';
    s.init = null;
    s.operations = [];
    const r = run(s, medication);
    expect(r.state.map((g) => [g.text, g.achieved]).slice(0, 3)).toEqual([
      ['Which patients are on the ward', true],
      ['Which drugs each patient is allergic to', false],
      ['Which drugs each patient is prescribed', true],
    ]);
  });

  it('bank: a limit is not taken for the balance', () => {
    const s = structuredClone(bank.ref);
    s.state.decls = 'owner : ACCOUNT ⇸ PERSON\noverdraft : ACCOUNT ⇸ ℕ';
    s.state.preds = 'dom overdraft = dom owner';
    s.operations = s.operations.filter((o) => o.name === 'Withdraw');
    setOp(s, 'Withdraw', 'a? ∈ dom owner\nowner(a?) = p?');
    expect(analyseSpec(s).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const r = run(s, bank);
    expect(r['op-withdraw'].find((g) => g.text === 'Leave owners and limits unchanged')?.achieved).toBe(true);
    expect(r['op-withdraw'].find((g) => g.text === 'Only the owner may withdraw')?.achieved).toBe(true);
  });
});

describe('matching by use, not by name', () => {
  const medication = byId('medication');
  const bank = byId('bank-account');
  const blood = byId('blood-transfusion');
  const setOp = (s: SpecDoc, name: string, preds: string) => (s.operations.find((o) => o.name === name)!.preds = preds);
  /** Rename given sets everywhere (declarations, predicates, pools). */
  function renameGivens(spec: SpecDoc, names: Record<string, string>): SpecDoc {
    const s = structuredClone(spec);
    const re = new RegExp(`\\b(${Object.keys(names).join('|')})\\b`, 'g');
    const fix = (t: string) => t.replace(re, (m) => names[m]);
    s.given = fix(s.given);
    s.pools = Object.fromEntries(Object.entries(s.pools).map(([k, v]) => [names[k] ?? k, v]));
    if (s.infinite) s.infinite = s.infinite.map((n) => names[n] ?? n);
    for (const d of [s.state, s.init, ...s.operations]) {
      if (!d) continue;
      d.decls = fix(d.decls);
      d.preds = fix(d.preds);
    }
    return s;
  }

  it.each(TEMPLATES.map((t) => [t.id, t] as [string, T]))('given sets with other names, variables too: %s', (_, t) => {
    const an = analyseSpec(t.ref);
    const names = Object.fromEntries(an.givenSets.map((g, i) => [g, `Q${i}SET`]));
    const s = renameVariables(renameGivens(t.ref, names));
    expect(analyseSpec(s).ok).toBe(true);
    expect(listed(run(s, t), false)).toEqual([]);
  });

  it('tells the examples which template sets and variables the student\'s stand for', () => {
    const railway = byId('railway-interlocking');
    const s = renameGivens(railway.ref, { TRAIN: 'Trains', BLOCK: 'Blocks', SIGNAL: 'Signals' });
    s.state.decls = s.state.decls.replace('protects', 'layout');
    for (const d of [s.state, ...s.operations]) d.preds = d.preds.replace(/protects/g, 'layout');
    s.pools = {};
    expect(analyseSpec(s).ok).toBe(true);
    const b = exampleBinding(s, analyseSpec(s), railway.ref, railway.goals);
    expect(b.givens).toEqual({ Trains: 'TRAIN', Blocks: 'BLOCK', Signals: 'SIGNAL' });
    expect(b.vars.layout).toEqual({ ref: 'protects' });
    // a table kept under its name but read the other way round
    const t = structuredClone(blood.ref);
    const flip = (x: string) => x.replace(/\(unitType\((\w\??)\) ↦ patientType\(([^()]*(?:\([^()]*\))?)\)\) ∈ compatible/g, '(patientType($2) ↦ unitType($1)) ∈ compatible');
    t.state.preds = flip(t.state.preds);
    for (const o of t.operations) o.preds = flip(o.preds);
    expect(exampleBinding(t, analyseSpec(t), blood.ref, blood.goals).vars.compatible).toEqual({ ref: 'compatible', inverse: true });
    expect(listed(run(t, blood), false)).toEqual([]);
  });

  it('MEDICINE for DRUG', () => {
    const s = renameGivens(medication.ref, { DRUG: 'MEDICINE' });
    expect(listed(run(s, medication), false)).toEqual([]);
  });

  it('a table read the other way round (X ↔ X as its inverse)', () => {
    const s = structuredClone(blood.ref);
    const flip = (t: string) => t.replace(/\(unitType\((\w\??)\) ↦ patientType\(([^()]*(?:\([^()]*\))?)\)\) ∈ compatible/g, '(patientType($2) ↦ unitType($1)) ∈ accepts');
    s.state.decls = s.state.decls.replace('compatible : BLOODTYPE ↔ BLOODTYPE', 'accepts : BLOODTYPE ↔ BLOODTYPE');
    s.state.preds = flip(s.state.preds);
    for (const o of s.operations) {
      o.preds = flip(o.preds).replace('compatible′ = compatible', 'accepts′ = accepts');
    }
    s.fixed = {};
    expect(s.state.preds).toContain('(patientType(issued(u)) ↦ unitType(u)) ∈ accepts');
    expect(analyseSpec(s).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(listed(run(s, blood), false)).toEqual([]);
  });

  it('many relations of the same type (more than fit in one try)', () => {
    const s = structuredClone(medication.ref);
    s.state.decls = [1, 2, 3, 4, 5, 6].map((i) => `extra${i} : PATIENT ↔ DRUG`).join('\n') + '\n' + s.state.decls;
    expect(listed(run(s, medication), false)).toEqual([]);
  });

  it('operations cannot swap same-typed state variables (balance and overdraft)', () => {
    const s = structuredClone(bank.ref);
    setOp(s, 'QueryBalance', 'a? ∈ dom owner\nowner(a?) = p?\nb! = overdraft(a?)');
    const r = run(s, bank);
    expect(r['op-query-balance'].find((g) => g.text === "Output the account's balance")?.achieved).toBe(false);
    // also without the invariant that tells them apart (then the names decide)
    s.state.preds = 'dom balance = dom owner\ndom overdraft = dom owner';
    expect(run(s, bank)['op-query-balance'].find((g) => g.text === "Output the account's balance")?.achieved).toBe(false);
    const w = structuredClone(bank.ref);
    setOp(w, 'Withdraw', 'a? ∈ dom owner\nowner(a?) = p?\noverdraft′ = (overdraft ∖ {a? ↦ overdraft(a?)}) ∪ {a? ↦ overdraft(a?) - amount?}\nbalance(a?) - amount? ≥ -overdraft(a?)');
    expect(run(w, bank)['op-withdraw'].find((g) => g.text === 'Take the amount off the balance')?.achieved).toBe(false);
  });

  it('a limit as the lowest balance (negated numbers)', () => {
    const s = structuredClone(bank.ref);
    s.state.decls = 'owner : ACCOUNT ⇸ PERSON\nbalance : ACCOUNT ⇸ ℤ\nlimit : ACCOUNT ⇸ ℤ';
    s.state.preds = 'dom balance = dom owner\ndom limit = dom owner\n∀ a ∈ dom limit . limit(a) ≤ 0\n∀ a ∈ dom balance . balance(a) ≥ limit(a)';
    s.init!.preds = 'owner = ∅\nbalance = ∅\nlimit = ∅';
    setOp(s, 'Withdraw', 'a? ∈ dom owner\nowner(a?) = p?\nbalance(a?) - amount? ≥ limit(a?)\nbalance′ = (balance ∖ {a? ↦ balance(a?)}) ∪ {a? ↦ balance(a?) - amount?}\nowner′ = owner\nlimit′ = limit');
    expect(analyseSpec(s).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(listed(run(s, bank), false)).toEqual([]);
  });
});

describe('not stricter than the requirements', () => {
  const medication = byId('medication');
  const bank = byId('bank-account');
  const atc = byId('air-traffic-control');
  const setOp = (s: SpecDoc, name: string, decls: string | null, preds: string) => {
    const op = s.operations.find((o) => o.name === name)!;
    if (decls !== null) op.decls = decls;
    op.preds = preds;
  };
  const goal = (r: Record<string, GoalStatus[]>, step: string, text: string) => r[step].find((g) => g.text === text)!;
  const ALLOWS = 'Allows every state the requirements allow';
  const RUNS = 'Runs whenever it should';

  it('a variable must admit the values the requirements allow (several allergies per patient)', () => {
    const s = structuredClone(medication.ref);
    s.state.decls = s.state.decls.replace('allergic : PATIENT ↔ DRUG', 'allergic : PATIENT ⇸ DRUG');
    const which = goal(run(s, medication), 'state', 'Which drugs each patient is allergic to');
    expect(which).toMatchObject({ achieved: false, evidence: { kind: 'counterexample' } });
    const shown = which.evidence?.kind === 'counterexample' ? which.evidence.vars[0] : undefined;
    expect(shown?.name).toBe('allergic');
    const patients = shown?.value.k === 'set' ? shown.value.elems.map((p) => (p.k === 'tuple' ? JSON.stringify(p.elems[0]) : '')) : [];
    expect(new Set(patients).size).toBeLessThan(patients.length);
  });

  it('a state invariant that rules out valid states', () => {
    for (const inv of ['∀ a ∈ dom balance . balance(a) ≥ overdraft(a)', '∀ a ∈ dom balance . balance(a) ≥ 0']) {
      const s = structuredClone(bank.ref);
      s.state.preds = s.state.preds.replace('∀ a ∈ dom balance . balance(a) ≥ -overdraft(a)', inv);
      expect(goal(run(s, bank), 'state', ALLOWS), inv).toMatchObject({ achieved: false, evidence: { kind: 'counterexample' } });
    }
    const a = structuredClone(atc.ref);
    a.state.preds += '\ncleared = ∅';
    const r = run(a, atc);
    expect(goal(r, 'state', ALLOWS)).toMatchObject({ achieved: false, evidence: { kind: 'counterexample' } });
    expect(goal(run(atc.ref, atc), 'state', ALLOWS).achieved).toBe(true);
  });

  it('an operation that refuses cases the requirements allow', () => {
    const s = structuredClone(bank.ref);
    const w = s.operations.find((o) => o.name === 'Withdraw')!;
    w.preds += '\namount? ≤ balance(a?)';
    expect(goal(run(s, bank), 'op-withdraw', RUNS)).toMatchObject({ achieved: false, evidence: { kind: 'counterexample' } });
    // Prescribe with Ξ: adding a drug then only works if it is there already
    const m = structuredClone(medication.ref);
    setOp(m, 'Prescribe', 'ΞWard\np? : PATIENT\ndrug? : DRUG', 'p? ∈ patients\n(p? ↦ drug?) ∉ allergic\nprescribed′ = prescribed ∪ {p? ↦ drug?}');
    expect(goal(run(m, medication), 'op-prescribe', RUNS)).toMatchObject({ achieved: false, evidence: { kind: 'counterexample' } });
    // the reference's outcome meets every line of the reference: proven
    expect(goal(run(medication.ref, medication), 'op-prescribe', RUNS)).toMatchObject({ achieved: true, evidence: { kind: 'proof' } });
  });
});

describe('the inverse relation as an encoding (Y ⇸ X for X ⇸ Y)', () => {
  const atc = byId('air-traffic-control');
  /** The tower with clearances per runway instead of per aircraft. */
  const perRunway = (extra = ''): SpecDoc => {
    const s = structuredClone(atc.ref);
    s.state.decls = 'approaching : ℙ AIRCRAFT\noccupied : ℙ RUNWAY\ncleared : RUNWAY ⇸ AIRCRAFT';
    s.state.preds = 'ran cleared ⊆ approaching\ndom cleared ∩ occupied = ∅' + extra;
    s.operations = [];
    return s;
  };
  const state = (r: Record<string, GoalStatus[]>) => r.state.map((g) => [g.text, g.achieved]);

  it('matches, but the reference function needs one runway per aircraft', () => {
    const s = perRunway();
    expect(analyseSpec(s).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const r = run(s, atc);
    expect(state(r)).toEqual([
      ['Which aircraft are approaching and which runways are occupied', true],
      ['Which runway each aircraft is cleared to land on', true],
      ['Only approaching aircraft are cleared', true],
      ['At most one aircraft per runway', true],
      ['An aircraft is cleared for at most one runway', false],
      ['No clearance for an occupied runway', true],
      ['Allows every state the requirements allow', true],
    ]);
    // the counterexample: an aircraft cleared for two runways
    const which = r.state.find((g) => g.text === 'An aircraft is cleared for at most one runway')!;
    expect(which.evidence?.kind).toBe('counterexample');
    const shown = which.evidence?.kind === 'counterexample' ? which.evidence.vars.find((v) => v.name === 'cleared') : undefined;
    expect(shown).toBeTruthy();
    const pairs = shown!.value.k === 'set' ? shown!.value.elems : [];
    const aircraft = pairs.map((p) => (p.k === 'tuple' ? JSON.stringify(p.elems[1]) : ''));
    expect(new Set(aircraft).size).toBeLessThan(aircraft.length);
  });

  it('achieves every state goal once each aircraft has at most one runway', () => {
    const r = run(perRunway('\n∀ r₁, r₂ ∈ dom cleared . cleared(r₁) = cleared(r₂) ⇒ r₁ = r₂'), atc);
    expect(state(r).filter(([, ok]) => !ok)).toEqual([]);
    expect(r.state.find((g) => g.text === 'Which runway each aircraft is cleared to land on')).toMatchObject({ achieved: true, via: 'stated' });
  });

  it('a relation of the same type must be a function as well', () => {
    const bank = byId('bank-account');
    const s = structuredClone(bank.ref);
    s.state.decls = s.state.decls.replace('owner : ACCOUNT ⇸ PERSON', 'owner : ACCOUNT ↔ PERSON');
    s.operations = [];
    const owner = (r: Record<string, GoalStatus[]>) => r.state.filter((g) => /own/.test(g.text)).map((g) => [g.text, g.achieved, g.evidence?.kind]);
    expect(owner(run(s, bank))).toEqual([
      // the missing functionality shows on the goal that states it
      ['Who owns each account', true, undefined],
      ['Each account has only one owner', false, 'counterexample'],
    ]);
    s.state.preds += '\n∀ a ∈ dom owner; p₁, p₂ ∈ ran owner . (a ↦ p₁) ∈ owner ∧ (a ↦ p₂) ∈ owner ⇒ p₁ = p₂';
    expect(owner(run(s, bank))).toEqual([
      ['Who owns each account', true, undefined],
      ['Each account has only one owner', true, 'proof'],
    ]);
  });

  it('prefers the same type over the inverse', () => {
    const s = perRunway();
    s.state.decls += '\nlanding : AIRCRAFT ⇸ RUNWAY';
    s.state.preds += '\nlanding = ∅';
    const r = run(s, atc);
    // `landing` (same type) stands for cleared: its goal is met, the others follow landing = ∅
    expect(r.state.find((g) => g.text === 'Which runway each aircraft is cleared to land on')?.achieved).toBe(true);
  });
});

describe('no false greens, and stated vs inferred', () => {
  const medication = byId('medication');
  const bank = byId('bank-account');
  const status = (r: Record<string, GoalStatus[]>, step: string) => r[step].map((g) => [g.text, g.achieved, g.via ?? null]);
  /** The lecturer's Medication state (partial functions to sets). */
  const lecturer = (initPreds: string): SpecDoc => {
    const s = structuredClone(medication.ref);
    s.state.decls = 'patients: ℙ PATIENT\nallergic: PATIENT ⇸ ℙ DRUG\nprescribed: PATIENT ⇸ ℙ DRUG';
    s.state.preds = 'dom allergic ⊆ patients\ndom prescribed ⊆ patients\n∀ p ∈ patients. prescribed(p) ∩ allergic(p) = ∅';
    s.init!.decls = 'Ward';
    s.init!.preds = initPreds;
    s.operations = [];
    return s;
  };

  it('searches long enough for counterexamples (Init and operations)', () => {
    const blood = byId('blood-transfusion');
    const s = structuredClone(blood.ref);
    s.init!.preds = 'dom unitType = {U101}';
    const nothing = run(s, blood).init.find((g) => g.text === 'Nothing issued at the start')!;
    expect(nothing).toMatchObject({ achieved: false, evidence: { kind: 'counterexample' } });
    const issued = nothing.evidence?.kind === 'counterexample' ? nothing.evidence.vars.find((v) => v.name === 'issued') : undefined;
    expect(issued?.text).not.toBe('∅');
    // a counterexample only a longer search finds
    const access = byId('access-control');
    const a = structuredClone(access.ref);
    a.operations.find((o) => o.name === 'AssignRole')!.preds = 'users′ = users';
    expect(run(a, access)['op-assign-role'].find((g) => g.text === 'Never a role that conflicts with one the user holds')).toMatchObject({
      achieved: false,
      evidence: { kind: 'counterexample' },
    });
  });

  it("'examples' evidence exactly when achieved without a proof, never with a counterexample", () => {
    const specs: [T, SpecDoc][] = TEMPLATES.flatMap((t) => [
      [t, t.ref],
      [t, renameVariables(t.ref)],
      ...t.ref.operations.map((o): [T, SpecDoc] => {
        const s = structuredClone(t.ref);
        s.operations.find((x) => x.id === o.id)!.preds = o.preds.split('\n').slice(1).join('\n');
        return [t, s];
      }),
    ]);
    for (const [t, s] of specs) {
      const r = run(s, t);
      for (const [step, gs] of Object.entries(r)) {
        const goals = step === 'types' || step === 'state' || step === 'init' ? t.goals[step]! : t.goals.ops![t.ref.operations.find((o) => o.id === step)!.name];
        gs.forEach((g, i) => {
          const holds = i >= goals.length || goals[i].check.holds !== undefined; // (automatic goals at the end)
          const kind = g.evidence?.kind;
          if (g.achieved) expect(holds ? (i < goals.length ? ['proof', 'examples'] : [undefined, 'proof', 'examples']) : [undefined, 'examples'], `${t.id} ${step}: ${g.text}`).toContain(kind);
          else expect([undefined, 'counterexample'], `${t.id} ${step}: ${g.text}`).toContain(kind);
        });
      }
    }
  });

  it('an empty Init achieves no Init goal (even though empty states are sampled first)', () => {
    const s = structuredClone(medication.ref);
    s.init!.decls = 'Ward';
    s.init!.preds = '';
    expect(status(run(s, medication), 'init')).toEqual([
      ['The ward starts empty', false, null],
      ['No allergies or prescriptions at the start', false, null],
    ]);
    expect(status(run(lecturer(''), medication), 'init').map((g) => g[1])).toEqual([false, false]);
  });

  it('Init with only patients = ∅: one goal stated, the other inferred from the invariant', () => {
    expect(status(run(lecturer('patients = ∅'), medication), 'init')).toEqual([
      ['The ward starts empty', true, 'stated'],
      ['No allergies or prescriptions at the start', true, 'inferred'],
    ]);
  });

  it('frame goals met by the frame convention are inferred, written ones stated', () => {
    const noFrame = withoutLine(withoutLine(bank.ref, 'Withdraw', 'owner′ = owner'), 'Withdraw', 'overdraft′ = overdraft');
    const leave = (r: Record<string, GoalStatus[]>) => r['op-withdraw'].find((g) => g.text === 'Leave owners and limits unchanged');
    expect(leave(run(noFrame, bank))).toMatchObject({ achieved: true, via: 'inferred', evidence: { kind: 'proof' } });
    expect(leave(run(bank.ref, bank))).toMatchObject({ achieved: true, via: 'stated', evidence: { kind: 'proof' } });
  });

  it('a safety goal is stated with the precondition, inferred from the invariant without it', () => {
    const never = (r: Record<string, GoalStatus[]>) => r['op-prescribe'].find((g) => g.text === 'Never a drug the patient is allergic to');
    expect(never(run(medication.ref, medication))?.via).toBe('stated');
    const without = withoutLine(medication.ref, 'Prescribe', '(p? ↦ drug?) ∉ allergic');
    expect(never(run(without, medication))).toMatchObject({ achieved: true, via: 'inferred', evidence: { kind: 'proof' } });
  });

  it('state, var and given goals are stated', () => {
    const r = run(medication.ref, medication);
    expect(r.types.every((g) => g.via === 'stated')).toBe(true);
    expect(r.state.every((g) => g.via === 'stated')).toBe(true);
    expect(r['op-prescribe'].filter((g) => !medication.goals.ops!.Prescribe.find((x) => x.text === g.text)?.check.holds).every((g) => g.via === 'stated')).toBe(true);
  });

  it('proves every holds goal of every reference (no "probably" marks on a correct solution)', () => {
    for (const t of TEMPLATES) {
      const r = run(t.ref, t);
      for (const [step, gs] of Object.entries(r)) {
        const goals = step === 'types' || step === 'state' || step === 'init' ? t.goals[step]! : t.goals.ops![t.ref.operations.find((o) => o.id === step)!.name];
        gs.forEach((g, i) => {
          if (i < goals.length && goals[i].check.holds !== undefined) expect(g.evidence?.kind, `${t.id} ${step}: ${g.text}`).toBe('proof');
        });
      }
    }
  });

  it('proves the functionality goals of the references (one value per argument, one argument per value)', () => {
    const proof = (id: string, step: string, text: string) => run(byId(id).ref, byId(id))[step].find((g) => g.text === text)?.evidence?.kind;
    expect(proof('bank-account', 'state', 'Each account has only one owner')).toBe('proof');
    expect(proof('air-traffic-control', 'state', 'An aircraft is cleared for at most one runway')).toBe('proof');
    expect(proof('air-traffic-control', 'state', 'At most one aircraft per runway')).toBe('proof');
    expect(proof('railway-interlocking', 'state', 'Never two trains in the same block')).toBe('proof');
    expect(proof('blood-transfusion', 'state', 'Patients only get compatible blood')).toBe('proof');
  });
});
