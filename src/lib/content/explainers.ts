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
  /** Name of the current state schema, e.g. 'Ward' (for Δ/Ξ explainers). */
  stateName?: string;
  /** Undecorated state variable names, e.g. ['patients', 'allergic', 'prescribed']. */
  stateVars?: string[];
  /**
   * The identifier the explainer was opened on, if any: a decorated name for ′ ? !
   * ('prescribed′', 'p?', 'drugs!'), or a given-set name for 'given' ('PATIENT').
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
  /** Z text example, taken from the tutorial's systems (see below). */
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

// ── example material: the tutorial's own systems (templates/*.json) ────────
// Medication Prescribing is the default; Bank Accounts shows ⇸ (owner),
// Railway Signalling shows → (protects).

const WARD_STATE: SchemaSketch = {
  name: 'Ward',
  decls: 'patients : ℙ PATIENT\nallergic : PATIENT ↔ DRUG\nprescribed : PATIENT ↔ DRUG',
  preds: 'dom allergic ⊆ patients\ndom prescribed ⊆ patients\nprescribed ∩ allergic = ∅',
};
const WARD_INIT: SchemaSketch = { name: 'InitWard', decls: 'Ward', preds: 'patients = ∅' };
const PRESCRIBE: SchemaSketch = {
  name: 'Prescribe',
  decls: 'ΔWard\np? : PATIENT\ndrug? : DRUG',
  preds:
    'p? ∈ patients\n(p? ↦ drug?) ∉ allergic\nprescribed′ = prescribed ∪ {p? ↦ drug?}\npatients′ = patients\nallergic′ = allergic',
};

/** allergic : PATIENT ↔ DRUG (Medication). */
const WARD = {
  leftLabel: 'PATIENT',
  rightLabel: 'DRUG',
  left: ['Ana', 'Ben', 'Chen'],
  right: ['penicillin', 'aspirin', 'heparin'],
  arrows: [
    { from: 'Ana', to: 'penicillin' },
    { from: 'Ana', to: 'aspirin' },
    { from: 'Ben', to: 'heparin' },
  ],
};
/** owner : ACCOUNT ⇸ PERSON (Bank Accounts). */
const BANK = { leftLabel: 'ACCOUNT', rightLabel: 'PERSON', left: ['DE4711', 'DE0815', 'DE1234'], right: ['Mia', 'Noah', 'Lea'] };
/** protects : SIGNAL → BLOCK (Railway Signalling). */
const RAIL = { leftLabel: 'SIGNAL', rightLabel: 'BLOCK', left: ['S1', 'S2', 'S3'], right: ['B1', 'B2', 'B3'] };

// ── static entries ─────────────────────────────────────────────────────────

const STATIC: Record<string, Entry> = {
  // declarations
  colon: {
    title: 'Declaration',
    short: '`x : S` declares a variable x: x is an element of the set S.',
    example: 'patients : ℙ PATIENT\nallergic : PATIENT ↔ DRUG',
    notes: ['S is the type of x: it fixes which values x can have.'],
  },

  // types & sets
  power: {
    title: 'Power set',
    short: '`ℙ X` is the set of all subsets of X.',
    definition: 'S ∈ ℙ X ⇔ S ⊆ X',
    example: 'patients : ℙ PATIENT\nℙ {Ana, Ben} = {∅, {Ana}, {Ben}, {Ana, Ben}}',
    notes: ['`patients : ℙ PATIENT` — the value of patients is a set of patients.'],
  },
  nat: {
    title: 'Natural numbers',
    short: 'The whole numbers 0, 1, 2, … (never negative).',
    definition: 'ℕ == {0, 1, 2, 3, …}',
    example: 'overdraft : ACCOUNT ⇸ ℕ\n#patients ∈ ℕ',
  },
  nat1: {
    title: 'Positive natural numbers',
    short: 'The whole numbers 1, 2, 3, … (without 0).',
    definition: 'ℕ₁ == ℕ ∖ {0}',
    example: 'amount? : ℕ₁',
    notes: ['A withdrawal of 0 makes no sense, so the bank uses ℕ₁.'],
  },
  int: {
    title: 'Integers',
    short: 'All whole numbers, including negative ones.',
    definition: 'ℤ == {…, −2, −1, 0, 1, 2, …}',
    example: 'balance : ACCOUNT ⇸ ℤ',
    notes: ['An account can be overdrawn, so a balance can be negative.'],
  },
  cross: {
    title: 'Cartesian product',
    short: '`X × Y` is the set of all pairs (x, y) with x ∈ X and y ∈ Y.',
    definition: 'X × Y == { x ∈ X; y ∈ Y . (x, y) }',
    example: '(Ana, penicillin) ∈ PATIENT × DRUG',
    notes: ['`x ↦ y` is another way to write the pair (x, y).'],
  },

  // relations & functions
  rel: {
    title: 'Relation',
    short: '`X ↔ Y` is a set of pairs. An element may be related to no, one or many elements.',
    definition: 'X ↔ Y == ℙ(X × Y)',
    example: 'allergic : PATIENT ↔ DRUG\nallergic = {Ana ↦ penicillin, Ana ↦ aspirin,\n  Ben ↦ heparin}',
    diagram: {
      panels: [{ ...WARD, caption: 'Ana: two arrows, Chen: none — both fine', verdict: 'ok' }],
    },
    notes: ['Every function is a relation — but not every relation is a function.'],
  },
  pfun: {
    title: 'Partial function',
    short: '`X ⇸ Y` relates each x to at most one y. Some x may have none.',
    definition:
      'X ⇸ Y == { f ∈ X ↔ Y |\n    ∀ x ∈ X; y₁, y₂ ∈ Y .\n      (x ↦ y₁) ∈ f ∧ (x ↦ y₂) ∈ f ⇒ y₁ = y₂ }',
    example: 'owner : ACCOUNT ⇸ PERSON\nowner = {DE4711 ↦ Mia, DE0815 ↦ Noah}',
    diagram: {
      panels: [
        {
          ...BANK,
          arrows: [
            { from: 'DE4711', to: 'Mia' },
            { from: 'DE0815', to: 'Noah' },
          ],
          caption: 'at most one owner per account',
          verdict: 'ok',
        },
        {
          ...BANK,
          arrows: [
            { from: 'DE4711', to: 'Mia' },
            { from: 'DE4711', to: 'Lea', kind: 'bad' },
            { from: 'DE0815', to: 'Noah' },
          ],
          badLeft: ['DE4711'],
          caption: 'DE4711: two owners',
          verdict: 'bad',
        },
      ],
    },
    notes: ['Not every account number is in use: `dom owner` can be smaller than ACCOUNT.'],
  },
  tfun: {
    title: 'Total function',
    short: '`X → Y` relates every x ∈ X to exactly one y.',
    definition: 'X → Y == { f ∈ X ⇸ Y | dom f = X }',
    example: 'protects : SIGNAL → BLOCK\nprotects(s?) ∉ ran at',
    diagram: {
      panels: [
        {
          ...RAIL,
          arrows: [
            { from: 'S1', to: 'B1' },
            { from: 'S2', to: 'B2' },
            { from: 'S3', to: 'B2' },
          ],
          caption: 'exactly one arrow per signal',
          verdict: 'ok',
        },
        {
          ...RAIL,
          arrows: [
            { from: 'S1', to: 'B1' },
            { from: 'S2', to: 'B2' },
          ],
          badLeft: ['S3'],
          caption: 'S3: no arrow',
          verdict: 'bad',
        },
      ],
    },
    notes: ['Every signal protects a block, so `protects(s?)` is always defined.'],
  },
  maplet: {
    title: 'Maplet',
    short: '`x ↦ y` is the pair (x, y): “x maps to y”.',
    definition: 'x ↦ y == (x, y)',
    example: 'allergic = {Ana ↦ penicillin, Ben ↦ heparin}\n(Ana ↦ penicillin) ∈ allergic',
  },
  dom: {
    title: 'Domain',
    short: '`dom R` is the set of all x that R relates to something — where arrows start.',
    definition: 'dom R == { x ∈ X | ∃ y ∈ Y . (x ↦ y) ∈ R }',
    example: 'dom {Ana ↦ penicillin, Ben ↦ heparin}\n  = {Ana, Ben}',
    diagram: {
      panels: [{ ...WARD, highlightLeft: ['Ana', 'Ben'], caption: '`dom allergic = {Ana, Ben}`' }],
    },
    notes: ['`dom allergic ⊆ patients`: allergies are only recorded for patients on the ward.'],
  },
  ran: {
    title: 'Range',
    short: '`ran R` is the set of all y that something is related to — where arrows end.',
    definition: 'ran R == { y ∈ Y | ∃ x ∈ X . (x ↦ y) ∈ R }',
    example: 'ran {Ana ↦ penicillin, Ben ↦ heparin}\n  = {penicillin, heparin}',
    diagram: {
      panels: [
        {
          ...WARD,
          right: [...WARD.right, 'insulin'],
          highlightRight: ['penicillin', 'aspirin', 'heparin'],
          caption: '`ran allergic`: the drugs with an arrow',
        },
      ],
    },
  },
  apply: {
    symbol: 'f(x)',
    title: 'Function application',
    short: '`f(x)` is the y with `x ↦ y` in f. Only defined if `x ∈ dom f`.',
    definition: 'f(x) = y ⇔ (x ↦ y) ∈ f',
    example: 'owner(DE4711) = Mia\nb! = balance(a?)',
    notes: ['That is why QueryBalance requires `a? ∈ dom owner`.', '`f x` (without parentheses) means the same.'],
  },

  // sets
  in: {
    title: 'Element of',
    short: '`x ∈ S`: x is an element of the set S.',
    example: 'p? ∈ patients\nAna ∈ {Ana, Ben}',
    notes: ['A declaration `x : S` also says `x ∈ S`.'],
  },
  notin: {
    title: 'Not an element of',
    short: '`x ∉ S`: x is not an element of the set S.',
    definition: 'x ∉ S ⇔ ¬ (x ∈ S)',
    example: '(p? ↦ drug?) ∉ allergic',
    notes: ['In Prescribe: the patient must not be allergic to the drug.'],
  },
  subseteq: {
    title: 'Subset',
    short: '`A ⊆ B`: every element of A is also in B.',
    definition: 'A ⊆ B ⇔ (∀ x ∈ A . x ∈ B)',
    example: '{Ana} ⊆ {Ana, Ben}\ndom allergic ⊆ patients',
  },
  subset: {
    title: 'Proper subset',
    short: '`A ⊂ B`: A ⊆ B, and B has at least one element more.',
    definition: 'A ⊂ B ⇔ A ⊆ B ∧ A ≠ B',
    example: '{Ana} ⊂ {Ana, Ben}',
  },
  cup: {
    title: 'Union',
    short: '`A ∪ B`: everything that is in A or in B (or both).',
    definition: 'A ∪ B == { x ∈ X | x ∈ A ∨ x ∈ B }',
    example: '{Ana} ∪ {Ben} = {Ana, Ben}\nprescribed′ = prescribed ∪ {p? ↦ drug?}',
    notes: ['A relation is a set of pairs — so ∪ can add pairs, too.'],
  },
  cap: {
    title: 'Intersection',
    short: '`A ∩ B`: everything that is in both A and B.',
    definition: 'A ∩ B == { x ∈ X | x ∈ A ∧ x ∈ B }',
    example: '{Ana, Ben} ∩ {Ben, Chen} = {Ben}\nprescribed ∩ allergic = ∅',
    notes: ['`prescribed ∩ allergic = ∅`: nobody gets a drug they are allergic to.'],
  },
  setminus: {
    title: 'Set difference',
    short: '`A ∖ B`: the elements of A that are not in B.',
    definition: 'A ∖ B == { x ∈ X | x ∈ A ∧ x ∉ B }',
    example: '{Ana, Ben} ∖ {Ben} = {Ana}\nprescribed′ = prescribed ∖ {p? ↦ drug?}',
  },
  emptyset: {
    title: 'Empty set',
    short: '`∅` is the set without any elements.',
    definition: '∀ x ∈ X . x ∉ ∅',
    example: 'patients = ∅\n#∅ = 0',
    notes: ['InitWard: at the start, the ward has no patients.'],
  },
  card: {
    title: 'Number of elements',
    short: '`#S` is the number of elements of a finite set S.',
    example: '#{Ana, Ben, Chen} = 3\n#∅ = 0',
  },
  setdisplay: {
    symbol: '{ , }',
    title: 'Set display',
    short: '`{a, b, c}` is the set with exactly these elements. Order and repetition do not matter.',
    example: 'patients = {Ana, Ben, Chen}\n{Ana, Ben} = {Ben, Ana, Ben}',
  },
  setcomp: {
    symbol: '{ | }',
    title: 'Set comprehension',
    short: '`{ x ∈ S | P }` is the set of all x in S for which P holds.',
    definition: '{ x ∈ S | P }\n{ x ∈ S | P . e }',
    example: 'drugs! = { d ∈ DRUG | (p? ↦ d) ∈ prescribed }',
    notes: ['With `. e` at the end, the set collects the values e instead of x.'],
  },

  // logic
  and: {
    title: 'And',
    short: '`P ∧ Q`: both P and Q hold.',
    example: 'p? ∈ patients ∧ (p? ↦ drug?) ∉ allergic',
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
    example: '¬ (p? ∈ patients) ⇔ p? ∉ patients',
  },
  implies: {
    title: 'Implies',
    short: '`P ⇒ Q`: if P holds, then Q holds, too.',
    definition: '(P ⇒ Q) ⇔ ¬ P ∨ Q',
    example: 'p ∈ dom allergic ⇒ p ∈ patients',
    notes: ['If P is false, `P ⇒ Q` is true.'],
  },
  iff: {
    title: 'If and only if',
    short: '`P ⇔ Q`: P and Q are both true or both false.',
    definition: '(P ⇔ Q) ⇔ (P ⇒ Q) ∧ (Q ⇒ P)',
    example: 'd ∈ drugs! ⇔ (p? ↦ d) ∈ prescribed',
  },
  forall: {
    title: 'For all',
    short: '`∀ x ∈ S . P`: P holds for every x in S.',
    definition: '(∀ x ∈ S | Q . P) ⇔ (∀ x ∈ S . Q ⇒ P)',
    example: '∀ p ∈ dom allergic . p ∈ patients',
  },
  exists: {
    title: 'There exists',
    short: '`∃ x ∈ S . P`: there is at least one x in S for which P holds.',
    definition: '(∃ x ∈ S | Q . P) ⇔ (∃ x ∈ S . Q ∧ P)',
    example: '∃ d ∈ DRUG . (Ana ↦ d) ∈ allergic',
  },
  spot: {
    symbol: '.',
    title: 'Such that',
    short: 'In ∀, ∃ and { … }, the period separates the declaration from the predicate. Read it as “such that” or “it holds that”.',
    example: '∀ p ∈ dom allergic . p ∈ patients',
    notes: ['Textbooks print a raised dot instead: `∀ x ∈ S • P`. It means the same.'],
  },
  eq: {
    title: 'Equals',
    short: '`a = b`: both sides are the same value.',
    example: 'patients = {Ana, Ben}\npatients′ = patients',
    notes: ['A predicate states a fact: `=` does not assign.'],
  },
  neq: {
    title: 'Not equal',
    short: '`a ≠ b`: the two sides are different values.',
    definition: 'a ≠ b ⇔ ¬ (a = b)',
    example: 'from? ≠ to?',
  },
  lt: { title: 'Less than', short: '`a < b`: the number a is smaller than b.', example: '#patients < 30' },
  leq: { title: 'Less or equal', short: '`a ≤ b`: a is smaller than or equal to b.', example: 'amount? ≤ balance(a?) + overdraft(a?)' },
  gt: { title: 'Greater than', short: '`a > b`: the number a is larger than b.', example: '#patients′ > #patients' },
  geq: { title: 'Greater or equal', short: '`a ≥ b`: a is larger than or equal to b.', example: 'balance(a?) - amount? ≥ -overdraft(a?)' },

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
    short: 'A named box that groups declarations (above the line) and predicates (below it, one per line; all of them must hold).',
    exampleSchema: WARD_STATE,
    notes: ['Read it as: these variables, and the conditions they satisfy.'],
  },
  declarations: {
    symbol: ':',
    category: 'schema',
    title: 'Declarations',
    short: 'Above the line: the variables, one per line. `x : S` — x is an element of S.',
    example: 'patients : ℙ PATIENT\nallergic : PATIENT ↔ DRUG',
    notes: ['A line like `ΔWard` imports the variables of a whole schema.'],
  },
  predicates: {
    symbol: '',
    category: 'logic',
    title: 'Predicates',
    short: 'Below the line: conditions that must hold. Several lines are joined by ∧.',
    example: 'dom allergic ⊆ patients\nprescribed ∩ allergic = ∅',
    notes: ['In an operation: conditions on before (x), after (x′), inputs (x?) and outputs (x!).'],
  },
  state: {
    symbol: '',
    category: 'schema',
    title: 'State schema',
    short: 'The variables of the system and its invariant: conditions that always hold.',
    exampleSchema: WARD_STATE,
    notes: ['Every operation must keep the invariant: it holds before and after.'],
  },
  init: {
    symbol: '',
    category: 'schema',
    title: 'Initial state',
    short: 'What the state looks like at the start. It imports the state schema.',
    exampleSchema: WARD_INIT,
    notes: ['The invariant holds here, too: with `patients = ∅`, nobody can have allergies or prescriptions yet.'],
  },
  operation: {
    symbol: '',
    category: 'schema',
    title: 'Operation schema',
    short: 'Relates the state before and after the operation, with inputs (x?) and outputs (x!).',
    exampleSchema: PRESCRIBE,
    notes: ['`ΔState`: the state may change. `ΞState`: it stays the same.'],
  },
};

// ── context-dependent entries ──────────────────────────────────────────────

const DEFAULT_STATE = 'Ward';
const DEFAULT_VARS = ['patients', 'allergic', 'prescribed'];
const z = (s: string) => '`' + s + '`';
const list = (xs: string[]) => xs.join(', ');

/** State name and variables: from ctx, else the Medication example (Ward). */
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
      `Use Δ for operations that change the state${name === DEFAULT_STATE ? ' (Prescribe)' : ''}. In this tutorial, state variables the operation does not mention stay unchanged (in textbook Z you would write \`v′ = v\`).`,
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
      `Use Ξ for operations that only look at the state${name === DEFAULT_STATE ? ' (ViewPrescriptions)' : ''}.`,
    ],
  };
}

function prime(ctx?: ExplainerContext): Entry {
  const subject = ctx?.subject;
  const base = subject?.replace(/[′']$/, '');
  const { name, vars } = stateOf(ctx);
  const example = 'prescribed′ = prescribed ∪ {p? ↦ drug?}';
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
  const s = ctx?.subject?.endsWith('?') ? ctx.subject : 'drug?';
  return {
    symbol: 'x?',
    title: 'Input',
    short: `${z(s)} is an input: a value handed to the operation from outside.`,
    example: 'drug? : DRUG\n(p? ↦ drug?) ∉ allergic',
    notes: ['A condition on inputs, like `(p? ↦ drug?) ∉ allergic`, is a precondition of the operation.'],
  };
}

function output(ctx?: ExplainerContext): Entry {
  const s = ctx?.subject?.endsWith('!') ? ctx.subject : 'drugs!';
  return {
    symbol: 'x!',
    title: 'Output',
    short: `${z(s)} is an output: a value the operation hands back.`,
    example: 'drugs! : ℙ DRUG\ndrugs! = { d ∈ DRUG | (p? ↦ d) ∈ prescribed }',
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
        : `${z('[PATIENT, DRUG]')} introduces basic types. We do not say what their elements look like.`,
    example: '[PATIENT, DRUG]\npatients : ℙ PATIENT',
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
