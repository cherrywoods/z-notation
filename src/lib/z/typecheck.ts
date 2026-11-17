// Type checker for terms and predicates. Scope rules of the schemas themselves (what
// Δ/Ξ import, which names may be declared where) live in index.ts; this module
// checks one term against a given scope and explains type errors in student terms.

import type { Span, Term, VarDecl } from './ast';
import type { SectionRef, ZDiagnostic } from '../spec/model';
import { isBangEquals, parseTerm } from './parser';
import { freeVars, printTerm } from './print';
import {
  BOOL,
  ERROR,
  INT,
  describeType,
  isGround,
  pair,
  power,
  product,
  relationParts,
  typeToString,
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

/**
 * Ids of type variables, shared by all unifiers: a type that leaves one checker (the
 * type of a declared variable) must not be confused with another checker's variables.
 */
let nextVarId = 0;

export class Unifier {
  private subst = new Map<number, ZType>();

  fresh(): ZType {
    return { k: 'var', id: nextVarId++ };
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

/** Does the type still contain an unknown part (from ∅ or `{}`)? */
function hasVar(t: ZType): boolean {
  if (t.k === 'var') return true;
  if (t.k === 'power') return hasVar(t.elem);
  if (t.k === 'product') return t.elems.some(hasVar);
  return false;
}

export class TypeChecker {
  readonly unifier = new Unifier();
  private errors = 0;
  /** > 0 while checking a term whose operands already had errors (see `quietIf`). */
  private muted = 0;
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
    const before = this.errors;
    const el = this.unifier.resolve(this.declaredSet(t, scope, sep));
    this.flush();
    // `x : ∅`, `x : ℙ ∅`: no type (and for ∅ no value) for x
    if (hasVar(el)) {
      if (this.errors === before) {
        const empty = t.kind === 'emptyset' || (t.kind === 'setDisplay' && t.elems.length === 0);
        this.error(
          t,
          empty
            ? `${qt(t)} is the empty set, so this variable could never have a value. After ${qs(sep)} comes a type like NAME or ℙ NAME.`
            : `${qt(t)} does not tell the type (∅ could be a set of anything). After ${qs(sep)} comes a type like NAME or ℙ NAME.`,
        );
      }
      return ERROR;
    }
    return el;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private flush(): void {
    const tt = this.opts.termTypes;
    if (tt) for (const [t, ty] of this.pending) tt.set(t, this.unifier.resolve(ty));
    this.pending = [];
  }

  private error(at: Term | Span, message: string, kind: 'type' | 'scope' | 'syntax' = 'type'): void {
    if (this.muted) return;
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

  /** Check an operand in a value position; `bad` if errors were reported inside it. */
  private operand(t: Term, scope: Scope): [ty: ZType, bad: boolean] {
    const before = this.errors;
    const ty = this.value(t, scope);
    return [ty, this.errors > before || this.isErr(ty)];
  }

  /**
   * Run the checks of a construct, without messages if one of its operands already had
   * an error: a mismatch with an erroneous operand would only repeat that error.
   */
  private quietIf<T>(quiet: boolean, check: () => T): T {
    if (quiet) this.muted++;
    try {
      return check();
    } finally {
      if (quiet) this.muted--;
    }
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
    const [ty, bad] = this.operand(t, scope);
    const el = this.asSet(ty);
    if (!el) {
      if (!bad) this.error(t, `After ${qs(sep)} comes a set (a type like NAME or ℙ NAME), but ${qt(t)} is ${this.show(ty)}.`);
      return ERROR;
    }
    return el;
  }

  /** Bind the variables of `x ∈ S; y ∈ T` (sequentially: T may mention x). */
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
        return INT;
      case 'bool':
        return BOOL;
      case 'builtinSet':
        return power(INT);
      case 'emptyset':
        return power(this.unifier.fresh());
      case 'setDisplay': {
        const el = this.unifier.fresh();
        let first: [Term, ZType] | null = null;
        let anyBad = false;
        for (const e of t.elems) {
          const [ty, bad] = this.operand(e, scope);
          if (bad) {
            anyBad = true;
            continue;
          }
          if (!this.unify(el, ty)) {
            const [ft, fty] = first ?? [e, ty];
            this.error(
              e,
              `All elements of a set must have the same type, but ${qt(ft)} is ${this.show(fty)} and ${qt(e)} is ${this.show(ty)}.`,
            );
          } else if (!first) first = [e, ty];
        }
        // with an erroneous element, the element type is not known (`{Dune, 1}` with Dune unknown)
        return power(anyBad ? ERROR : el);
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
          const [ty, bad] = this.operand(e, scope);
          const el = this.asSet(ty);
          if (!el) {
            if (!bad) this.error(e, `‘×’ needs sets on both sides (like NAME × DATE), but ${qt(e)} is ${this.show(ty)}.`);
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
    const [fty, fBad] = this.operand(t.fn, scope);
    const [aty, aBad] = this.operand(t.arg, scope);
    if (this.isErr(fty)) return ERROR;
    const rel = this.asRel(fty);
    if (!rel) {
      if (!fBad) this.error(t, `${qt(t.fn)} is ${this.show(fty)}, not a function, so it cannot be applied to ${qt(t.arg)}.`);
      return ERROR;
    }
    if (!this.unify(rel[0], aty) && !fBad && !aBad) {
      this.error(t.arg, `${qt(t.fn)} expects ${this.show(rel[0])} as argument, but ${qt(t.arg)} is ${this.show(aty)}.`);
    }
    return rel[1];
  }

  private inferUnop(t: Extract<Term, { kind: 'unop' }>, scope: Scope): ZType {
    const [ty, bad] = this.operand(t.arg, scope);
    return this.quietIf(bad, () => this.unop(t, ty));
  }

  private unop(t: Extract<Term, { kind: 'unop' }>, ty: ZType): ZType {
    if (t.op === 'neg') {
      if (!this.unify(ty, INT)) this.error(t, `‘-’ needs a number, but ${qt(t.arg)} is ${this.show(ty)}.`);
      return INT;
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
    const [lt, lBad] = this.operand(t.left, scope);
    const [rt, rBad] = this.operand(t.right, scope);
    return this.quietIf(lBad || rBad, () => this.binop(t, lt, rt, lBad, rBad));
  }

  private binop(t: Extract<Term, { kind: 'binop' }>, lt: ZType, rt: ZType, lBad: boolean, rBad: boolean): ZType {
    const { op, left: l, right: r } = t;
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
        return op === '..' ? power(INT) : INT;
      case '∪':
      case '∩':
      case '∖':
        // with an erroneous operand, the type comes from the other one
        if (lBad || rBad) return lBad && rBad ? ERROR : lBad ? rt : lt;
        return this.setOp(t, lt, rt);
    }
  }

  private setOp(t: Extract<Term, { kind: 'binop' }>, lt: ZType, rt: ZType): ZType {
    const { op, left: l, right: r } = t;
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
    const l = t.left;
    let rel = t;
    // `a!=b` where there is no output a! (but there is an a): meant as a ≠ b
    if (isBangEquals(t) && l.kind === 'name' && !scope.has(l.name) && scope.has(l.base)) {
      this.error(
        { from: l.span.to - 1, to: l.span.to + 1 },
        `Write ‘≠’ (or ‘/=’) for “not equal”: ‘${l.base} ≠ ${printTerm(t.right)}’.`,
        'syntax',
      );
      const base: Term = { kind: 'name', name: l.base, base: l.base, decoration: '', span: { from: l.span.from, to: l.span.to - 1 } };
      rel = { ...t, op: '≠', left: base };
    }
    const [lt, lBad] = this.operand(rel.left, scope);
    const [rt, rBad] = this.operand(rel.right, scope);
    this.quietIf(lBad || rBad || rel !== t, () => this.rel(rel, lt, rt));
  }

  private rel(t: Extract<Term, { kind: 'rel' }>, lt: ZType, rt: ZType): void {
    const { op, left: l, right: r } = t;
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

// ── declarations that use variables ────────────────────────────────────────────

/**
 * A declaration whose set uses variables, like `t? : dom at` or `allergic : patients ↔ DRUG`,
 * is valid Z, but the tutorial declares types only and states the rest as predicates.
 * For such a declaration this returns a message that spells out the rewrite
 * (`t? : TRAIN` and `t? ∈ dom at`), and the type of the declared variable. `scope` holds
 * the given sets and the variables (kind 'var'). Returns null if the set uses no
 * variables or the rewrite cannot be worked out (then the usual checks report it).
 */
export function typeOnlyRewrite(decl: VarDecl, scope: Scope): { message: string; type: ZType } | null {
  const set = decl.type;
  const isVar = (n: string) => scope.get(n)?.kind === 'var';
  const varsIn = (t: Term) => [...freeVars(t)].filter(isVar);
  const used = varsIn(set);
  if (!used.length) return null;
  const tc = new TypeChecker({ section: { schemaId: '', part: 'decls' } });
  /** The type of the elements of set `t`, if `t` is a well-typed set. */
  const elemOf = (t: Term): ZType | null => {
    const ty = tc.checkExpression(t, scope);
    return tc.errorCount === 0 && ty.k === 'power' && isGround(ty.elem) ? ty.elem : null;
  };
  /** A term for a type, e.g. `PATIENT ↔ DRUG`. */
  const typeTerm = (ty: ZType): Term => parseTerm(typeToString(ty, { relations: true })).term!;
  const rel = (op: '∈' | '⊆' | '=', left: Term, right: Term): Term => ({ kind: 'rel', op, left, right, span: right.span });

  const el = elemOf(set);
  if (!el) return null;
  const x = decl.names[0];
  const xTerm: Term = { kind: 'name', name: x.name, base: x.base, decoration: x.decoration, span: x.span };
  let type: Term;
  const preds: Term[] = [];
  if (set.kind === 'binop' && (set.op === '↔' || set.op === '⇸' || set.op === '→')) {
    // `allergic : patients ↔ DRUG`: the type PATIENT ↔ DRUG, plus dom/ran conditions
    const [l, r] = [set.left, set.right];
    const lv = varsIn(l).length > 0;
    const rv = varsIn(r).length > 0;
    const le = lv ? elemOf(l) : null;
    const re = rv ? elemOf(r) : null;
    if ((lv && !le) || (rv && !re)) return null;
    // a total function on a variable set: a partial function whose domain is that set
    const op = set.op === '→' && lv ? '⇸' : set.op;
    type = { kind: 'binop', op, left: le ? typeTerm(le) : l, right: re ? typeTerm(re) : r, span: set.span };
    const dom: Term = { kind: 'unop', op: 'dom', arg: xTerm, span: x.span };
    const ran: Term = { kind: 'unop', op: 'ran', arg: xTerm, span: x.span };
    if (lv) preds.push(rel(set.op === '→' ? '=' : '⊆', dom, l));
    if (rv) preds.push(rel('⊆', ran, r));
  } else if (set.kind === 'unop' && set.op === 'ℙ' && elemOf(set.arg)) {
    // `s : ℙ patients`: s : ℙ PATIENT and s ⊆ patients
    type = typeTerm(el);
    preds.push(rel('⊆', xTerm, set.arg));
  } else {
    // `t? : dom at`: t? : TRAIN and t? ∈ dom at
    type = typeTerm(el);
    preds.push(rel('∈', xTerm, set));
  }
  const names = used.map(qs);
  const which =
    names.length === 1 ? `${names[0]} is a variable, not a type.` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are variables, not types.`;
  const shown = preds.map((p) => qs(printTerm(p)));
  const add = shown.length === 1 ? `${shown[0]} as a predicate` : `${shown.join(' and ')} as predicates`;
  return {
    message: `${which} Declare ${x.name} with a type, ${qs(`${x.name} : ${printTerm(type)}`)}, and add ${add}.`,
    type: el,
  };
}
