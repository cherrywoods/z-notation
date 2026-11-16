// Constraint solver for examples: find values for unknown variables such that all
// (hard) predicates hold. A mix of
//   * definitions   `v = e` computes v from e (e.g. onLoan = dom borrower),
//   * guided choices for sets (`dom f ⊆ S`, `x ∈ s`, `∀ x : s • P`, …) and scalars
//                   (the candidate that satisfies most predicates),
//   * random generation of the remaining variables (small values), and
//   * local search on the graded distance of violated predicates (see dist.ts),
//     with restarts.
// Everything is deterministic for a given Rng; time budgets only cut the search short.

import type { Term } from '../ast';
import { evalPred, evalTerm, memberOf, memberOfDeclared, type Universe } from '../eval';
import { freeVars } from '../print';
import { isSetLike, valueEquals, valueKey, type SetLike, type Value } from '../values';
import { dist, hasBinder } from './dist';
import { allowedElements, emptySpec, enumDom, genSet, isScalarDom, isSetDom, mutateDom, repairSet, sampleDom, type Dom, type SetDom, type SetSpec } from './dom';
import type { Rng } from './rng';

export type Env = Map<string, Value>;

export interface Unknown {
  name: string;
  dom: Dom;
  /** Declared set (checked with memberOfDeclared). */
  declared: Term | null;
  /** Preference as the target of a definition `v = e` (higher: rather computed). */
  rank: number;
  /** Start value: a copy of this variable's value (e.g. borrower′ from borrower)… */
  initFrom?: string;
  /** …or this value (e.g. fixed example data) — with probability initProb (default 0.7). */
  initValue?: Value;
  initProb?: number;
  /** Prefer a non-empty value. */
  penalizeEmpty?: boolean;
}

export interface Con {
  term: Term;
  /** Hard constraints must hold; soft ones are preferences. */
  hard: boolean;
  weight: number;
  tag?: unknown;
}

export interface Problem {
  u: Universe;
  known: ReadonlyMap<string, Value>;
  unknowns: Unknown[];
  cons: Con[];
}

export interface SolveResult {
  ok: boolean;
  env: Env;
  /** Violated constraints of the returned assignment. */
  violated: Con[];
  /** Unknowns whose value is not in their declared set. */
  badDecls: string[];
}

export interface SearchOpts {
  maxSteps: number;
  deadline: number;
  /** Extra steps to reduce soft penalties once all hard constraints hold. */
  softSteps?: number;
  restartAfter?: number;
}

export const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const EPS = 1e-9;
const P_WORSE = 0.04;

// ── plan: definitions, order, guides ───────────────────────────────────────────

interface ICon {
  kind: 'pred' | 'decl' | 'empty' | 'differs';
  hard: boolean;
  weight: number;
  vars: number[];
  roots: number[];
  src?: Con;
  v?: number;
  eval(env: Env): number;
}

interface Def {
  expr: Term;
  deps: number[];
}

interface SetGuide {
  /** Unknowns the guide reads. */
  deps: number[];
  apply(env: Env, spec: SetSpec): void;
}

export interface Plan {
  p: Problem;
  names: string[];
  idx: Map<string, number>;
  defs: (Def | null)[];
  order: number[];
  roots: number[];
  downstream: number[][];
  rootsOf: number[][];
  cons: ICon[];
  consByVar: number[][];
  scalarGuides: number[][];
  setGuides: SetGuide[][];
  /** Roots whose guides read (something computed from) this root, in generation order. */
  dependents: number[][];
}

const conjuncts = (t: Term): Term[] => (t.kind === 'logic' && t.op === '∧' ? [...conjuncts(t.left), ...conjuncts(t.right)] : [t]);

export function buildPlan(p: Problem, differs?: { name: string; value: Value }): Plan {
  const u = p.u;
  const names = p.unknowns.map((x) => x.name);
  const n = names.length;
  const idx = new Map(names.map((x, i) => [x, i]));
  const depsOf = (fv: Iterable<string>): number[] => {
    const out: number[] = [];
    for (const f of fv) {
      const i = idx.get(f);
      if (i !== undefined) out.push(i);
    }
    return out;
  };
  const unknownDeps = (t: Term) => depsOf(freeVars(t));

  // definitions v = e (greedy, acyclic, preferring after-state/outputs as targets)
  const cands: { target: number; expr: Term; deps: number[]; ci: number }[] = [];
  p.cons.forEach((c, ci) => {
    if (!c.hard) return;
    for (const cj of conjuncts(c.term)) {
      if (cj.kind !== 'rel' || cj.op !== '=') continue;
      for (const [side, other] of [
        [cj.left, cj.right],
        [cj.right, cj.left],
      ] as const) {
        if (side.kind !== 'name') continue;
        const target = idx.get(side.name);
        if (target === undefined || freeVars(other).has(side.name)) continue;
        cands.push({ target, expr: other, deps: unknownDeps(other), ci });
      }
    }
  });
  cands.sort(
    (a, b) =>
      p.unknowns[b.target].rank - p.unknowns[a.target].rank || a.deps.length - b.deps.length || a.ci - b.ci || b.target - a.target,
  );
  const defs: (Def | null)[] = new Array(n).fill(null);
  const dependsOn = (a: number, b: number, seen = new Set<number>()): boolean => {
    if (a === b) return true;
    const d = defs[a];
    if (!d || seen.has(a)) return false;
    seen.add(a);
    return d.deps.some((x) => dependsOn(x, b, seen));
  };
  for (const c of cands) {
    if (defs[c.target]) continue;
    if (c.deps.some((x) => dependsOn(x, c.target))) continue;
    defs[c.target] = { expr: c.expr, deps: c.deps };
  }

  // generation order: roots in the given order, defined variables as soon as possible
  const placed = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  const placeDefs = () => {
    for (let changed = true; changed; ) {
      changed = false;
      for (let i = 0; i < n; i++) {
        const d = defs[i];
        if (!placed[i] && d && d.deps.every((x) => placed[x])) {
          placed[i] = true;
          order.push(i);
          changed = true;
        }
      }
    }
  };
  placeDefs();
  const roots: number[] = [];
  for (let i = 0; i < n; i++) {
    if (defs[i]) continue;
    roots.push(i);
    placed[i] = true;
    order.push(i);
    placeDefs();
  }
  const pos = new Array<number>(n);
  order.forEach((v, i) => (pos[v] = i));

  // root closure and downstream definitions
  const rootsOf: number[][] = new Array(n);
  const closure: Set<number>[] = new Array(n);
  for (const v of order) {
    const d = defs[v];
    if (!d) {
      rootsOf[v] = [v];
      closure[v] = new Set();
    } else {
      const rs = new Set<number>();
      const cl = new Set<number>();
      for (const x of d.deps) {
        for (const r of rootsOf[x]) rs.add(r);
        cl.add(x);
        for (const y of closure[x]) cl.add(y);
      }
      rootsOf[v] = [...rs];
      closure[v] = cl;
    }
  }
  const downstream: number[][] = Array.from({ length: n }, () => []);
  for (const w of order) if (defs[w]) for (const x of closure[w]) downstream[x].push(w);

  // constraints
  const cons: ICon[] = [];
  const rootsFor = (vars: number[]) => [...new Set(vars.flatMap((v) => rootsOf[v]))];
  for (const c of p.cons) {
    const vars = unknownDeps(c.term);
    cons.push({ kind: 'pred', hard: c.hard, weight: c.weight, vars, roots: rootsFor(vars), src: c, eval: (env) => dist(c.term, env, u) });
  }
  p.unknowns.forEach((x, v) => {
    const declared = x.declared;
    if (declared) {
      cons.push({
        kind: 'decl',
        hard: true,
        weight: 2,
        vars: [v],
        roots: rootsOf[v],
        v,
        eval: (env) => {
          const val = env.get(x.name);
          try {
            return val && memberOfDeclared(val, declared, env, u) ? 0 : 1;
          } catch {
            return 1;
          }
        },
      });
    }
    if (x.penalizeEmpty) {
      cons.push({
        kind: 'empty',
        hard: false,
        weight: 0.25,
        vars: [v],
        roots: rootsOf[v],
        v,
        eval: (env) => {
          const val = env.get(x.name);
          return val && val.k === 'set' && val.elems.length === 0 ? 1 : 0;
        },
      });
    }
  });
  if (differs) {
    const v = idx.get(differs.name);
    if (v !== undefined) {
      cons.push({
        kind: 'differs',
        hard: true,
        weight: 1,
        vars: [v],
        roots: rootsOf[v],
        v,
        eval: (env) => {
          const val = env.get(differs.name);
          return val && !valueEquals(val, differs.value) ? 0 : 1;
        },
      });
    }
  }
  const consByVar: number[][] = Array.from({ length: n }, () => []);
  cons.forEach((c, ci) => {
    for (const v of c.vars) consByVar[v].push(ci);
  });

  // guides for roots
  const scalarGuides: number[][] = Array.from({ length: n }, () => []);
  const setGuides: SetGuide[][] = Array.from({ length: n }, () => []);
  for (const r of roots) {
    const dom = p.unknowns[r].dom;
    if (isScalarDom(dom)) {
      scalarGuides[r] = cons
        .map((c, ci) => ({ c, ci }))
        .filter(({ c }) => c.kind === 'pred' && c.vars.includes(r) && c.vars.every((x) => pos[x] <= pos[r]))
        .map(({ ci }) => ci);
    } else {
      const placedBefore = (deps: number[]) => deps.every((x) => x !== r && pos[x] < pos[r]);
      for (const c of p.cons) {
        if (!c.hard) continue;
        for (const cj of conjuncts(c.term)) setGuides[r].push(...guidesFor(cj, names[r], depsOf, placedBefore, u));
      }
    }
  }

  // roots guided by other roots: re-adjusted together with them (compound moves)
  const guideDeps: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (const r of roots) {
    for (const ci of scalarGuides[r]) for (const x of cons[ci].vars) if (x !== r) guideDeps[r].add(x);
    for (const g of setGuides[r]) for (const x of g.deps) guideDeps[r].add(x);
  }
  const dependents: number[][] = Array.from({ length: n }, () => []);
  for (const w of order) {
    if (defs[w]) continue;
    const rs = new Set<number>();
    for (const x of guideDeps[w]) for (const r of rootsOf[x]) rs.add(r);
    for (const r of rs) if (r !== w) dependents[r].push(w);
  }

  return { p, names, idx, defs, order, roots, downstream, rootsOf, cons, consByVar, scalarGuides, setGuides, dependents };
}

// ── set guides ─────────────────────────────────────────────────────────────────

type Proj = (e: Value) => Value | undefined;
const ID: Proj = (e) => e;
const FIRST: Proj = (e) => (e.k === 'tuple' && e.elems.length === 2 ? e.elems[0] : undefined);
const SECOND: Proj = (e) => (e.k === 'tuple' && e.elems.length === 2 ? e.elems[1] : undefined);

/** Guides for generating set variable `v` from one conjunct (empty if none applies). */
function guidesFor(
  cj: Term,
  v: string,
  depsOf: (names: Iterable<string>) => number[],
  placedBefore: (deps: number[]) => boolean,
  u: Universe,
): SetGuide[] {
  const unknownDeps = (t: Term) => depsOf(freeVars(t));
  const isV = (t: Term) => t.kind === 'name' && t.name === v;
  const proj = (t: Term): Proj | null =>
    isV(t) ? ID : t.kind === 'unop' && isV(t.arg) ? (t.op === 'dom' ? FIRST : t.op === 'ran' ? SECOND : null) : null;
  const usable = (e: Term) => !freeVars(e).has(v) && placedBefore(unknownDeps(e));
  const isEmptySet = (t: Term) => t.kind === 'emptyset' || (t.kind === 'setDisplay' && t.elems.length === 0);
  const setOf = (e: Term, env: Env): SetLike | null => {
    const s = evalTerm(e, env, u);
    return isSetLike(s) ? s : null;
  };

  const filterIn = (e: Term, pj: Proj, negate = false): SetGuide => ({
    deps: unknownDeps(e),
    apply(env, spec) {
      const s = setOf(e, env);
      if (!s) return;
      spec.filters.push((x) => {
        const y = pj(x);
        return y !== undefined && memberOf(y, s, u) !== negate;
      });
    },
  });
  const requireAll = (e: Term, toDom: boolean): SetGuide => ({
    deps: unknownDeps(e),
    apply(env, spec) {
      const s = setOf(e, env);
      if (s && s.k === 'set') (toDom ? spec.reqDom : spec.required).push(...s.elems);
    },
  });

  const out: SetGuide[] = [];
  if (cj.kind === 'rel') {
    const { op, left: L, right: R } = cj;
    if (op === '⊆' || op === '⊂') {
      const pl = proj(L);
      if (pl && usable(R)) out.push(filterIn(R, pl));
      if (isV(R) && usable(L)) out.push(requireAll(L, false));
      if (R.kind === 'unop' && R.op === 'dom' && isV(R.arg) && usable(L)) out.push(requireAll(L, true));
    } else if (op === '=') {
      for (const [a, b] of [
        [L, R],
        [R, L],
      ] as const) {
        const pa = a.kind === 'unop' ? proj(a) : null;
        if (pa && usable(b)) {
          out.push(filterIn(b, pa));
          if (pa === FIRST) out.push(requireAll(b, true));
        }
        // A ∩ B = ∅
        if (a.kind === 'binop' && a.op === '∩' && isEmptySet(b)) {
          for (const [x, y] of [
            [a.left, a.right],
            [a.right, a.left],
          ] as const) {
            const px = proj(x);
            if (px && usable(y)) out.push(filterIn(y, px, true));
          }
        }
      }
    } else if (op === '∈' && isV(R) && usable(L)) {
      out.push({
        deps: unknownDeps(L),
        apply(env, spec) {
          spec.required.push(evalTerm(L, env, u));
        },
      });
    } else if (op === '∉' && isV(R) && usable(L)) {
      out.push({
        deps: unknownDeps(L),
        apply(env, spec) {
          const val = evalTerm(L, env, u);
          spec.filters.push((x) => !valueEquals(x, val));
        },
      });
    }
  } else if (cj.kind === 'quant' && cj.q === '∀' && cj.decls.length === 1 && cj.decls[0].names.length === 1) {
    const x = cj.decls[0].names[0].name;
    const pj = proj(cj.decls[0].type);
    const body = cj.body;
    const guard = cj.pred;
    const rest = new Set([...freeVars(body), ...(guard ? freeVars(guard) : [])]);
    rest.delete(x);
    const deps = depsOf(rest);
    if (pj && x !== v && !rest.has(v) && placedBefore(deps)) {
      out.push({
        deps,
        apply(env, spec) {
          spec.filters.push((e) => {
            const y = pj(e);
            if (y === undefined) return false;
            const had = env.has(x);
            const old = env.get(x);
            env.set(x, y);
            try {
              return (guard ? !evalPred(guard, env, u) : false) || evalPred(body, env, u);
            } catch {
              return false;
            } finally {
              if (had) env.set(x, old as Value);
              else env.delete(x);
            }
          });
        },
      });
    }
  }
  return out;
}

// ── search ─────────────────────────────────────────────────────────────────────

interface Undo {
  changed: number[];
  oldVals: (Value | undefined)[];
  affected: number[];
  oldD: number[];
  oldHC: number;
  oldObj: number;
}

interface Snapshot {
  vals: (Value | undefined)[];
  dist: number[];
  hardCount: number;
  obj: number;
}

export class Search {
  readonly env: Env;
  private dist: number[];
  private hardCount = 0;
  private obj = 0;
  private readonly mark: Int32Array;
  private stamp = 0;
  /** Deadline of the current run (also checked inside expensive moves). */
  private deadline = Infinity;

  constructor(
    readonly pl: Plan,
    readonly rng: Rng,
  ) {
    this.env = new Map(pl.p.known);
    this.dist = new Array(pl.cons.length).fill(0);
    this.mark = new Int32Array(pl.cons.length);
  }

  /** Run the local search from a fresh random assignment (or from `start`). */
  run(opts: SearchOpts, start?: ReadonlyMap<string, Value>): SolveResult {
    this.deadline = opts.deadline;
    if (start) this.load(start);
    else this.fresh();
    let best = this.snapshot();
    let stall = 0;
    let softSteps = 0;
    const restartAfter = opts.restartAfter ?? 120;
    for (let step = 0; step < opts.maxSteps; step++) {
      if (this.hardCount === 0) {
        if (this.softTotal() <= EPS || ++softSteps > (opts.softSteps ?? 40)) break;
      }
      if (now() > opts.deadline) break;
      const r = this.chooseRoot();
      if (r < 0) break;
      this.move(r);
      if (this.better(best)) {
        best = this.snapshot();
        stall = 0;
      } else if (++stall > restartAfter) {
        stall = 0;
        if (start) this.load(start);
        else if (this.rng.chance(0.3)) this.restore(best);
        else this.fresh();
      }
    }
    this.restore(best);
    return this.result();
  }

  /** Try all combinations of candidate values for some scalar roots (the others as in `start`). */
  exhaust(roots: number[], start: ReadonlyMap<string, Value>, deadline: number): SolveResult | null {
    this.deadline = deadline;
    this.load(start);
    const cands = roots.map((r) => enumDom(this.pl.p.unknowns[r].dom) ?? []);
    let count = 0;
    const rec = (i: number): SolveResult | null => {
      if (i === roots.length) {
        if (this.hardCount !== 0) return null;
        const res = this.result();
        return res.ok ? res : null;
      }
      for (const c of cands[i]) {
        const undo = this.apply(roots[i], c);
        const r = rec(i + 1);
        this.undo(undo);
        if (r) return r;
        if ((++count & 31) === 0 && now() > deadline) return null;
      }
      return null;
    };
    return rec(0);
  }

  /**
   * Are these roots each pinned to one value by their guides alone? True when the
   * guides that only read fixed values allow no element that is not also required
   * (e.g. `dom allergic ⊆ patients` with patients = ∅). The guides are necessary
   * conditions, so this is a proof, and it saves a pointless search.
   */
  allForced(roots: number[], start: ReadonlyMap<string, Value>): boolean {
    const { pl } = this;
    if (!roots.length) return true;
    this.load(start);
    return roots.every((r) => {
      const dom = pl.p.unknowns[r].dom;
      // only guides that read fixed values (each is a necessary condition on its own)
      const guides = pl.setGuides[r].filter((g) => g.deps.every((d) => pl.rootsOf[d].length === 0));
      if (!isSetDom(dom) || !guides.length) return false;
      const spec = this.specFor(r, guides);
      const allowed = allowedElements(dom, this.rng, spec);
      if (!allowed) return false;
      const req = new Set(spec.required.map(valueKey));
      return allowed.every((e) => req.has(valueKey(e)));
    });
  }

  /** Current assignment as a result (verified with the exact evaluator). */
  result(): SolveResult {
    const violated: Con[] = [];
    const badDecls: string[] = [];
    let ok = true;
    this.pl.cons.forEach((c) => {
      const d = c.eval(this.env);
      let bad = d > 0;
      if (c.kind === 'pred' && c.src && !bad && !hasBinder(c.src.term)) {
        // double-check with the evaluator itself (cheap without quantifiers)
        try {
          bad = !evalPred(c.src.term, this.env, this.pl.p.u);
        } catch {
          bad = true;
        }
      }
      if (!bad || !c.hard) return;
      ok = false;
      if (c.kind === 'pred' && c.src) violated.push(c.src);
      if (c.kind === 'decl' && c.v !== undefined) badDecls.push(this.pl.names[c.v]);
    });
    return { ok, env: new Map(this.env), violated, badDecls };
  }

  // ── assignments ──

  private fresh(): void {
    const { pl, env, rng } = this;
    for (const v of pl.order) {
      const U = pl.p.unknowns[v];
      const def = pl.defs[v];
      if (def) {
        try {
          env.set(U.name, evalTerm(def.expr, env, pl.p.u));
        } catch {
          env.set(U.name, sampleDom(U.dom, rng));
        }
        continue;
      }
      if (U.initFrom !== undefined && env.has(U.initFrom) && rng.chance(U.initProb ?? 0.7)) {
        env.set(U.name, env.get(U.initFrom) as Value);
        continue;
      }
      if (U.initValue && rng.chance(U.initProb ?? 0.7)) {
        env.set(U.name, U.initValue);
        continue;
      }
      if (isScalarDom(U.dom)) env.set(U.name, this.bestScalar(v));
      else env.set(U.name, genSet(U.dom as SetDom, rng, this.specFor(v), 0));
    }
    this.recomputeAll();
  }

  private load(start: ReadonlyMap<string, Value>): void {
    for (const [k, val] of start) if (this.pl.idx.has(k)) this.env.set(k, val);
    for (const U of this.pl.p.unknowns) if (!this.env.has(U.name)) this.env.set(U.name, sampleDom(U.dom, this.rng));
    this.recomputeAll();
  }

  private recomputeAll(): void {
    this.hardCount = 0;
    this.obj = 0;
    this.pl.cons.forEach((c, i) => {
      const d = c.eval(this.env);
      this.dist[i] = d;
      if (c.hard && d > 0) this.hardCount++;
      this.obj += c.weight * d;
    });
  }

  private snapshot(): Snapshot {
    return {
      vals: this.pl.names.map((x) => this.env.get(x)),
      dist: [...this.dist],
      hardCount: this.hardCount,
      obj: this.obj,
    };
  }

  private restore(s: Snapshot): void {
    this.pl.names.forEach((x, i) => {
      const val = s.vals[i];
      if (val) this.env.set(x, val);
      else this.env.delete(x);
    });
    this.dist = [...s.dist];
    this.hardCount = s.hardCount;
    this.obj = s.obj;
  }

  private better(s: Snapshot): boolean {
    return this.hardCount < s.hardCount || (this.hardCount === s.hardCount && this.obj < s.obj - EPS);
  }

  private softTotal(): number {
    let t = 0;
    this.pl.cons.forEach((c, i) => {
      if (!c.hard) t += c.weight * this.dist[i];
    });
    return t;
  }

  // ── moves ──

  private chooseRoot(): number {
    const { pl, rng } = this;
    const hardV: ICon[] = [];
    const softV: ICon[] = [];
    pl.cons.forEach((c, i) => {
      if (this.dist[i] > 0 && c.roots.length) (c.hard ? hardV : softV).push(c);
    });
    if (this.hardCount > 0 && !hardV.length) return -1; // only unfixable constraints are violated
    if (hardV.length && rng.chance(0.9)) return rng.pick(rng.pick(hardV).roots);
    if (softV.length && rng.chance(0.8)) return rng.pick(rng.pick(softV).roots);
    if (hardV.length) return rng.pick(rng.pick(hardV).roots);
    return pl.roots.length ? rng.pick(pl.roots) : -1;
  }

  private move(r: number): void {
    const { pl, rng, env } = this;
    const U = pl.p.unknowns[r];
    const cur = env.get(U.name) as Value;
    let cand: Value;
    if (isScalarDom(U.dom)) {
      let cands = (enumDom(U.dom) ?? []).filter((c) => !valueEquals(c, cur));
      if (!cands.length) return;
      if (cands.length > 16) cands = rng.sample(cands, 16);
      if (rng.chance(0.5)) {
        // best of all candidates
        const start = this.obj;
        let bestObj = Infinity;
        let bestVals: Value[] = [];
        for (const c of cands) {
          if (bestVals.length && now() > this.deadline) break;
          const undo = this.apply(r, c);
          const o = this.obj;
          this.undo(undo);
          if (o < bestObj - EPS) {
            bestObj = o;
            bestVals = [c];
          } else if (Math.abs(o - bestObj) <= EPS) bestVals.push(c);
        }
        if (bestObj <= start + EPS || rng.chance(P_WORSE)) this.apply(r, rng.pick(bestVals));
        return;
      }
      cand = rng.pick(cands);
    } else {
      cand = mutateDom(U.dom, cur, rng, rng.chance(0.85) ? this.specFor(r) : null, 0);
    }
    const before = this.obj;
    const undos = [this.apply(r, cand)];
    // compound move: re-adjust the roots that are guided by r (e.g. dom balance = dom owner)
    if (pl.dependents[r].length && rng.chance(0.5)) {
      for (const w of pl.dependents[r]) {
        const nv = this.repaired(w);
        const old = env.get(pl.names[w]);
        if (nv && (!old || !valueEquals(nv, old))) undos.push(this.apply(w, nv));
      }
    }
    if (this.obj > before + EPS && !rng.chance(P_WORSE)) for (let i = undos.length - 1; i >= 0; i--) this.undo(undos[i]);
  }

  /** A value for root w that fits its guides again after other roots changed. */
  private repaired(w: number): Value | null {
    const U = this.pl.p.unknowns[w];
    if (isScalarDom(U.dom)) return this.pl.scalarGuides[w].length ? this.bestScalar(w) : null;
    const cur = this.env.get(U.name);
    if (!cur || cur.k !== 'set' || !isSetDom(U.dom)) return null;
    return repairSet(U.dom, cur, this.rng, this.specFor(w));
  }

  private apply(r: number, val: Value): Undo {
    const { pl, env } = this;
    const changed = [r, ...pl.downstream[r]];
    const oldVals = changed.map((v) => env.get(pl.names[v]));
    env.set(pl.names[r], val);
    for (const w of pl.downstream[r]) {
      try {
        env.set(pl.names[w], evalTerm((pl.defs[w] as Def).expr, env, pl.p.u));
      } catch {
        /* keep the old value; the defining predicate is now violated */
      }
    }
    const stamp = ++this.stamp;
    const affected: number[] = [];
    for (const v of changed) {
      for (const c of pl.consByVar[v]) {
        if (this.mark[c] !== stamp) {
          this.mark[c] = stamp;
          affected.push(c);
        }
      }
    }
    const rec: Undo = { changed, oldVals, affected, oldD: affected.map((c) => this.dist[c]), oldHC: this.hardCount, oldObj: this.obj };
    for (const c of affected) {
      const C = pl.cons[c];
      const old = this.dist[c];
      const d = C.eval(env);
      if (C.hard) this.hardCount += (d > 0 ? 1 : 0) - (old > 0 ? 1 : 0);
      this.obj += C.weight * (d - old);
      this.dist[c] = d;
    }
    return rec;
  }

  private undo(rec: Undo): void {
    rec.changed.forEach((v, i) => {
      const old = rec.oldVals[i];
      if (old) this.env.set(this.pl.names[v], old);
      else this.env.delete(this.pl.names[v]);
    });
    rec.affected.forEach((c, i) => (this.dist[c] = rec.oldD[i]));
    this.hardCount = rec.oldHC;
    this.obj = rec.oldObj;
  }

  /** Scalar root: the candidate that satisfies its guiding predicates best (random among ties). */
  private bestScalar(v: number): Value {
    const { pl, env, rng } = this;
    const U = pl.p.unknowns[v];
    let cands = enumDom(U.dom) ?? [sampleDom(U.dom, rng)];
    if (cands.length > 24) cands = rng.sample(cands, 24);
    const guides = pl.scalarGuides[v];
    if (!guides.length) return rng.pick(cands);
    const had = env.get(U.name);
    let best = Infinity;
    let bestVals: Value[] = [];
    for (const c of cands) {
      if (bestVals.length && now() > this.deadline) break;
      env.set(U.name, c);
      let s = 0;
      for (const g of guides) s += pl.cons[g].weight * pl.cons[g].eval(env);
      if (s < best - EPS) {
        best = s;
        bestVals = [c];
      } else if (Math.abs(s - best) <= EPS) bestVals.push(c);
    }
    if (had) env.set(U.name, had);
    else env.delete(U.name);
    return rng.pick(bestVals);
  }

  private specFor(v: number, guides = this.pl.setGuides[v]): SetSpec {
    const spec = emptySpec();
    for (const g of guides) {
      try {
        g.apply(this.env, spec);
      } catch {
        /* guide not applicable right now */
      }
    }
    return spec;
  }
}

/** Solve a problem with a few restarts inside the budget. */
export function solve(p: Problem, rng: Rng, opts: SearchOpts): SolveResult {
  const pl = buildPlan(p);
  return new Search(pl, rng).run(opts);
}

/**
 * Another solution that differs from `sol` in variable `x` (all other known values
 * fixed), or null if none was found. Only a verified solution counts.
 */
export function findWitness(p: Problem, x: string, sol: ReadonlyMap<string, Value>, rng: Rng, deadline: number): Value | null {
  const cur = sol.get(x);
  if (!cur) return null;
  const pl = buildPlan(p, { name: x, value: cur });
  const xi = pl.idx.get(x);
  if (xi === undefined || !pl.rootsOf[xi].length) return null;
  const search = new Search(pl, rng);
  const roots = pl.rootsOf[xi];
  if (search.allForced(roots, sol)) return null;
  let size = 1;
  for (const r of roots) size *= isScalarDom(p.unknowns[r].dom) ? (enumDom(p.unknowns[r].dom)?.length ?? Infinity) : Infinity;
  // few combinations: try them all (other roots as in sol); otherwise, or if other
  // roots would have to change too, local search
  let res = size <= 500 ? search.exhaust(roots, sol, deadline) : null;
  if (!res && (size > 500 || pl.roots.length > roots.length) && now() < deadline) {
    res = search.run({ maxSteps: 300, deadline, softSteps: 0, restartAfter: 50 }, sol);
  }
  if (!res || !res.ok) return null;
  const val = res.env.get(x);
  return val && !valueEquals(val, cur) ? val : null;
}

/** Is `x` computed from the known values by definitions alone (so it is determined)? */
export function isDetermined(pl: Plan, x: string): boolean {
  const i = pl.idx.get(x);
  return i !== undefined && pl.rootsOf[i].length === 0;
}
