import { describe, expect, it } from 'vitest';
import { givenNames, isIdent, renameStateRefs, schemaNameError } from './helpers';
import type { SpecDoc } from './model';

const spec = (): SpecDoc => ({
  topicId: 't',
  title: 'T',
  given: '[PATIENT, DRUG]',
  pools: {},
  state: { id: 'state', role: 'state', name: 'Ward', decls: 'patients : ℙ PATIENT', preds: '' },
  init: { id: 'init', role: 'init', name: 'InitWard', decls: 'Ward′', preds: 'patients′ = ∅' },
  operations: [
    { id: 'op-a', role: 'operation', name: 'Admit', decls: 'ΔWard\np? : PATIENT', preds: '' },
    { id: 'op-b', role: 'operation', name: 'View', decls: 'ΞWard\nΞWardrobe', preds: 'Ward = Ward' },
  ],
});

describe('givenNames', () => {
  it('uses the lexer identifier rules', () => {
    expect(givenNames('[ℕ]')).toEqual([]);
    expect(givenNames('[A, ℙ, B_2] [C]')).toEqual(['A', 'B_2', 'C']);
    expect(isIdent('Δx')).toBe(false);
    expect(givenNames('[PATIENT DRUG]')).toEqual(['PATIENT', 'DRUG']);
    expect(givenNames('[PATIENT,,DRUG]')).toEqual(['PATIENT', 'DRUG']);
  });
});

describe('schemaNameError', () => {
  it('rejects empty, invalid and duplicate names', () => {
    const s = spec();
    expect(schemaNameError(s, 'state', '')).toBeTruthy();
    expect(schemaNameError(s, 'state', 'Hos pital')).toBe('No spaces.');
    expect(schemaNameError(s, 'state', 'ΔWard')).toBe('No Δ or Ξ in the name.');
    expect(schemaNameError(s, 'state', '2Ward')).toBe('Start with a letter.');
    expect(schemaNameError(s, 'state', 'Admit')).toMatch(/Admit/);
    expect(schemaNameError(s, 'state', 'DRUG')).toMatch(/type/);
    expect(schemaNameError(s, 'state', 'Hospital')).toBeNull();
    expect(schemaNameError(s, 'op-a', 'Admit')).toBeNull();
  });
});

describe('renameStateRefs', () => {
  it('updates Δ/Ξ imports, the Init import and the Init name', () => {
    const s = spec();
    renameStateRefs(s, 'Ward', 'Hospital');
    expect(s.operations[0].decls).toBe('ΔHospital\np? : PATIENT');
    expect(s.operations[1].decls).toBe('ΞHospital\nΞWardrobe');
    expect(s.operations[1].preds).toBe('Ward = Ward'); // predicates are left alone
    expect(s.init!.decls).toBe('Hospital′');
    expect(s.init!.name).toBe('InitHospital');
  });
  it('keeps a custom Init name', () => {
    const s = spec();
    s.init!.name = 'Start';
    renameStateRefs(s, 'Ward', 'Hospital');
    expect(s.init!.name).toBe('Start');
  });
});
