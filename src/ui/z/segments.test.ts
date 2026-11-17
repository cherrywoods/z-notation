import { describe, expect, it } from 'vitest';
import { zPieces } from './segments';

const explained = (text: string, given: string[] = [], ctx = {}) =>
  zPieces(text, given, ctx)
    .filter((p) => p.explain)
    .map((p) => [p.text, p.explain]);

describe('zPieces', () => {
  it('covers the whole text', () => {
    const text = 'patients : ℙ PATIENT\nallergic : PATIENT ↔ DRUG';
    expect(zPieces(text, ['PATIENT', 'DRUG']).map((p) => p.text).join('')).toBe(text);
  });

  it('groups ΔState and decorated names into one hover target', () => {
    const ps = zPieces('ΞWard\np? : PATIENT', ['PATIENT'], { stateName: 'Ward', stateVars: ['patients'] });
    const xi = ps.find((p) => p.explain === 'xi')!;
    expect(xi.text).toBe('ΞWard');
    expect(xi.ctx).toMatchObject({ stateName: 'Ward', stateVars: ['patients'] });
    const input = ps.find((p) => p.explain === 'input')!;
    expect(input.text).toBe('p?');
    expect(input.ctx?.subject).toBe('p?');
  });

  it('does not reuse state variables of a different state', () => {
    const ps = zPieces('ΔBank', [], { stateName: 'Ward', stateVars: ['patients'] });
    expect(ps[0].ctx).toMatchObject({ stateName: 'Bank', stateVars: undefined });
  });

  it('tells set displays from comprehensions and finds application', () => {
    expect(explained('{ a ∈ dom owner | owner(a) = p? }')).toEqual([
      ['{', 'setcomp'],
      ['∈', 'in'],
      ['dom', 'dom'],
      ['|', 'setcomp'],
      ['(', 'apply'],
      [')', 'apply'],
      ['=', 'eq'],
      ['p?', 'input'],
      ['}', 'setcomp'],
    ]);
    expect(zPieces('{Ana, Ben}').find((p) => p.text === '{')?.explain).toBe('setdisplay');
    expect(zPieces('(x ↦ y) ∈ R').find((p) => p.text === '(')?.explain).toBeUndefined();
    const comp = zPieces('{ x ∈ X; y ∈ Y . (x, y) }');
    expect(comp.find((p) => p.text === '{')?.explain).toBe('setcomp');
    expect(comp.find((p) => p.text === '.')?.explain).toBe('spot');
  });

  it('renders value literals, == and … without errors', () => {
    const ps = zPieces('ℕ == {0, 1, …}\nx = 2.Feb');
    expect(ps.some((p) => p.cls === 'z-error')).toBe(false);
    expect(ps.find((p) => p.text === '2.Feb')?.cls).toBe('z-value');
    expect(ps.find((p) => p.text === '==')?.explain).toBe('defeq');
  });

  it('marks a character outside the BMP as one error', () => {
    const text = 'x = 𝒜 ∪ 😀';
    const ps = zPieces(text);
    expect(ps.map((p) => p.text).join('')).toBe(text);
    expect(ps.filter((p) => p.cls === 'z-error').map((p) => p.text)).toEqual(['𝒜', '😀']);
  });
});
