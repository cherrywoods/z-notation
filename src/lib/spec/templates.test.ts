// Every template must analyse without errors — both as shown to students (hidden
// lines removed) and as the full intended spec (hidden lines included).
import { describe, expect, it } from 'vitest';
import { analyseSpec } from '../z/index';
import { TOPICS, createSpec } from './topics';
import type { SpecDoc } from './model';

const raw = import.meta.glob('/templates/*.json', { eager: true, import: 'default' }) as Record<string, any>;

function fullSpec(id: string): SpecDoc {
  const t = Object.entries(raw).find(([p]) => p.endsWith(`/${id}.json`))![1];
  const spec = createSpec(id);
  const all = (lines: { text: string }[] = []) => lines.map((l) => l.text).join('\n');
  spec.state.decls = all(t.state.declarations);
  spec.state.preds = all(t.state.predicates);
  if (spec.init && t.init) {
    spec.init.decls = all(t.init.declarations);
    spec.init.preds = all(t.init.predicates);
  }
  t.operations.forEach((op: any, i: number) => {
    spec.operations[i].decls = all(op.declarations);
    spec.operations[i].preds = all(op.predicates);
  });
  return spec;
}

const errorsOf = (spec: SpecDoc) =>
  analyseSpec(spec)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => `${d.section.schemaId}:${d.section.part} ${d.message}`);

describe('templates', () => {
  it('there are six', () => expect(TOPICS.length).toBe(6));
  for (const t of TOPICS) {
    it(`${t.id}: student view has no errors`, () => expect(errorsOf(createSpec(t.id))).toEqual([]));
    it(`${t.id}: full spec has no errors`, () => expect(errorsOf(fullSpec(t.id))).toEqual([]));
  }
});
