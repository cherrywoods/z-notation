// Applications f(x) of a partial function (⇸) or a relation (↔) are only defined when
// x ∈ dom f; outside, the line is simply false, so examples silently fail. Warn when
// nothing shows x ∈ dom f: guards (`x ∈ dom f ⇒ …`), the set a quantifier ranges over
// (`∀ x ∈ dom f`), sibling conjuncts, the other lines of the schema, the state invariant
// and the frame / Ξ equalities — checked with the inference engine's prover.
//
// When unsure, stay silent: only names declared as ⇸ / ↔ are checked, and in operations
// only applications of the before-state (f′(x) = e usually defines f′ at x).

import type { ZDiagnostic } from '../spec/model';
import type { Term } from './ast';
import type { SchemaInfo } from './index';
import { Prover, type Atom } from './infer/prove';
import { children, freeVars, printTerm } from './print';
import { conjuncts, containsKey, key, mk } from './infer/terms';

type Apply = Extract<Term, { kind: 'apply' }>;

/** An application with what may be assumed where it stands. */
interface Site {
  app: Apply;
  assume: Term[];
  /** Reached through ∧ and expressions only (no binder, ⇒, ∨, ¬, ⇔). */
  top: boolean;
}

/** One warning per predicate line, at the first application not known to be defined. */
export function domainWarnings(s: SchemaInfo, givenSets: readonly string[], report: (d: ZDiagnostic) => void): void {
  if (!s.ok) return;
  const decls = new Map(s.vars.map((v) => [v.name, v.declared]));
  const declaredAs = (n: string, ops: string[]) => {
    const d = decls.get(n);
    return !!d && d.kind === 'binop' && ops.includes(d.op);
  };
  const after = new Set(s.role === 'operation' ? s.vars.filter((v) => v.role === 'state′' || v.role === 'output' || v.role === 'local').map((v) => v.name) : []);
  const context = s.preds.filter((p) => p.ok).flatMap((p) => conjuncts(p.term));
  const given = new Set(givenSets);
  const laws = { isFunction: (n: string) => declaredAs(n, ['⇸', '→']) };
  const warned = new Set<string>(); // the same unguarded f(x) in several lines: warn once
  for (const p of s.preds) {
    if (p.origin !== 'own' || !p.ok || !p.section) continue;
    const sites: Site[] = [];
    collect(p.term, [], true, sites);
    for (const { app, assume, top } of sites) {
      if (app.fn.kind !== 'name' || !declaredAs(app.fn.name, ['⇸', '↔']) || after.has(app.fn.name)) continue;
      const ak = key(app);
      if (warned.has(ak)) continue;
      const atoms: Atom[] = [...context, ...assume].filter((c) => !containsKey(c, ak)).map((term) => ({ term, reason: '', src: 'own' }));
      // a defined application inside x has its value in the range: g(a) ∈ ran g
      for (const inner of appsIn(app.arg)) atoms.push({ term: mk.rel('∈', inner, mk.unop('ran', inner.fn)), reason: '', src: 'own' });
      const dom = mk.unop('dom', app.fn);
      if (new Prover({ atoms, decls, givenSets: given, laws }).mem(app.arg, dom)) continue;
      const fx = printTerm(app);
      const inDom = printTerm(mk.rel('∈', app.arg, dom));
      const hidden = s.role === 'operation' && top && ![...freeVars(app)].some((n) => after.has(n));
      const message = hidden
        ? `${fx} is only defined when ${inDom}, so ${s.name} is blocked when ${printTerm(mk.rel('∉', app.arg, dom))}.`
        : `${fx} is only defined when ${inDom}.`;
      report({ section: p.section, from: app.span.from, to: app.span.to, severity: 'warning', kind: 'undefined', message });
      warned.add(ak);
      break;
    }
  }
}

/** Applications in `t`, inner ones first, with the context each one may assume. */
function collect(t: Term, assume: Term[], top: boolean, out: Site[]): void {
  switch (t.kind) {
    case 'logic': {
      const L = conjuncts(t.left);
      const R = conjuncts(t.right);
      if (t.op === '∧') {
        collect(t.left, [...assume, ...R], top, out);
        collect(t.right, [...assume, ...L], top, out);
      } else if (t.op === '⇒') {
        collect(t.left, assume, false, out);
        collect(t.right, [...assume, ...L], false, out);
      } else if (t.op === '∨') {
        collect(t.left, [...assume, ...negations(t.right)], false, out);
        collect(t.right, [...assume, ...negations(t.left)], false, out);
      } else {
        collect(t.left, assume, false, out);
        collect(t.right, assume, false, out);
      }
      return;
    }
    case 'not':
      collect(t.arg, assume, false, out);
      return;
    case 'quant':
    case 'setComp': {
      const a = [...assume];
      for (const d of t.decls) {
        collect(d.type, a, false, out);
        for (const n of d.names) a.push(mk.rel('∈', mk.name(n.name), d.type));
      }
      if (t.pred) collect(t.pred, a, false, out);
      const inner = t.pred ? [...a, ...conjuncts(t.pred)] : a;
      if (t.kind === 'quant') collect(t.body, inner, false, out);
      else if (t.expr) collect(t.expr, inner, false, out);
      return;
    }
    case 'apply':
      collect(t.arg, assume, top, out);
      if (t.fn.kind !== 'name') collect(t.fn, assume, top, out);
      out.push({ app: t, assume, top });
      return;
    default:
      for (const c of children(t)) collect(c, assume, top, out);
  }
}

/** What the negation of `t` says, as atoms (for the other side of a ∨). */
function negations(t: Term): Term[] {
  if (t.kind === 'rel' && (t.op === '∈' || t.op === '∉')) return [{ ...t, op: t.op === '∈' ? '∉' : '∈' }];
  if (t.kind === 'not') return conjuncts(t.arg);
  if (t.kind === 'logic' && t.op === '∨') return [...negations(t.left), ...negations(t.right)];
  return [];
}

/** Applications f(a) with f a name, inside `t` (not below binders). */
function appsIn(t: Term): Apply[] {
  if (t.kind === 'quant' || t.kind === 'setComp') return [];
  const here = t.kind === 'apply' && t.fn.kind === 'name' ? [t] : [];
  return [...here, ...children(t).flatMap(appsIn)];
}
