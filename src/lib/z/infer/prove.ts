// A small, sound prover for set membership and inclusion goals
//   x ∈ T,  x ∉ T,  A ⊆ B
// from a list of atomic premises (preconditions, invariant lines, …) and the
// declarations. It chains through equations (substitution of equals), inclusions,
// ∪ / ∩ / ∖, dom / ran of unions and set displays, and total functions (f : X → Y
// gives dom f = X). The result is the list of premises used, in reading order
// (e.g. `book? ∈ onLoan` [precondition], `onLoan = dom borrower` [invariant before]).
//
// Iterative deepening keeps derivations as short as possible; every rule is a valid
// law of set theory, so a found derivation is always correct.

import type { Term } from '../ast';
import { freeVars, printTerm } from '../print';
import { rewriteOnce, type LawEnv } from './rewrite';
import { isEmptySet, key, pairParts, replaceSub, view } from './terms';

/** Where a premise comes from (used to word messages; not part of the output). */
export type PremiseSource = 'own' | 'inv' | 'decl' | 'xi' | 'law';

export interface Premise {
  text: string;
  reason: string;
  src: PremiseSource;
}

export interface Atom {
  term: Term;
  reason: string;
  src: PremiseSource;
}

export interface ProverEnv {
  atoms: Atom[];
  /** Declared set of each variable in scope (decorated name → e.g. `BOOK ⇸ MEMBER`). */
  decls: ReadonlyMap<string, Term>;
  givenSets: ReadonlySet<string>;
  /** For the rewrite laws (e.g. which names are functions). */
  laws?: LawEnv;
}

interface Pair {
  a: Term;
  b: Term;
  ka: string;
  kb: string;
  p: Premise;
}

const MAX_DEPTH = 3;

export const premiseOf = (a: Atom): Premise => ({ text: printTerm(a.term), reason: a.reason, src: a.src });
export const declPremise = (name: string, declared: Term): Premise => ({
  text: `${name} : ${printTerm(declared)}`,
  reason: 'declaration',
  src: 'decl',
});

/** Remove repeated premises (same text and reason), keeping the first. */
export function dedupe(ps: Premise[]): Premise[] {
  const seen = new Set<string>();
  return ps.filter((p) => {
    const k = `${p.text}\u0000${p.reason}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

type Proof = Premise[] | null;

export class Prover {
  private eqs: Pair[] = [];
  private subs: Pair[] = [];
  private mems: Pair[] = []; // a = element, b = set
  private notmems: Pair[] = [];

  constructor(private env: ProverEnv) {
    for (const atom of env.atoms) {
      const v = view(atom.term);
      if (!v) continue;
      const p = premiseOf(atom);
      const pair = (a: Term, b: Term): Pair => ({ a, b, ka: key(a), kb: key(b), p });
      if (v.k === 'eq') this.eqs.push(pair(v.a, v.b));
      else if (v.k === 'sub') this.subs.push(pair(v.a, v.b));
      else if (v.k === 'mem') this.mems.push(pair(v.x, v.s));
      else this.notmems.push(pair(v.x, v.s));
    }
  }

  /** Premises showing x ∈ T, or null. */
  mem(x: Term, T: Term): Premise[] | null {
    return this.deepen((d) => this.m(x, key(x), T, d, new Set()));
  }

  /** Premises showing x ∉ T, or null. */
  notMem(x: Term, T: Term): Premise[] | null {
    return this.deepen((d) => this.n(x, key(x), T, d, new Set()));
  }

  /** Premises showing A ⊆ B, or null. */
  sub(A: Term, B: Term): Premise[] | null {
    return this.deepen((d) => this.s(A, B, d, new Set()));
  }

  private deepen(f: (d: number) => Proof): Premise[] | null {
    for (let d = 0; d <= MAX_DEPTH; d++) {
      const r = f(d);
      // facts first (in the order they are used), general laws last
      if (r) return dedupe([...r.filter((p) => p.src !== 'law'), ...r.filter((p) => p.src === 'law')]);
    }
    return null;
  }

  private decl(name: string): Term | undefined {
    return this.env.decls.get(name);
  }

  /** Is T a whole given set (or ℤ), so that every well-typed element belongs to it? */
  private isCarrier(T: Term): boolean {
    return (T.kind === 'name' && this.env.givenSets.has(T.name)) || (T.kind === 'builtinSet' && T.set === 'ℤ');
  }

  /** One step with a rewrite law (dom (R ∪ S) = …), shown as a premise. */
  private lawStep(T: Term): [Term, Premise] | null {
    const r = rewriteOnce(T, this.env.laws);
    return r ? [r.term, { text: r.law.statement, reason: r.law.reason, src: 'law' }] : null;
  }

  /**
   * Rewrite T with an equation (either direction), for the next search level. Never
   * from a constant (with `count = 0`, every 0 would become `count`).
   */
  private *rewrites(T: Term): Generator<[Term, Premise]> {
    for (const e of this.eqs) {
      for (const [from, kFrom, to] of [
        [e.b, e.kb, e.a],
        [e.a, e.ka, e.b],
      ] as [Term, string, Term][]) {
        if (freeVars(from).size === 0) continue;
        const T2 = replaceSub(T, kFrom, to);
        if (T2) yield [T2, e.p];
      }
    }
  }

  // ── x ∈ T ────────────────────────────────────────────────────────────────────

  private m(x: Term, kx: string, T: Term, d: number, path: Set<string>): Proof {
    const kT = key(T);
    const goal = `∈${kx}|${kT}`;
    if (path.has(goal)) return null;
    path = new Set(path).add(goal);

    for (const a of this.mems) if (a.ka === kx && a.kb === kT) return [a.p];
    if (T.kind === 'setDisplay' && T.elems.some((e) => key(e) === kx)) return [];
    if (this.isCarrier(T)) return []; // true by typing
    if (x.kind === 'name') {
      const dt = this.decl(x.name);
      if (dt && key(dt) === kT) return [declPremise(x.name, dt)];
    }

    if (T.kind === 'binop') {
      if (T.op === '∪') return this.m(x, kx, T.left, d, path) ?? this.m(x, kx, T.right, d, path);
      if (T.op === '∩') {
        const l = this.m(x, kx, T.left, d, path);
        const r = l && this.m(x, kx, T.right, d, path);
        return l && r ? [...l, ...r] : null;
      }
      if (T.op === '∖') {
        const l = this.m(x, kx, T.left, d, path);
        const r = l && this.n(x, kx, T.right, d, path);
        return l && r ? [...l, ...r] : null;
      }
    }
    if (T.kind === 'unop' && (T.op === 'dom' || T.op === 'ran')) {
      const R = T.arg;
      const i = T.op === 'dom' ? 0 : 1;
      if (
        R.kind === 'setDisplay' &&
        R.elems.some((e) => {
          const p = pairParts(e);
          return !!p && key(p[i]) === kx;
        })
      ) {
        return [];
      }
      if (R.kind === 'binop' && R.op === '∪') {
        return this.m(x, kx, { ...T, arg: R.left }, d, path) ?? this.m(x, kx, { ...T, arg: R.right }, d, path);
      }
      if (T.op === 'dom' && R.kind === 'name') {
        // f : X → Y  gives  dom f = X
        const dt = this.decl(R.name);
        if (dt && dt.kind === 'binop' && dt.op === '→') {
          const rest = this.m(x, kx, dt.left, d, path);
          if (rest) return [declPremise(R.name, dt), ...rest];
        }
      }
    }
    const law = this.lawStep(T);
    if (law) {
      const r = this.m(x, kx, law[0], d, path);
      if (r) return [...r, law[1]];
    }
    if (d <= 0) return null;
    for (const [T2, p] of this.rewrites(T)) {
      const r = this.m(x, kx, T2, d - 1, path);
      if (r) return [...r, p];
    }
    for (const s of this.subs) {
      if (s.kb !== kT) continue;
      const r = this.m(x, kx, s.a, d - 1, path);
      if (r) return [...r, s.p];
    }
    return null;
  }

  // ── x ∉ T ────────────────────────────────────────────────────────────────────

  private n(x: Term, kx: string, T: Term, d: number, path: Set<string>): Proof {
    const kT = key(T);
    const goal = `∉${kx}|${kT}`;
    if (path.has(goal)) return null;
    path = new Set(path).add(goal);

    for (const a of this.notmems) if (a.ka === kx && a.kb === kT) return [a.p];
    if (isEmptySet(T)) return [];
    if (T.kind === 'binop') {
      if (T.op === '∪') {
        const l = this.n(x, kx, T.left, d, path);
        const r = l && this.n(x, kx, T.right, d, path);
        return l && r ? [...l, ...r] : null;
      }
      if (T.op === '∩') return this.n(x, kx, T.left, d, path) ?? this.n(x, kx, T.right, d, path);
      if (T.op === '∖') return this.n(x, kx, T.left, d, path) ?? this.m(x, kx, T.right, d, path);
    }
    if (T.kind === 'unop' && (T.op === 'dom' || T.op === 'ran')) {
      const R = T.arg;
      if (isEmptySet(R)) return [];
      if (R.kind === 'binop' && R.op === '∪') {
        const l = this.n(x, kx, { ...T, arg: R.left }, d, path);
        const r = l && this.n(x, kx, { ...T, arg: R.right }, d, path);
        return l && r ? [...l, ...r] : null;
      }
    }
    const law = this.lawStep(T);
    if (law) {
      const r = this.n(x, kx, law[0], d, path);
      if (r) return [...r, law[1]];
    }
    if (d <= 0) return null;
    for (const [T2, p] of this.rewrites(T)) {
      const r = this.n(x, kx, T2, d - 1, path);
      if (r) return [...r, p];
    }
    // T ⊆ S and x ∉ S
    for (const s of this.subs) {
      if (s.ka !== kT) continue;
      const r = this.n(x, kx, s.b, d - 1, path);
      if (r) return [...r, s.p];
    }
    return null;
  }

  // ── A ⊆ B ────────────────────────────────────────────────────────────────────

  private s(A: Term, B: Term, d: number, path: Set<string>): Proof {
    const kA = key(A);
    const kB = key(B);
    if (kA === kB) return [];
    const goal = `⊆${kA}|${kB}`;
    if (path.has(goal)) return null;
    path = new Set(path).add(goal);

    if (isEmptySet(A)) return [];
    for (const s of this.subs) if (s.ka === kA && s.kb === kB) return [s.p];
    for (const e of this.eqs) if ((e.ka === kA && e.kb === kB) || (e.ka === kB && e.kb === kA)) return [e.p];
    const dp = this.declSub(A, kB);
    if (dp) return [dp];
    if (this.isCarrier(B)) return [];

    if (A.kind === 'binop') {
      if (A.op === '∪') {
        const l = this.s(A.left, B, d, path);
        const r = l && this.s(A.right, B, d, path);
        return l && r ? [...l, ...r] : null;
      }
      if (A.op === '∩') return this.s(A.left, B, d, path) ?? this.s(A.right, B, d, path);
      if (A.op === '∖') return this.s(A.left, B, d, path);
    }
    if (B.kind === 'binop') {
      if (B.op === '∪') return this.s(A, B.left, d, path) ?? this.s(A, B.right, d, path);
      if (B.op === '∩') {
        const l = this.s(A, B.left, d, path);
        const r = l && this.s(A, B.right, d, path);
        return l && r ? [...l, ...r] : null;
      }
    }
    if (A.kind === 'setDisplay') {
      const out: Premise[] = [];
      for (const e of A.elems) {
        const r = this.m(e, key(e), B, d, path);
        if (!r) return null;
        out.push(...r);
      }
      return out;
    }
    if (A.kind === 'unop' && (A.op === 'dom' || A.op === 'ran') && A.arg.kind === 'binop' && A.arg.op === '∪') {
      const l = this.s({ ...A, arg: A.arg.left }, B, d, path);
      const r = l && this.s({ ...A, arg: A.arg.right }, B, d, path);
      return l && r ? [...l, ...r] : null;
    }
    if (d <= 0) return null;
    for (const [A2, p] of this.rewrites(A)) {
      const r = this.s(A2, B, d - 1, path);
      if (r) return [...r, p];
    }
    for (const [B2, p] of this.rewrites(B)) {
      const r = this.s(A, B2, d - 1, path);
      if (r) return [...r, p];
    }
    // A ⊆ C ⊆ B
    for (const s of this.subs) {
      if (s.ka !== kA) continue;
      const r = this.s(s.b, B, d - 1, path);
      if (r) return [s.p, ...r];
    }
    return null;
  }

  /** A ⊆ B directly from a declaration: S : ℙ B, dom f / ran f with f : B ⇸ Y / X ⇸ B. */
  declSub(A: Term, kB: string): Premise | null {
    if (A.kind === 'name') {
      const dt = this.decl(A.name);
      if (dt && dt.kind === 'unop' && dt.op === 'ℙ' && key(dt.arg) === kB) return declPremise(A.name, dt);
    }
    if (A.kind === 'unop' && (A.op === 'dom' || A.op === 'ran') && A.arg.kind === 'name') {
      const dt = this.decl(A.arg.name);
      if (dt && dt.kind === 'binop' && (dt.op === '↔' || dt.op === '⇸' || dt.op === '→')) {
        const side = A.op === 'dom' ? dt.left : dt.right;
        if (key(side) === kB) return declPremise(A.arg.name, dt);
      }
    }
    return null;
  }
}
