// Explainer content: one card per Z symbol (ids from src/lib/z/symbols.ts) plus a few
// concepts (given sets, schema boxes, state/init/operation schemas).
//
// Text conventions (rendered by src/ui/explain/ExplainerCard.svelte):
//  * `short` and `notes` are plain words; Z snippets go between backticks: 'the set `ℙ X`'.
//  * `definition` / `example` are Z text (unicode), one line per line.
// Terminology follows the lecture slides: Δ/Ξ are a "structured import",
// x? is an input, x! an output, x′ the value after the operation.

import { SYMBOL_BY_ID, type SymbolCategory } from '../z/symbols';

export interface ExplainerContext {
  /** Name of the current state schema, e.g. 'Library' (for Δ/Ξ explainers). */
  stateName?: string;
  /** Undecorated state variable names, e.g. ['onLoan', 'borrower']. */
  stateVars?: string[];
  /**
   * The identifier the explainer was opened on, if any: a decorated name for ′ ? !
   * ('borrower′', 'book?', 'member!'), or a given-set name for 'given' ('BOOK').
   */
  subject?: string;
  /** Given-set names, used to colour Z text inside the card. */
  givenSets?: string[];
}

/** One arrow from a left element to a right element. */
export interface DiagramArrow {
  from: string;
  to: string;
  /** normal (relation colour), added (blue), removed (dashed, faded), bad (violates the rule). */
  kind?: 'normal' | 'added' | 'removed' | 'bad';
}

/** One small "left set → right set" picture. */
export interface DiagramPanel {
  left: string[];
  right: string[];
  leftLabel?: string;
  rightLabel?: string;
  arrows: DiagramArrow[];
  /** Elements drawn inside a highlighted region (dom / ran). */
  highlightLeft?: string[];
  highlightRight?: string[];
  /** Elements to flag as the reason for a 'bad' verdict. */
  badLeft?: string[];
  /** Short caption under the panel (plain words, Z in backticks). */
  caption?: string;
  /** ✓ / ✗ badge in front of the caption. */
  verdict?: 'ok' | 'bad';
}

export interface DiagramSpec {
  panels: DiagramPanel[];
}

/** A small schema box (used for Δ/Ξ definitions and concept examples). */
export interface SchemaSketch {
  name: string;
  decls: string;
  preds?: string;
}

export interface Explainer {
  id: string;
  /** Shown large in the card header (may be empty for concepts). */
  symbol: string;
  title: string;
  /** One line shown on hover, plain words (Z in backticks). */
  short: string;
  /** Z text from sets, unicode (rendered with highlighting). */
  definition?: string;
  /** Definition as a schema box (Δ/Ξ). */
  definitionSchema?: SchemaSketch;
  /** Z text example, ideally from the library example below. */
  example?: string;
  /** Example as a schema box (state / init / operation). */
  exampleSchema?: SchemaSketch;
  /** Optional mini arrow diagram. */
  diagram?: DiagramSpec;
  /** ≤ 2 very short notes (plain words, Z in backticks). */
  notes?: string[];
  /** Colour category of `symbol` (defaults to the symbol table's category). */
  category?: SymbolCategory;
  /** ASCII shortcuts that type this symbol (from the symbol table). */
  ascii?: string[];
}

type Entry = Omit<Explainer, 'id' | 'symbol' | 'category' | 'ascii'> & {
  symbol?: string;
  category?: SymbolCategory;
};

// ── example material: a small library (books on loan) ──────────────────────

const LIB_STATE: SchemaSketch = {
  name: 'Library',
  decls: 'onLoan : ℙ BOOK\nborrower : BOOK ⇸ MEMBER',
  preds: 'onLoan = dom borrower',
};
const LIB_INIT: SchemaSketch = { name: 'InitLibrary', decls: 'Library', preds: 'onLoan = ∅' };
const LIB_LEND: SchemaSketch = {
  name: 'Lend',
  decls: 'ΔLibrary\nbook? : BOOK\nmember? : MEMBER',
  preds: 'book? ∉ onLoan\nborrower′ = borrower ∪ {book? ↦ member?}',
};

const BOOKS = ['Dune', 'Emma', 'Hamlet'];
const MEMBERS = ['Ada', 'Ben', 'Cleo'];
const BASE = { leftLabel: 'BOOK', rightLabel: 'MEMBER', left: BOOKS };

// ── static entries ─────────────────────────────────────────────────────────

const STATIC: Record<string, Entry> = {
  // declarations
  colon: {
    title: 'Declaration',
    short: '`x : S` declares a variable x: x is an element of the set S.',
    example: 'onLoan : ℙ BOOK\nborrower : BOOK ⇸ MEMBER',
    notes: ['S is the type of x: it fixes which values x can have.'],
  },

  // types & sets
  power: {
    title: 'Power set',
    short: '`ℙ X` is the set of all subsets of X.',
    definition: 'S ∈ ℙ X ⇔ S ⊆ X',
    example: 'onLoan : ℙ BOOK\nℙ {Dune, Emma} = {∅, {Dune}, {Emma}, {Dune, Emma}}',
    notes: ['`onLoan : ℙ BOOK` — onLoan is a set of books.'],
  },
  nat: {
    title: 'Natural numbers',
    short: 'The whole numbers 0, 1, 2, … (never negative).',
    definition: 'ℕ == {0, 1, 2, 3, …}',
    example: '#onLoan ∈ ℕ',
  },
  nat1: {
    title: 'Positive natural numbers',
    short: 'The whole numbers 1, 2, 3, … (without 0).',
    definition: 'ℕ₁ == ℕ ∖ {0}',
    example: '1 ∈ ℕ₁\n0 ∉ ℕ₁',
  },
  int: {
    title: 'Integers',
    short: 'All whole numbers, including negative ones.',
    definition: 'ℤ == {…, −2, −1, 0, 1, 2, …}',
    example: 'balance : ℤ',
  },
  real: {
    title: 'Real numbers',
    short: 'All numbers, including decimals like 36.5 or −0.25.',
    example: 'temperature : SENSOR ⇸ ℝ\n2.5 ∈ ℝ\n2.5 ∉ ℤ',
    notes: ['Examples show a few short decimals. Write them with a point: 0.25, not 0,25.'],
  },
  cross: {
    title: 'Cartesian product',
    short: '`X × Y` is the set of all pairs (x, y) with x ∈ X and y ∈ Y.',
    definition: 'X × Y == { x : X; y : Y • (x, y) }',
    example: '(Dune, Ada) ∈ BOOK × MEMBER',
    notes: ['`x ↦ y` is another way to write the pair (x, y).'],
  },

  // relations & functions
  rel: {
    title: 'Relation',
    short: '`X ↔ Y` is a set of pairs. An element may be related to no, one or many elements.',
    definition: 'X ↔ Y == ℙ(X × Y)',
    example: 'reserved : BOOK ↔ MEMBER\nreserved = {Dune ↦ Ada,\n  Dune ↦ Cleo, Emma ↦ Ben}',
    diagram: {
      panels: [
        {
          ...BASE,
          right: ['Ada', 'Cleo', 'Ben'],
          arrows: [
            { from: 'Dune', to: 'Ada' },
            { from: 'Dune', to: 'Cleo' },
            { from: 'Emma', to: 'Ben' },
          ],
          caption: 'Dune: two arrows, Hamlet: none — both fine',
          verdict: 'ok',
        },
      ],
    },
    notes: ['Every function is a relation — but not every relation is a function.'],
  },
  pfun: {
    title: 'Partial function',
    short: '`X ⇸ Y` relates each x to at most one y. Some x may have none.',
    definition:
      'X ⇸ Y == { f : X ↔ Y |\n    ∀ x : X; y₁, y₂ : Y •\n      (x ↦ y₁) ∈ f ∧ (x ↦ y₂) ∈ f ⇒ y₁ = y₂ }',
    example: 'borrower : BOOK ⇸ MEMBER\nborrower = {Dune ↦ Ada, Emma ↦ Ben}',
    diagram: {
      panels: [
        {
          ...BASE,
          right: MEMBERS,
          arrows: [
            { from: 'Dune', to: 'Ada' },
            { from: 'Emma', to: 'Ben' },
          ],
          caption: 'at most one arrow per book',
          verdict: 'ok',
        },
        {
          ...BASE,
          right: MEMBERS,
          arrows: [
            { from: 'Dune', to: 'Ada' },
            { from: 'Dune', to: 'Cleo', kind: 'bad' },
            { from: 'Emma', to: 'Ben' },
          ],
          badLeft: ['Dune'],
          caption: 'Dune: two arrows',
          verdict: 'bad',
        },
      ],
    },
    notes: ['Not every book needs a borrower: `dom borrower` can be smaller than BOOK.'],
  },
  tfun: {
    title: 'Total function',
    short: '`X → Y` relates every x ∈ X to exactly one y.',
    definition: 'X → Y == { f : X ⇸ Y | dom f = X }',
    example: 'pages : BOOK → ℕ',
    diagram: {
      panels: [
        {
          ...BASE,
          right: MEMBERS,
          arrows: [
            { from: 'Dune', to: 'Ada' },
            { from: 'Emma', to: 'Ben' },
            { from: 'Hamlet', to: 'Ada' },
          ],
          caption: 'exactly one arrow per book',
          verdict: 'ok',
        },
        {
          ...BASE,
          right: MEMBERS,
          arrows: [
            { from: 'Dune', to: 'Ada' },
            { from: 'Emma', to: 'Ben' },
          ],
          badLeft: ['Hamlet'],
          caption: 'Hamlet: no arrow',
          verdict: 'bad',
        },
      ],
    },
    notes: ['`borrower : BOOK → MEMBER` would mean that every book is on loan — so the library uses ⇸.'],
  },
  maplet: {
    title: 'Maplet',
    short: '`x ↦ y` is the pair (x, y): “x maps to y”.',
    definition: 'x ↦ y == (x, y)',
    example: 'borrower = {Dune ↦ Ada, Emma ↦ Ben}\n(Dune ↦ Ada) ∈ borrower',
  },
  dom: {
    title: 'Domain',
    short: '`dom R` is the set of all x that R relates to something — where arrows start.',
    definition: 'dom R == { x : X | ∃ y : Y • (x ↦ y) ∈ R }',
    example: 'dom {Dune ↦ Ada, Emma ↦ Ben}\n  = {Dune, Emma}',
    diagram: {
      panels: [
        {
          ...BASE,
          right: MEMBERS,
          arrows: [
            { from: 'Dune', to: 'Ada' },
            { from: 'Emma', to: 'Ben' },
          ],
          highlightLeft: ['Dune', 'Emma'],
          caption: '`dom borrower = {Dune, Emma}`',
        },
      ],
    },
    notes: ['`onLoan = dom borrower`: the books on loan are exactly those with a borrower.'],
  },
  ran: {
    title: 'Range',
    short: '`ran R` is the set of all y that something is related to — where arrows end.',
    definition: 'ran R == { y : Y | ∃ x : X • (x ↦ y) ∈ R }',
    example: 'ran {Dune ↦ Ada, Emma ↦ Ben}\n  = {Ada, Ben}',
    diagram: {
      panels: [
        {
          ...BASE,
          right: MEMBERS,
          arrows: [
            { from: 'Dune', to: 'Ada' },
            { from: 'Emma', to: 'Ben' },
          ],
          highlightRight: ['Ada', 'Ben'],
          caption: '`ran borrower = {Ada, Ben}`',
        },
      ],
    },
  },
  apply: {
    symbol: 'f(x)',
    title: 'Function application',
    short: '`f(x)` is the y with `x ↦ y` in f. Only defined if `x ∈ dom f`.',
    definition: 'f(x) = y ⇔ (x ↦ y) ∈ f',
    example: 'borrower(Dune) = Ada\nmember! = borrower(book?)',
    notes: ['That is why FindBorrower requires `book? ∈ onLoan`.', '`f x` (without parentheses) means the same.'],
  },

  // sets
  in: {
    title: 'Element of',
    short: '`x ∈ S`: x is an element of the set S.',
    example: 'book? ∈ onLoan\nDune ∈ {Dune, Emma}',
    notes: ['A declaration `x : S` also says `x ∈ S`.'],
  },
  notin: {
    title: 'Not an element of',
    short: '`x ∉ S`: x is not an element of the set S.',
    definition: 'x ∉ S ⇔ ¬ (x ∈ S)',
    example: 'book? ∉ onLoan',
    notes: ['In Lend: the book must not be on loan already.'],
  },
  subseteq: {
    title: 'Subset',
    short: '`A ⊆ B`: every element of A is also in B.',
    definition: 'A ⊆ B ⇔ (∀ x : A • x ∈ B)',
    example: '{Dune} ⊆ {Dune, Emma}\nonLoan ⊆ onLoan′',
  },
  subset: {
    title: 'Proper subset',
    short: '`A ⊂ B`: A ⊆ B, and B has at least one element more.',
    definition: 'A ⊂ B ⇔ A ⊆ B ∧ A ≠ B',
    example: '{Dune} ⊂ {Dune, Emma}',
  },
  cup: {
    title: 'Union',
    short: '`A ∪ B`: everything that is in A or in B (or both).',
    definition: 'A ∪ B == { x : X | x ∈ A ∨ x ∈ B }',
    example: '{Dune} ∪ {Emma} = {Dune, Emma}\nborrower′ = borrower ∪ {book? ↦ member?}',
    notes: ['A relation is a set of pairs — so ∪ can add pairs, too.'],
  },
  cap: {
    title: 'Intersection',
    short: '`A ∩ B`: everything that is in both A and B.',
    definition: 'A ∩ B == { x : X | x ∈ A ∧ x ∈ B }',
    example: '{Dune, Emma} ∩ {Emma, Hamlet} = {Emma}',
  },
  setminus: {
    title: 'Set difference',
    short: '`A ∖ B`: the elements of A that are not in B.',
    definition: 'A ∖ B == { x : X | x ∈ A ∧ x ∉ B }',
    example: '{Dune, Emma} ∖ {Emma} = {Dune}\nonLoan′ = onLoan ∖ {book?}',
  },
  emptyset: {
    title: 'Empty set',
    short: '`∅` is the set without any elements.',
    definition: '∀ x : X • x ∉ ∅',
    example: 'onLoan = ∅\n#∅ = 0',
    notes: ['InitLibrary: at the start, no book is on loan.'],
  },
  card: {
    title: 'Number of elements',
    short: '`#S` is the number of elements of a finite set S.',
    example: '#{Dune, Emma, Hamlet} = 3\n#∅ = 0',
  },
  setdisplay: {
    symbol: '{ , }',
    title: 'Set display',
    short: '`{a, b, c}` is the set with exactly these elements. Order and repetition do not matter.',
    example: 'onLoan = {Dune, Emma, Hamlet}\n{Dune, Emma} = {Emma, Dune, Emma}',
  },
  setcomp: {
    symbol: '{ | }',
    title: 'Set comprehension',
    short: '`{ x : S | P }` is the set of all x in S for which P holds.',
    definition: '{ x : S | P }\n{ x : S | P • e }',
    example: 'books! = { b ∈ onLoan | borrower(b) = member? }',
    notes: ['`{ x ∈ S | P }` means the same as `{ x : S | P }`.', 'With `• e`, the set collects the values e instead of x.'],
  },

  // logic
  and: {
    title: 'And',
    short: '`P ∧ Q`: both P and Q hold.',
    example: 'book? ∉ onLoan ∧ member? ∈ MEMBER',
    notes: ['The lines of a predicate part are joined by ∧.'],
  },
  or: {
    title: 'Or',
    short: '`P ∨ Q`: at least one of P and Q holds.',
    example: 'x ∈ A ∪ B ⇔ x ∈ A ∨ x ∈ B',
  },
  not: {
    title: 'Not',
    short: '`¬ P`: P does not hold.',
    example: '¬ (book? ∈ onLoan) ⇔ book? ∉ onLoan',
  },
  implies: {
    title: 'Implies',
    short: '`P ⇒ Q`: if P holds, then Q holds, too.',
    definition: '(P ⇒ Q) ⇔ ¬ P ∨ Q',
    example: 'b ∈ onLoan ⇒ b ∈ dom borrower',
    notes: ['If P is false, `P ⇒ Q` is true.'],
  },
  iff: {
    title: 'If and only if',
    short: '`P ⇔ Q`: P and Q are both true or both false.',
    definition: '(P ⇔ Q) ⇔ (P ⇒ Q) ∧ (Q ⇒ P)',
    example: 'b ∈ onLoan ⇔ b ∈ dom borrower',
  },
  forall: {
    title: 'For all',
    short: '`∀ x : S • P`: P holds for every x in S.',
    definition: '(∀ x : S | Q • P) ⇔ (∀ x : S • Q ⇒ P)',
    example: '∀ b : onLoan • b ∈ dom borrower',
  },
  exists: {
    title: 'There exists',
    short: '`∃ x : S • P`: there is at least one x in S for which P holds.',
    definition: '(∃ x : S | Q • P) ⇔ (∃ x : S • Q ∧ P)',
    example: '∃ m : MEMBER • (Dune ↦ m) ∈ borrower',
  },
  spot: {
    title: 'Spot',
    short: '`•` separates the variables of ∀, ∃ or { … } from the rest. Read: “it holds that”.',
    example: '∀ b : onLoan • b ∈ dom borrower',
  },
  eq: {
    title: 'Equals',
    short: '`a = b`: both sides are the same value.',
    example: 'onLoan = dom borrower\nonLoan′ = onLoan',
    notes: ['A predicate states a fact: `=` does not assign.'],
  },
  neq: {
    title: 'Not equal',
    short: '`a ≠ b`: the two sides are different values.',
    definition: 'a ≠ b ⇔ ¬ (a = b)',
    example: 'book? ≠ Dune',
  },
  lt: { title: 'Less than', short: '`a < b`: the number a is smaller than b.', example: '#onLoan < 100' },
  leq: { title: 'Less or equal', short: '`a ≤ b`: a is smaller than or equal to b.', example: '#onLoan ≤ #onLoan′' },
  gt: { title: 'Greater than', short: '`a > b`: the number a is larger than b.', example: '#onLoan′ > #onLoan' },
  geq: { title: 'Greater or equal', short: '`a ≥ b`: a is larger than or equal to b.', example: '#onLoan′ ≥ #onLoan' },

  // used in definitions only
  defeq: {
    symbol: '==',
    category: 'logic',
    title: 'Is defined as',
    short: '`A == B`: A is a name for B. Used in the definitions here.',
  },

  // ── concepts ──
  schema: {
    symbol: '',
    category: 'schema',
    title: 'Schema',
    short: 'A named box: declarations above the line, predicates below. Predicate lines are joined by ∧.',
    exampleSchema: LIB_STATE,
    notes: ['Read it as: these variables, and the conditions they satisfy.'],
  },
  declarations: {
    symbol: ':',
    category: 'schema',
    title: 'Declarations',
    short: 'Above the line: the variables, one per line. `x : S` — x is an element of S.',
    example: 'onLoan : ℙ BOOK\nborrower : BOOK ⇸ MEMBER',
    notes: ['A line like `ΔLibrary` imports the variables of a whole schema.'],
  },
  predicates: {
    symbol: '',
    category: 'logic',
    title: 'Predicates',
    short: 'Below the line: conditions that must hold. Several lines are joined by ∧.',
    example: 'onLoan = dom borrower',
    notes: ['In an operation: conditions on before (x), after (x′), inputs (x?) and outputs (x!).'],
  },
  state: {
    symbol: '',
    category: 'schema',
    title: 'State schema',
    short: 'The variables of the system and its invariant: conditions that always hold.',
    exampleSchema: LIB_STATE,
    notes: ['Every operation must keep the invariant: it holds before and after.'],
  },
  init: {
    symbol: '',
    category: 'schema',
    title: 'Initial state',
    short: 'What the state looks like at the start. It imports the state schema.',
    exampleSchema: LIB_INIT,
    notes: ['The invariant holds here, too: `onLoan = ∅` forces `borrower = ∅`.'],
  },
  operation: {
    symbol: '',
    category: 'schema',
    title: 'Operation schema',
    short: 'Relates the state before and after the operation, with inputs (x?) and outputs (x!).',
    exampleSchema: LIB_LEND,
    notes: ['`ΔState`: the state may change. `ΞState`: it stays the same.'],
  },
};

// ── context-dependent entries ──────────────────────────────────────────────

const DEFAULT_STATE = 'Library';
const DEFAULT_VARS = ['onLoan', 'borrower'];
const z = (s: string) => '`' + s + '`';
const list = (xs: string[]) => xs.join(', ');

/** State name and variables: from ctx, else the library example. */
function stateOf(ctx?: ExplainerContext): { name: string; vars: string[] } {
  if (ctx?.stateName) return { name: ctx.stateName, vars: ctx.stateVars ?? [] };
  if (ctx?.stateVars) return { name: 'State', vars: ctx.stateVars };
  return { name: DEFAULT_STATE, vars: DEFAULT_VARS };
}

const primed = (vars: string[]) => vars.map((v) => v + '′');

function delta(ctx?: ExplainerContext): Entry {
  const { name, vars } = stateOf(ctx);
  const before = vars.length ? ` before (${z(list(vars))})` : ' before';
  const after = vars.length
    ? ` and after the operation (${z(list(primed(vars)))})`
    : ` and ${z(name + '′')} after the operation`;
  return {
    title: 'State may change',
    short: `Structured import: ${z('Δ' + name)} brings in ${name}${before}${after}.`,
    definitionSchema: { name: 'Δ' + name, decls: `${name}\n${name}′` },
    notes: [
      `The invariant of ${name} holds in both: before and after.`,
      `Use Δ for operations that change the state${name === DEFAULT_STATE ? ' (Lend)' : ''}.`,
    ],
  };
}

function xi(ctx?: ExplainerContext): Entry {
  const { name, vars } = stateOf(ctx);
  const same = vars.length ? vars.map((v) => `${v}′ = ${v}`).join('\n') : 'x′ = x';
  return {
    title: 'State stays the same',
    short: `Structured import: ${z('Ξ' + name)} is ${z('Δ' + name)}, plus: nothing changes.`,
    definitionSchema: { name: 'Ξ' + name, decls: 'Δ' + name, preds: same },
    notes: [
      vars.length
        ? `Every state variable keeps its value: ${vars.map((v) => z(`${v}′ = ${v}`)).join(', ')}.`
        : `One line ${z('x′ = x')} for every state variable x.`,
      `Use Ξ for operations that only look at the state${name === DEFAULT_STATE ? ' (FindBorrower)' : ''}.`,
    ],
  };
}

function prime(ctx?: ExplainerContext): Entry {
  const subject = ctx?.subject;
  const base = subject?.replace(/[′']$/, '');
  const { name, vars } = stateOf(ctx);
  const example = 'borrower′ = borrower ∪ {book? ↦ member?}';
  if (base && base === name) {
    return {
      symbol: 'x′',
      title: 'After the operation',
      short: vars.length
        ? `${z(name + '′')} is the state after the operation: ${z(list(primed(vars)))}. The invariant holds for these, too.`
        : `${z(name + '′')} is the state after the operation: every variable of ${name}, primed.`,
      example,
      notes: ['Unprimed = before, primed = after.'],
    };
  }
  return {
    symbol: 'x′',
    title: 'After the operation',
    short: base
      ? `${z(base + '′')} is the value of ${base} after the operation; ${z(base)} is the value before.`
      : `${z('x′')} is the value of x after the operation; ${z('x')} is the value before.`,
    example,
    notes: ['Unprimed = before, primed = after.'],
  };
}

function input(ctx?: ExplainerContext): Entry {
  const s = ctx?.subject?.endsWith('?') ? ctx.subject : 'book?';
  return {
    symbol: 'x?',
    title: 'Input',
    short: `${z(s)} is an input: a value handed to the operation from outside.`,
    example: 'book? : BOOK\nbook? ∉ onLoan',
    notes: ['A condition on inputs, like `book? ∉ onLoan`, is a precondition of the operation.'],
  };
}

function output(ctx?: ExplainerContext): Entry {
  const s = ctx?.subject?.endsWith('!') ? ctx.subject : 'member!';
  return {
    symbol: 'x!',
    title: 'Output',
    short: `${z(s)} is an output: a value the operation hands back.`,
    example: 'member! : MEMBER\nmember! = borrower(book?)',
    notes: ['The predicates must say which value the output has.'],
  };
}

function given(ctx?: ExplainerContext): Entry {
  const s = ctx?.subject;
  return {
    symbol: '[ ]',
    category: 'type',
    title: 'Given set',
    short:
      s && !/[[\],]/.test(s)
        ? `${z(s)} is a given set: a basic type, introduced in brackets like ${z(`[${s}]`)}.`
        : `${z('[BOOK, MEMBER]')} introduces basic types. We do not say what their elements look like.`,
    example: '[BOOK, MEMBER]\nonLoan : ℙ BOOK',
    notes: ['We can only compare elements with `=`; nothing else is assumed.'],
  };
}

const DYNAMIC: Record<string, (ctx?: ExplainerContext) => Entry> = {
  delta,
  xi,
  prime,
  input,
  output,
  given,
};

/** All explainer ids (symbols + concepts). */
export const EXPLAINER_IDS: string[] = [...Object.keys(DYNAMIC), ...Object.keys(STATIC)];

/** Explainer for `id` (a symbol id from symbols.ts or a concept id), instantiated with `ctx`. */
export function getExplainer(id: string, ctx?: ExplainerContext): Explainer | undefined {
  const entry = DYNAMIC[id]?.(ctx) ?? STATIC[id];
  if (!entry) return undefined;
  const sym = SYMBOL_BY_ID[id];
  return {
    ...entry,
    id,
    symbol: entry.symbol ?? sym?.text ?? '',
    category: entry.category ?? sym?.category,
    ascii: sym?.ascii,
  };
}
