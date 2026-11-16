// Type checker for terms and predicates. Scope rules of the schemas themselves (what
// Δ/Ξ import, which names may be declared where) live in index.ts; this module
// checks one term against a given scope and explains type errors in student terms.

import type { Span, Term, VarDecl } from './ast';
import type { SectionRef, ZDiagnostic } from '../spec/model';
import { printTerm } from './print';
import {
  BOOL,
  ERROR,
  INT,
  REAL,
  describeType,
  pair,
  power,
  product,
  relationParts,
  type ZType,
} from './types';

export interface Binding {
  type: ZType;
  /** given set, schema variable, or variable bound by ∀ / ∃ / { … } */
  kind: 'given' | 'var' | 'bound';
}
export type Scope = ReadonlyMap<string, Binding>;
export type NameTerm = Extract<Term, { kind: 'name' }>;

// ── unification ────────────────────────────────────────────────────────────────

export class Unifier {
  private subst = new Map<number, ZType>();
  private nextId = 0;

  fresh(): ZType {
    return { k: 'var', id: this.nextId++ };
  }

  /** Follow variable bindings at the top level. */
  walk(t: ZType): ZType {
    while (t.k === 'var') {
      const b = this.subst.get(t.id);
      if (!b) break;
      t = b;
    }
    return t;
  }

  /** Apply all bindings (deep). */
  resolve(t: ZType): ZType {
    const w = this.walk(t);
    if (w.k === 'power') return power(this.resolve(w.elem));
    if (w.k === 'product') return product(w.elems.map((e) => this.resolve(e)));
    return w;
  }

  /** Unify; on failure nothing is bound. `error` unifies with everything. */
  unify(a: ZType, b: ZType): boolean {
    const snap = new Map(this.subst);
    if (this.u(a, b)) return true;
    this.subst = snap;
    return false;
  }

  /** Would `a` and `b` unify? (No bindings are kept.) */
  canUnify(a: ZType, b: ZType): boolean {
    const snap = new Map(this.subst);
    const ok = this.u(a, b);
    this.subst = snap;
    return ok;
  }

  private u(a: ZType, b: ZType): boolean {
    a = this.walk(a);
    b = this.walk(b);
    if (a.k === 'error' || b.k === 'error') return true;
    if (a.k === 'var') {
      if (b.k === 'var' && b.id === a.id) return true;
      if (this.occurs(a.id, b)) return false;
      this.subst.set(a.id, b);
      return true;
    }
    if (b.k === 'var') return this.u(b, a);
    switch (a.k) {
      case 'given':
        return b.k === 'given' && a.name === b.name;
      case 'int':
      case 'bool':
        return a.k === b.k;
      case 'power':
        return b.k === 'power' && this.u(a.elem, b.elem);
      case 'product':
        return b.k === 'product' && a.elems.length === b.elems.length && a.elems.every((e, i) => this.u(e, b.elems[i]));
    }
  }

  private occurs(id: number, t: ZType): boolean {
    const w = this.walk(t);
    if (w.k === 'var') return w.id === id;
    if (w.k === 'power') return this.occurs(id, w.elem);
    if (w.k === 'product') return w.elems.some((e) => this.occurs(id, e));
    return false;
  }
}

// ── checker ────────────────────────────────────────────────────────────────────

export interface CheckerOptions {
  /** Section the checked terms come from (for diagnostics). */
  section: SectionRef;
  /** Receives diagnostics; omit to check silently. */
  report?: (d: ZDiagnostic) => void;
  /** Filled with the (resolved) type of every checked sub-term. */
  termTypes?: WeakMap<Term, ZType>;
  /** Message for a name that is not in scope (a 'scope' diagnostic). */
  unknownName?: (t: NameTerm, scope: Scope) => string;
}

const MAX_SHOWN = 40;

/** Quote a term for a message: ‘dom borrower’ (shortened if long). */
export function quoteTerm(t: Term): string {
  let s = printTerm(t);
  if (s.length > MAX_SHOWN) s = s.slice(0, MAX_SHOWN - 1) + '…';
  return `‘${s}’`;
}
const qt = quoteTerm;
const qs = (s: string) => `‘${s}’`;

export class TypeChecker {
  readonly unifier = new Unifier();
  private errors = 0;
  private pending: [Term, ZType][] = [];

  constructor(private readonly opts: CheckerOptions) {}

  /** Number of errors reported so far. */
  get errorCount(): number {
    return this.errors;
  }

  /** Check a predicate (a line below the schema line). Returns true if it is well-typed. */
  checkPredicate(t: Term, scope: Scope): boolean {
    const before = this.errors;
    this.pred(t, scope);
    this.flush();
    return this.errors === before;
  }

  /** Check an expression and return its (resolved) type; ERROR if ill-typed. */
  checkExpression(t: Term, scope: Scope): ZType {
    const ty = this.value(t, scope);
    this.flush();
    return this.unifier.resolve(ty);
  }

  /**
   * Check the set in a declaration `x : S` and return the type of `x` (the element
   * type of S), or ERROR.
   */
  checkDeclaredSet(t: Term, scope: Scope, sep: ':' | '∈' = ':'): ZType {
    const el = this.declaredSet(t, scope, sep);
    this.flush();
    return this.unifier.resolve(el);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private flush(): void {
    const tt = this.opts.termTypes;
    if (tt) for (const [t, ty] of this.pending) tt.set(t, this.unifier.resolve(ty));
    this.pending = [];
  }

  private error(at: Term | Span, message: string, kind: 'type' | 'scope' = 'type'): void {
    this.errors++;
    const sp = 'kind' in at ? at.span : at;
    this.opts.report?.({ section: this.opts.section, from: sp.from, to: sp.to, severity: 'error', kind, message });
  }

  private show(ty: ZType): string {
    return describeType(this.unifier.resolve(ty));
  }
  private isErr(ty: ZType): boolean {
    return this.unifier.walk(ty).k === 'error';
  }
  private unify(a: ZType, b: ZType): boolean {
    return this.unifier.unify(a, b);
  }
  private canUnify(a: ZType, b: ZType): boolean {
    return this.unifier.canUnify(a, b);
  }

  /** The numeric type, flagged as ℝ if any of `tys` is (cosmetic, see types.ts). */
  private numberType(...tys: ZType[]): ZType {
    return tys.some((t) => {
      const w = this.unifier.walk(t);
      return w.k === 'int' && w.real;
    })
      ? REAL
      : INT;
  }

  /** If `ty` is (or can become) a set type, return its element type. */
  private asSet(ty: ZType): ZType | null {
    const w = this.unifier.walk(ty);
    if (w.k === 'error') return ERROR;
    if (w.k === 'power') return w.elem;
    if (w.k === 'var') {
      const e = this.unifier.fresh();
      this.unify(w, power(e));
      return e;
    }
    return null;
  }

  /** If `ty` is (or can become) ℙ (X × Y), return [X, Y]. */
  private asRel(ty: ZType): [ZType, ZType] | null {
    const e = this.asSet(ty);
    if (!e) return null;
    const w = this.unifier.walk(e);
    if (w.k === 'error') return [ERROR, ERROR];
    if (w.k === 'product' && w.elems.length === 2) return [w.elems[0], w.elems[1]];
    if (w.k === 'var') {
      const a = this.unifier.fresh();
      const b = this.unifier.fresh();
      this.unify(w, pair(a, b));
      return [a, b];
    }
    return null;
  }

  private infer(t: Term, scope: Scope): ZType {
    const ty = this.inferRaw(t, scope);
    this.pending.push([t, ty]);
    return ty;
  }

  /** Check a term in a value position. */
  private value(t: Term, scope: Scope): ZType {
    const ty = this.infer(t, scope);
    if (this.unifier.walk(ty).k === 'bool') {
      this.error(t, `${qt(t)} is a predicate (true or false), not a value.`);
      return ERROR;
    }
    return ty;
  }

  /** Check a term in a predicate position. */
  private pred(t: Term, scope: Scope): void {
    const ty = this.infer(t, scope);
    const w = this.unifier.walk(ty);
    if (w.k !== 'bool' && w.k !== 'error') {
      this.error(
        t,
        `${qt(t)} is a value (${this.show(ty)}), not a predicate — compare it with something, e.g. ‘… = …’ or ‘… ∈ …’.`,
      );
    }
  }

  private declaredSet(t: Term, scope: Scope, sep: ':' | '∈'): ZType {
    const ty = this.value(t, scope);
    const el = this.asSet(ty);
    if (!el) {
      this.error(t, `After ${qs(sep)} comes a set (a type like NAME or ℙ NAME), but ${qt(t)} is ${this.show(ty)}.`);
      return ERROR;
    }
    return el;
  }

  /** Bind the variables of `x : S; y : T` (sequentially: T may mention x). */
  private bindDecls(decls: VarDecl[], scope: Scope): Scope {
    const inner = new Map(scope);
    const seen = new Set<string>();
    for (const d of decls) {
      const el = this.declaredSet(d.type, inner, d.sep ?? ':');
      for (const n of d.names) {
        if (seen.has(n.name)) this.error(n.span, `${qs(n.name)} is declared twice.`, 'scope');
        seen.add(n.name);
        inner.set(n.name, { type: el, kind: 'bound' });
      }
    }
    return inner;
  }

  private inferRaw(t: Term, scope: Scope): ZType {
    switch (t.kind) {
      case 'name': {
        const b = scope.get(t.name);
        if (!b) {
          this.error(t, this.opts.unknownName?.(t, scope) ?? `Unknown name ${qs(t.name)}.`, 'scope');
          return ERROR;
        }
        return b.type;
      }
      case 'num':
        return Number.isInteger(t.value) ? INT : REAL;
      case 'bool':
        return BOOL;
      case 'builtinSet':
        return power(t.set === 'ℝ' ? REAL : INT);
      case 'emptyset':
        return power(this.unifier.fresh());
      case 'setDisplay': {
        const el = this.unifier.fresh();
        let first: [Term, ZType] | null = null;
        for (const e of t.elems) {
          const ty = this.value(e, scope);
          if (this.isErr(ty)) continue;
          if (!this.unify(el, ty)) {
            const [ft, fty] = first ?? [e, ty];
            this.error(
              e,
              `All elements of a set must have the same type, but ${qt(ft)} is ${this.show(fty)} and ${qt(e)} is ${this.show(ty)}.`,
            );
          } else if (!first) first = [e, ty];
        }
        return power(el);
      }
      case 'setComp': {
        const inner = this.bindDecls(t.decls, scope);
        if (t.pred) this.pred(t.pred, inner);
        if (t.expr) return power(this.value(t.expr, inner));
        const vars = t.decls.flatMap((d) => d.names.map((n) => inner.get(n.name)!.type));
        return power(vars.length === 1 ? vars[0] : product(vars));
      }
      case 'tuple':
        return product(t.elems.map((e) => this.value(e, scope)));
      case 'cross': {
        const parts = t.elems.map((e) => {
          const ty = this.value(e, scope);
          const el = this.asSet(ty);
          if (!el) {
            this.error(e, `‘×’ needs sets on both sides (like NAME × DATE), but ${qt(e)} is ${this.show(ty)}.`);
            return ERROR;
          }
          return el;
        });
        return power(product(parts));
      }
      case 'apply':
        return this.inferApply(t, scope);
      case 'unop':
        return this.inferUnop(t, scope);
      case 'binop':
        return this.inferBinop(t, scope);
      case 'rel':
        this.inferRel(t, scope);
        return BOOL;
      case 'not':
        this.pred(t.arg, scope);
        return BOOL;
      case 'logic':
        this.pred(t.left, scope);
        this.pred(t.right, scope);
        return BOOL;
      case 'quant': {
        const inner = this.bindDecls(t.decls, scope);
        if (t.pred) this.pred(t.pred, inner);
        this.pred(t.body, inner);
        return BOOL;
      }
    }
  }

  private inferApply(t: Extract<Term, { kind: 'apply' }>, scope: Scope): ZType {
    const fty = this.value(t.fn, scope);
    const aty = this.value(t.arg, scope);
    if (this.isErr(fty)) return ERROR;
    const rel = this.asRel(fty);
    if (!rel) {
      this.error(t, `${qt(t.fn)} is ${this.show(fty)}, not a function, so it cannot be applied to ${qt(t.arg)}.`);
      return ERROR;
    }
    if (!this.isErr(aty) && !this.unify(rel[0], aty)) {
      this.error(t.arg, `${qt(t.fn)} expects ${this.show(rel[0])} as argument, but ${qt(t.arg)} is ${this.show(aty)}.`);
    }
    return rel[1];
  }

  private inferUnop(t: Extract<Term, { kind: 'unop' }>, scope: Scope): ZType {
    const ty = this.value(t.arg, scope);
    if (t.op === 'neg') {
      if (!this.unify(ty, INT)) this.error(t, `‘-’ needs a number, but ${qt(t.arg)} is ${this.show(ty)}.`);
      return this.numberType(ty);
    }
    if (this.isErr(ty)) return t.op === '#' ? INT : ERROR;
    switch (t.op) {
      case 'dom':
      case 'ran': {
        const rel = this.asRel(ty);
        if (!rel) {
          this.error(t, `${t.op} needs a relation (a set of pairs), but ${qt(t.arg)} is ${this.show(ty)}.`);
          return ERROR;
        }
        return power(t.op === 'dom' ? rel[0] : rel[1]);
      }
      case 'ℙ':
        if (!this.asSet(ty)) {
          this.error(t, `ℙ needs a set, but ${qt(t.arg)} is ${this.show(ty)}.`);
          return ERROR;
        }
        return power(ty);
      case '#':
        if (!this.asSet(ty)) this.error(t, `# counts the elements of a set, but ${qt(t.arg)} is ${this.show(ty)}.`);
        return INT;
    }
  }

  private inferBinop(t: Extract<Term, { kind: 'binop' }>, scope: Scope): ZType {
    const { op, left: l, right: r } = t;
    const lt = this.value(l, scope);
    const rt = this.value(r, scope);
    switch (op) {
      case '↦':
        return pair(lt, rt);
      case '↔':
      case '⇸':
      case '→': {
        const ls = this.asSet(lt);
        const rs = this.asSet(rt);
        if (!ls) this.error(l, `${qs(op)} needs a set on its left (like NAME), but ${qt(l)} is ${this.show(lt)}.`);
        if (!rs) this.error(r, `${qs(op)} needs a set on its right (like DATE), but ${qt(r)} is ${this.show(rt)}.`);
        return power(power(pair(ls ?? ERROR, rs ?? ERROR)));
      }
      case '+':
      case '-':
      case '*':
      case 'div':
      case 'mod':
      case '..':
        for (const [side, ty] of [[l, lt], [r, rt]] as [Term, ZType][]) {
          if (!this.unify(ty, INT)) this.error(side, `${qs(op)} needs numbers, but ${qt(side)} is ${this.show(ty)}.`);
        }
        // `div`, `mod` and `a .. b` are about whole numbers; + - * keep ℝ for messages
        if (op === '..') return power(INT);
        if (op === 'div' || op === 'mod') return INT;
        return this.numberType(lt, rt);
      case '∪':
      case '∩':
      case '∖':
        return this.setOp(t, lt, rt);
    }
  }

  private setOp(t: Extract<Term, { kind: 'binop' }>, lt: ZType, rt: ZType): ZType {
    const { op, left: l, right: r } = t;
    if (this.isErr(lt) || this.isErr(rt)) return this.isErr(lt) ? rt : lt;
    const ls = this.asSet(lt);
    const rs = this.asSet(rt);
    if (!ls || !rs) {
      const [bad, badTy, otherTy] = !ls ? [l, lt, rt] : [r, rt, lt];
      const hint = this.canUnify(power(badTy), otherTy) ? ` Did you mean ‘{${printTerm(bad)}}’?` : '';
      this.error(bad, `${qs(op)} needs a set on both sides, but ${qt(bad)} is ${this.show(badTy)}.${hint}`);
      return ERROR;
    }
    if (!this.unify(ls, rs)) {
      this.error(t, `${qs(op)} needs two sets of the same type, but ${qt(l)} is ${this.show(lt)} and ${qt(r)} is ${this.show(rt)}.`);
      return ERROR;
    }
    return lt;
  }

  private inferRel(t: Extract<Term, { kind: 'rel' }>, scope: Scope): void {
    const { op, left: l, right: r } = t;
    const lt = this.value(l, scope);
    const rt = this.value(r, scope);
    // (`error` operands unify with everything, so no follow-up messages appear.)
    switch (op) {
      case '=':
      case '≠': {
        if (this.unify(lt, rt)) return;
        let hint = '';
        if (this.canUnify(power(lt), rt)) hint = ` Did you mean ‘${printTerm(l)} ${op === '=' ? '∈' : '∉'} ${printTerm(r)}’?`;
        else if (this.canUnify(lt, power(rt))) hint = ` Did you mean ‘{${printTerm(r)}}’?`;
        this.error(
          t,
          `Both sides of ${qs(op)} must have the same type, but ${qt(l)} is ${this.show(lt)} and ${qt(r)} is ${this.show(rt)}.${hint}`,
        );
        return;
      }
      case '∈':
      case '∉': {
        const rs = this.asSet(rt);
        if (!rs) {
          const hint = this.canUnify(lt, rt) ? ` Did you mean ‘${op === '∈' ? '=' : '≠'}’?` : '';
          this.error(r, `${qs(op)} needs a set on its right, but ${qt(r)} is ${this.show(rt)}.${hint}`);
          return;
        }
        if (this.unify(lt, rs)) return;
        const parts = relationParts(this.unifier.resolve(rt));
        let msg = `${qt(l)} is ${this.show(lt)}, but ${qt(r)} is ${this.show(rt)}`;
        let hint = '';
        if (parts) {
          msg += ' (its elements are pairs)';
          const dom = { kind: 'unop', op: 'dom', arg: r, span: r.span } as Term;
          const ran = { kind: 'unop', op: 'ran', arg: r, span: r.span } as Term;
          if (this.canUnify(lt, parts[0])) hint = ` Did you mean ‘${printTerm(l)} ${op} ${printTerm(dom)}’?`;
          else if (this.canUnify(lt, parts[1])) hint = ` Did you mean ‘${printTerm(l)} ${op} ${printTerm(ran)}’?`;
        }
        if (!hint && op === '∈' && this.canUnify(lt, rt)) hint = ' Did you mean ‘⊆’?';
        this.error(t, `${msg}.${hint}`);
        return;
      }
      case '⊆':
      case '⊂': {
        const ls = this.asSet(lt);
        const rs = this.asSet(rt);
        if (!ls) {
          const hint = this.canUnify(power(lt), rt) ? ' Did you mean ‘∈’?' : '';
          this.error(l, `${qs(op)} compares two sets, but ${qt(l)} is ${this.show(lt)}.${hint}`);
        } else if (!rs) {
          this.error(r, `${qs(op)} compares two sets, but ${qt(r)} is ${this.show(rt)}.`);
        } else if (!this.unify(ls, rs)) {
          this.error(t, `${qs(op)} needs two sets of the same type, but ${qt(l)} is ${this.show(lt)} and ${qt(r)} is ${this.show(rt)}.`);
        }
        return;
      }
      case '<':
      case '≤':
      case '>':
      case '≥':
        for (const [side, ty] of [[l, lt], [r, rt]] as [Term, ZType][]) {
          if (!this.unify(ty, INT)) this.error(side, `${qs(op)} compares numbers, but ${qt(side)} is ${this.show(ty)}.`);
        }
        return;
    }
  }
}
