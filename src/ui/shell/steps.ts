// The tutorial steps of a spec: System → Types → State → one per operation → Init (if any) → Spec.

import type { OpKind, SpecDoc } from '../../lib/spec/model';

export interface StepInfo {
  /** Route segment: 'about' | 'types' | 'state' | operation id ('op-…') | 'init' | 'spec'. */
  id: string;
  label: string;
  /** Operations only: Ξ (query) or Δ (update) badge. */
  opKind?: OpKind;
}

export function stepsOf(spec: SpecDoc): StepInfo[] {
  return [
    { id: 'about', label: 'System' },
    { id: 'types', label: 'Types' },
    { id: 'state', label: 'State' },
    ...spec.operations.map((o) => ({ id: o.id, label: o.name || 'Operation', opKind: o.opKind })),
    ...(spec.init ? [{ id: 'init', label: spec.init.name || 'Init' }] : []),
    { id: 'spec', label: 'Spec' },
  ];
}

export const opBadge = (k: OpKind | undefined) => (k === 'query' ? 'Ξ' : k === 'update' ? 'Δ' : '');
