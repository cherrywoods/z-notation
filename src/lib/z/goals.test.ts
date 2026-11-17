import { describe, expect, it } from 'vitest';
import type { SpecDoc } from '../spec/model';
import { TOPICS, createSpec, goalsOf, referenceSpecOf } from '../spec/topics';
import { checkGoals, clearGoalCache, type GoalStatus, type TemplateGoals } from './goals';
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
      expect(cold, t.id).toBeLessThan(600); // ~30–110 ms on a laptop
      expect(warm, t.id).toBeLessThan(60);
    }
  });
});

describe('goals react to the right changes', () => {
  const bank = byId('bank-account');
  const access = byId('access-control');
  const medication = byId('medication');

  it('dropping a frame condition flips exactly its goal', () => {
    expect(flipped(run(bank.ref, bank), run(withoutLine(bank.ref, 'Withdraw', 'owner′ = owner'), bank))).toEqual([
      'op-withdraw: Leave owners and limits unchanged',
    ]);
    expect(flipped(run(access.ref, access), run(withoutLine(access.ref, 'AssignRole', 'grants′ = grants'), access))).toEqual([
      'op-assign-role: Leave users, permissions and conflicts unchanged',
    ]);
  });

  it('dropping a safety precondition flips exactly its goal', () => {
    expect(flipped(run(bank.ref, bank), run(withoutLine(bank.ref, 'Withdraw', 'owner(a?) = c?'), bank))).toEqual([
      'op-withdraw: Only the owner may withdraw',
    ]);
    expect(flipped(run(bank.ref, bank), run(withoutLine(bank.ref, 'QueryBalance', 'owner(a?) = c?'), bank))).toEqual([
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
    expect(r.state.filter((g) => !g.achieved).map((g) => g.text)).toEqual(holds('state'));
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
