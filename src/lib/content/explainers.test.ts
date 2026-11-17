import { describe, expect, it } from 'vitest';
import { EXPLAINER_IDS, getExplainer } from './explainers';
import { SYMBOLS } from '../z/symbols';
import { lex } from '../z/lexer';

const CONCEPTS = ['given', 'schema', 'declarations', 'predicates', 'state', 'init', 'operation'];

describe('explainers', () => {
  it('cover every symbol and concept', () => {
    for (const id of [...SYMBOLS.map((s) => s.id), ...CONCEPTS]) {
      const ex = getExplainer(id);
      expect(ex, id).toBeDefined();
      expect(ex!.title.length, id).toBeGreaterThan(0);
      expect(ex!.short.length, id).toBeGreaterThan(0);
      expect(ex!.notes?.length ?? 0, id).toBeLessThanOrEqual(2);
    }
  });

  it('use well-formed Z in definitions and examples (no lexer errors)', () => {
    for (const id of EXPLAINER_IDS) {
      const ex = getExplainer(id)!;
      const texts = [ex.definition, ex.example, ex.definitionSchema?.decls, ex.definitionSchema?.preds, ex.exampleSchema?.decls, ex.exampleSchema?.preds];
      for (const t of texts) {
        if (!t) continue;
        // value literals (2.Feb) and '…' are handled by the renderer
        // (and a lone '.' is the quantifier period, also before the lexer knows it)
        const errors = lex(t.replace(/\d+\.[A-Za-z]+/g, 'v').replaceAll('…', ' ').replace(/ \.(?= |\n)/g, ' •'))
          .filter((k) => k.kind === 'error');
        expect(errors, `${id}: ${t}`).toEqual([]);
      }
      // backticks in plain text come in pairs
      for (const s of [ex.short, ...(ex.notes ?? [])]) expect(s.split('`').length % 2, `${id}: ${s}`).toBe(1);
    }
  });

  it('instantiate Ξ and Δ with the state schema', () => {
    const ctx = { stateName: 'Ward', stateVars: ['patients', 'allergic', 'prescribed'] };
    const xi = getExplainer('xi', ctx)!;
    expect(xi.definitionSchema).toEqual({
      name: 'ΞWard',
      decls: 'ΔWard',
      preds: 'patients′ = patients\nallergic′ = allergic\nprescribed′ = prescribed',
    });
    const delta = getExplainer('delta', { stateName: 'Bank', stateVars: ['owner', 'balance'] })!;
    expect(delta.definitionSchema).toEqual({ name: 'ΔBank', decls: 'Bank\nBank′' });
    expect(delta.short).toContain('owner′, balance′');
  });

  it('mention the hovered identifier', () => {
    expect(getExplainer('prime', { subject: 'prescribed′' })!.short).toContain('`prescribed′`');
    expect(getExplainer('input', { subject: 'p?' })!.short).toContain('`p?`');
    expect(getExplainer('output', { subject: 'drugs!' })!.short).toContain('`drugs!`');
    expect(getExplainer('given', { subject: 'PATIENT' })!.short).toContain('`PATIENT`');
    expect(getExplainer('nope')).toBeUndefined();
  });
});
