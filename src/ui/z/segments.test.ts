import { describe, expect, it } from 'vitest';
import { zPieces } from './segments';

const explained = (text: string, given: string[] = [], ctx = {}) =>
  zPieces(text, given, ctx)
    .filter((p) => p.explain)
    .map((p) => [p.text, p.explain]);

describe('zPieces', () => {
  it('covers the whole text', () => {
    const text = 'onLoan : ℙ BOOK\nborrower : BOOK ⇸ MEMBER';
    expect(zPieces(text, ['BOOK', 'MEMBER']).map((p) => p.text).join('')).toBe(text);
  });

  it('groups ΔState and decorated names into one hover target', () => {
    const ps = zPieces('ΞLibrary\nbook? : BOOK', ['BOOK'], { stateName: 'Library', stateVars: ['onLoan'] });
    const xi = ps.find((p) => p.explain === 'xi')!;
    expect(xi.text).toBe('ΞLibrary');
    expect(xi.ctx).toMatchObject({ stateName: 'Library', stateVars: ['onLoan'] });
    const input = ps.find((p) => p.explain === 'input')!;
    expect(input.text).toBe('book?');
    expect(input.ctx?.subject).toBe('book?');
  });

  it('does not reuse state variables of a different state', () => {
    const ps = zPieces('ΔWard', [], { stateName: 'Library', stateVars: ['onLoan'] });
    expect(ps[0].ctx).toMatchObject({ stateName: 'Ward', stateVars: undefined });
  });

  it('tells set displays from comprehensions and finds application', () => {
    expect(explained('{ b ∈ onLoan | borrower(b) = member? }')).toEqual([
      ['{', 'setcomp'],
      ['∈', 'in'],
      ['|', 'setcomp'],
      ['(', 'apply'],
      [')', 'apply'],
      ['=', 'eq'],
      ['member?', 'input'],
      ['}', 'setcomp'],
    ]);
    expect(zPieces('{Dune, Emma}').find((p) => p.text === '{')?.explain).toBe('setdisplay');
    expect(zPieces('(x ↦ y) ∈ R').find((p) => p.text === '(')?.explain).toBeUndefined();
  });

  it('renders value literals, == and … without errors', () => {
    const ps = zPieces('ℕ == {0, 1, …}\ndue(Dune) = 2.Feb');
    expect(ps.some((p) => p.cls === 'z-error')).toBe(false);
    expect(ps.find((p) => p.text === '2.Feb')?.cls).toBe('z-value');
    expect(ps.find((p) => p.text === '==')?.explain).toBe('defeq');
  });
});
