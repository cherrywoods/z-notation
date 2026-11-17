// Z types (Spivey style, without generics): given sets, ℤ, power sets and products.
// Predicates get the pseudo-type `bool`. Unification variables stand for unknown
// element types (∅, `{}`); `error` silently unifies with everything so that one
// mistake does not cause a cascade of follow-up messages.


export type ZType =
  | { k: 'given'; name: string }
  | { k: 'int' }
  | { k: 'bool' }
  | { k: 'power'; elem: ZType }
  | { k: 'product'; elems: ZType[] }
  | { k: 'var'; id: number }
  | { k: 'error' };

export const INT: ZType = { k: 'int' };
export const BOOL: ZType = { k: 'bool' };
export const ERROR: ZType = { k: 'error' };
export const given = (name: string): ZType => ({ k: 'given', name });
export const power = (elem: ZType): ZType => ({ k: 'power', elem });
export const product = (elems: ZType[]): ZType => ({ k: 'product', elems });
export const pair = (a: ZType, b: ZType): ZType => product([a, b]);
/** ℙ (X × Y): the type of relations and functions from X to Y. */
export const relation = (a: ZType, b: ZType): ZType => power(pair(a, b));

/** Structural equality (variables compared by id). */
export function typeEquals(a: ZType, b: ZType): boolean {
  if (a.k !== b.k) return false;
  switch (a.k) {
    case 'given':
      return a.name === (b as typeof a).name;
    case 'power':
      return typeEquals(a.elem, (b as typeof a).elem);
    case 'product': {
      const bb = b as typeof a;
      return a.elems.length === bb.elems.length && a.elems.every((e, i) => typeEquals(e, bb.elems[i]));
    }
    case 'var':
      return a.id === (b as typeof a).id;
    default:
      return true;
  }
}

/** Does the type contain unification variables or errors? */
export function isGround(t: ZType): boolean {
  switch (t.k) {
    case 'var':
    case 'error':
      return false;
    case 'power':
      return isGround(t.elem);
    case 'product':
      return t.elems.every(isGround);
    default:
      return true;
  }
}

/** If `t` is ℙ (X × Y), return [X, Y]. */
export function relationParts(t: ZType): [ZType, ZType] | null {
  return t.k === 'power' && t.elem.k === 'product' && t.elem.elems.length === 2 ? [t.elem.elems[0], t.elem.elems[1]] : null;
}

/**
 * Z notation for a type: `NAME`, `ℤ`, `ℙ NAME`, `NAME × DATE`, `ℙ (NAME × DATE)`.
 * With `relations: true`, ℙ (X × Y) is shown as `X ↔ Y` (friendlier in messages).
 */
export function typeToString(t: ZType, opts: { relations?: boolean } = {}): string {
  return tstr(t, 0, !!opts.relations);
}

// precedence levels: 1 ↔ (right-assoc), 2 ×, 3 ℙ, 4 atoms
function tstr(t: ZType, min: number, rel: boolean): string {
  const wrap = (p: number, s: string) => (p < min ? `(${s})` : s);
  switch (t.k) {
    case 'given':
      return t.name;
    case 'int':
      return 'ℤ';
    case 'bool':
      return 'predicate';
    case 'var':
      return '?';
    case 'error':
      return '?';
    case 'product':
      return wrap(2, t.elems.map((e) => tstr(e, 3, rel)).join(' × '));
    case 'power': {
      const parts = relationParts(t);
      if (rel && parts) return wrap(1, `${tstr(parts[0], 2, rel)} ↔ ${tstr(parts[1], 1, rel)}`);
      return wrap(3, `ℙ ${tstr(t.elem, 3, rel)}`);
    }
  }
}

function article(word: string): string {
  // "an ACCOUNT", "an ITEM", but "a UNIT", "a USER" (U sounds like "you")
  return /^[AEIOaeio]/.test(word) ? 'an' : 'a';
}

/**
 * Plain-words description for student messages, e.g.
 * "a NAME", "a number", "a set of NAME", "a relation NAME ↔ DATE", "a pair NAME ↦ DATE".
 * Pass a resolved type (no bound variables).
 */
export function describeType(t: ZType): string {
  const z = (x: ZType) => typeToString(x, { relations: true });
  switch (t.k) {
    case 'given':
      return `${article(t.name)} ${t.name}`;
    case 'int':
      return 'a number';
    case 'bool':
      return 'a predicate (true or false)';
    case 'var':
    case 'error':
      return 'a value of unknown type';
    case 'product':
      if (t.elems.length === 2) return `a pair ${z(t.elems[0])} ↦ ${z(t.elems[1])}`;
      return `a tuple ${z(t)}`;
    case 'power': {
      const parts = relationParts(t);
      if (parts) return `a relation ${z(t)}`;
      if (t.elem.k === 'int') return 'a set of numbers';
      if (t.elem.k === 'var' || t.elem.k === 'error') return 'a set';
      return `a set of ${z(t.elem)}`;
    }
  }
}
