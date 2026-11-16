import { describe, expect, it } from 'vitest';
import { computeReplacement, normalizeAscii } from './autoReplace';

/** Simulate typing `keys` one by one into an empty line, applying replacements. */
function type(keys: string, start = ''): string {
  let line = start;
  for (const k of keys) {
    const r = computeReplacement(line, k);
    const s = line + k;
    line = r ? s.slice(0, r.from) + r.insert + s.slice(r.to) : s;
  }
  return line;
}

describe('auto-replace while typing', () => {
  it('replaces arrows', () => {
    expect(type('BOOK -|> MEMBER')).toBe('BOOK ⇸ MEMBER');
    expect(type('A -> B')).toBe('A → B');
    expect(type('A <-> B')).toBe('A ↔ B');
    expect(type('x |-> y')).toBe('x ↦ y');
    expect(type('A +-> B')).toBe('A ⇸ B');
  });
  it('waits for longer shortcuts', () => {
    expect(type('a <= b')).toBe('a ≤ b');
    expect(type('P <=> Q')).toBe('P ⇔ Q');
    expect(type('P => Q')).toBe('P ⇒ Q');
    expect(type('A \\ B')).toBe('A ∖ B');
    expect(type('P \\/ Q')).toBe('P ∨ Q');
    expect(type('P /\\ Q')).toBe('P ∧ Q');
    expect(type('A <: B')).toBe('A ⊆ B');
    expect(type('A <<: B')).toBe('A ⊂ B');
    expect(type('a /= b')).toBe('a ≠ b');
  });
  it('replaces words at word end only', () => {
    expect(type('x in S ')).toBe('x ∈ S ');
    expect(type('onLoan = PP')).toBe('onLoan = PP'); // not finished yet
    expect(type('onLoan : PP BOOK ')).toBe('onLoan : ℙ BOOK ');
    expect(type('n : NN ')).toBe('n : ℕ ');
    expect(type('n : NN1 ')).toBe('n : ℕ₁ ');
    expect(type('t : RR ')).toBe('t : ℝ ');
    expect(type('forall x : S @ P')).toBe('∀ x : S • P');
    expect(type('pin ')).toBe('pin ');
    expect(type('A union B')).toBe('A ∪ B');
    expect(type('x notin S')).toBe('x ∉ S');
  });
  it('handles primes, Delta and Xi', () => {
    expect(type("borrower' = borrower")).toBe('borrower′ = borrower');
    expect(type('DeltaLibrary')).toBe('ΔLibrary');
    expect(type('Xi Book')).toBe('ΞBook');
    expect(type('Deltas')).toBe('Deltas');
    expect(type('onLoan = {}')).toBe('onLoan = ∅');
  });
});

describe('normalizeAscii (paste / blur)', () => {
  it('normalises a whole text', () => {
    expect(normalizeAscii("borrower' = borrower \\/ {book? |-> member?}")).toBe('borrower′ = borrower ∨ {book? ↦ member?}');
    expect(normalizeAscii('onLoan : PP BOOK\nborrower : BOOK -|> MEMBER')).toBe('onLoan : ℙ BOOK\nborrower : BOOK ⇸ MEMBER');
    expect(normalizeAscii('x in dom f')).toBe('x ∈ dom f');
    expect(normalizeAscii('t : SENSOR -|> RR')).toBe('t : SENSOR ⇸ ℝ');
  });
});
