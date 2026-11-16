# Z Tutorial — design notes

Interactive tutorial website for the Z specification language, used in the
Software Engineering lecture (Uni Konstanz). Static site (Vite + Svelte 5 + TypeScript),
hosted on GitHub Pages (workflow in `.github/workflows/deploy.yml`, hash routing,
`base: './'`).

Reference for notation and style: the lecture slides. Notation follows Spivey-style Z
as on the slides, unicode only.

## Experience

* **Start page**: large centred title "Z Specification Language". Below it, a ring of
  bubbles: 6 target systems (from `templates/*.json`) + 1 "own topic" bubble with a
  text field, all on the same circle. Bubbles grow clearly on hover. When a topic is
  selected, an arrow appears bottom-right to start. White background, black text,
  very little text.
  *Phones*: a horizontal snap carousel instead of the ring: the centred bubble is large
  and selected, its neighbours peek in partially from left and right (smaller, faded);
  swipe or tap a neighbour to move it to the centre. Must feel native and obvious.
* **Hidden presentation mode**: shows a big QR code and the page URL (origin + path,
  no hash) so students can join late. Trigger: key `p` when not typing, a very faint
  icon in a corner of the start page, or `#/present`. `Esc` closes.
* **Tutorial**: a sequence of views: **Types → State → Operations (one view per
  operation) → Init (if the system has one) → Specification**. Main motion: big arrows bottom-right
  (next) / bottom-left (back). A de-emphasised step row at the top (`Types · State ·
  ViewPrescriptions Ξ · Prescribe Δ · + · Spec`) allows jumping; `+` adds an
  operation. Every topic starts with two operations: one query (Ξ) and one update (Δ).
* **Layout**: editor on the left, a side panel on the right with **Example** (top) and
  **Inference** (below). On phones the panel moves below the editor.
* **Example panel** ("testing the spec"): shows a concrete example in Z set notation
  as on the lecture slides (`onLoan = {Dune, Emma, Hamlet}`, `borrower = {Dune ↦ Ada, …}`).
  Types: the example carriers of the given sets. State: a random state satisfying the
  invariant (+ ✓/✗ per predicate). Operation: before-state, inputs, after-state, outputs;
  after-state/outputs are *solved* from the predicates; changes highlighted; values that
  the spec does not determine are flagged. Regenerate button. Secondary: "show a blocked
  case" (precondition false). Editing example values: later stage.
* **Inference panel**: facts implied by the spec, with derivation steps shown by
  default, in the style of the lecture slides (equational chain with `[invariant after]`,
  `[spec of Lend]`, `[fact about dom]` justifications). Conservative: only sound
  rules, never "probably". The same engine marks *redundant* predicates in the editor
  (dotted blue underline; tooltip shows the derivation).
* **Explainers**: hovering a Z symbol (in editors and in rendered Z) shows a small card
  with its definition from sets (↔, ⇸, →, ℙ, dom, ran, …) or an intuitive explanation
  (Δ, Ξ, ′, ?, !). Cursor `help` (question mark). Click pins/expands the card.
  Δ/Ξ explainers are instantiated with the current state schema (e.g. ΞLibrary =
  ΔLibrary + onLoan′ = onLoan, borrower′ = borrower). Touch: tap.
* **Symbol library**: palette of common symbols (main row + "more"). Inserting e.g. ⇸
  inserts `X ⇸ Y` with X and Y as highlighted tab-stop fields.
* **Typing**: ASCII shortcuts are auto-replaced (only ASCII, no LaTeX names):
  `->` →, `-|>` ⇸, `<->` ↔, `|->` ↦, `PP` ℙ, `NN` ℕ, `ZZ` ℤ, `/\` ∧, `\/` ∨, `=>` ⇒,
  `<=>` ⇔, `<=` ≤, `>=` ≥, `/=` ≠, `<:` ⊆, `{}` ∅, `'` ′, `@` •, `~` ¬, words `in`,
  `notin`, `union`, `inter`, `forall`, `exists`, `Delta…`/`Xi…`. Table in
  `src/lib/z/symbols.ts`. Ctrl+Z undoes a replacement.
* **Colours**: GitHub "Light Colorblind" syntax palette (tokens in `src/app.css`):
  type blue, relation purple, set navy, schema orange, decoration brown; logic and
  names plain black. Z text upright (no italics). The Z content is black on white; all
  interface chrome (header, controls, panels, help cards) uses the slightly grey
  `--ui-*` tokens so it recedes behind the content.
* **Text**: as little as possible; whatever stays must read like a human wrote it for
  a student who knows the lecture slides.
* **Spec view + PDF**: final view with the whole spec typeset (given sets, schema boxes);
  "Save as PDF" uses `window.print()` with print CSS.
* **Own topic**: blank skeleton titled with the topic; default given sets available
  (NAME, DATE, …); empty Ξ and Δ operation tabs.
* **Example values**: given sets from templates have value pools; unknown given sets get
  `lowercase name + 1, 2, 3` (TRAIN → train1, train2, …).
* **Persistence**: per-topic autosave in localStorage + reset.

## Z language scope (agreed with the lecturer)

In: given sets `[A, B]`; schema boxes (name in the top rule, declarations above the
line, predicates below, one per line = conjunction); ℙ; ↔, ⇸, → (no injections/
surjections); ↦; dom, ran; function application `f(x)` (also
juxtaposition `f x`); ∈ ∉ ⊆ ⊂ ∪ ∩ ∖ ∅ #; set display `{a, b}`; set comprehension
`{x : S | P}` / `{x ∈ S | P}` (+ optional `• e`); tuples, ×; ℕ ℕ₁ ℤ ℝ, `+ - * div mod`,
`< ≤ > ≥` (ℝ with decimals); `= ≠`; `∧ ∨ ¬ ⇒ ⇔`; `∀ x : S; y : T | P • Q`, `∃ …`; Δ/Ξ (structured
import); decorations ′ ? !; optional Init schema (first declaration line is the state
schema name, predicates on the unprimed state, as on the lecture slides; `State′` with primed
predicates is accepted too).

Out: free types `::=`, abbreviations `==`, axiomatic definitions, general schema
inclusion, schema calculus (∧/∨ of schemas, total operations with reports), sequences,
⤔ ↣ ↠ ⤖, relational image ⦇⦈, ⊕ ⩤ ◁ ▷ ⩥, θ, pre.

## Architecture

```
src/
  main.ts, App.svelte, app.css        entry, routing, global tokens
  lib/z/        Z engine (pure TS, no DOM)
    symbols.ts    symbol table (unicode, ASCII shortcuts, category, snippet, explainer id)
    lexer.ts      tokens + highlight spans          (done)
    ast.ts        AST (Term, Decl, SchemaAst)       (done)
    parser.ts     text → AST + syntax diagnostics
    print.ts      AST → unicode text (minimal parentheses)
    types.ts      Z types; typecheck.ts: type checker + scope diagnostics
    values.ts     runtime values (atoms, ints, tuples, finite sets), printing
    eval.ts       evaluator (finite domains; undefined application is an error value)
    generate.ts   example search (state, init, operations)
    infer.ts      rule-based inference + redundancy (derivations as on the lecture slides)
    index.ts      public API: analyseSpec(spec) → diagnostics, typed AST, env
    testing/      test fixture (library.ts: a small library spec)
  lib/spec/
    model.ts      SpecDoc / SchemaDoc / ZDiagnostic / Derivation   (done)
    topics.ts     loads templates/*.json → topic list + SpecDoc
    store.svelte.ts  reactive spec state, persistence
  lib/editor/     CodeMirror 6 setup (highlighting, auto-replace, snippets, hover, lint)
  lib/content/    explainers.ts, defaultTypes.ts
  ui/
    start/        start page: ring, carousel, own-topic bubble
    shell/        tutorial layout, step row, arrows, router glue
    present/      presentation mode (QR)
    steps/        Types / State / Operation / Spec views
    editor/       SchemaBox, ZEditor, SymbolLibrary
    panels/       ExamplePanel, InferencePanel
    explain/      ExplainerCard + mini diagrams
templates/      one JSON file per target system (tutorial format below)
```

### Template format (`templates/<id>.json`)

```jsonc
{
  "id": "medication",                     // = file name without .json
  "title": "Hospital Medication Prescribing",
  "short": "Medication",                  // bubble label, ≤ 14 characters
  "icon": "pill",                         // lucide icon name (kebab-case)
  "blurb": "Never prescribe a drug a patient is allergic to.",  // ≤ 70 chars
  "description": "…",                     // 1–3 sentences
  "requirements": [{ "id": "R1", "text": "…" }],
  "givenSets": [{ "name": "PATIENT", "values": ["Ana", "Ben", …], "comment": "…" }],
  "state": Schema,
  "init": Schema | null,
  "operations": [Schema /* kind "query" (Ξ) */, Schema /* kind "update" (Δ) */],
  "extraOperations": [Schema]             // optional, reference only (not shown)
}
// Schema:
{ "name": "Ward", "kind": "query" | "update" /* operations only */,
  "prompt": "…" /* optional; default: texts of requirements of hidden lines */,
  "declarations": [Line], "predicates": [Line] }
// Line:
{ "text": "patients : ℙ PATIENT", "requirements": ["R1"], "comment": "…",
  "hidden": true /* not pre-filled: the student writes it; its requirement is the prompt */ }
```

Operation declarations start with the `ΔState` / `ΞState` line; Init's first declaration
is the state schema name.

## Conventions

* Svelte 5 runes, TypeScript strict. No new npm dependencies without need.
* All colours/fonts via tokens in `src/app.css`. Mostly white/black; colour = Z symbols.
* Very little UI text, English.
* Diagnostics use `ZDiagnostic` (model.ts) with offsets relative to the section text.
* Tests: vitest, files `src/**/*.test.ts` (`npm test`).
