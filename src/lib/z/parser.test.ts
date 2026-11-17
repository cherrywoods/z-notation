import { describe, expect, it } from 'vitest';
import type { Term, VarDecl } from './ast';
import { parseDecls, parseGiven, parsePredItems, parsePreds, parseTerm } from './parser';
import { lex } from './lexer';
import { LIBRARY, LOANS_OF } from './testing/library';

/** Fully parenthesised prefix form, to make the tree structure visible. */
function sx(t: Term): string {
  const ds = (decls: VarDecl[]) => decls.map((d) => `${d.names.map((n) => n.name).join(',')}:${sx(d.type)}`).join(' ');
  switch (t.kind) {
    case 'name':
      return t.name;
    case 'num':
      return String(t.value);
    case 'bool':
      return String(t.value);
    case 'builtinSet':
      return t.set;
    case 'emptyset':
      return '∅';
    case 'setDisplay':
      return `{${t.elems.map(sx).join(' ')}}`;
    case 'setComp':
      return `{| ${ds(t.decls)}${t.pred ? ' | ' + sx(t.pred) : ''}${t.expr ? ' • ' + sx(t.expr) : ''}}`;
    case 'tuple':
      return `(tuple ${t.elems.map(sx).join(' ')})`;
    case 'cross':
      return `(× ${t.elems.map(sx).join(' ')})`;
    case 'apply':
      return `(@ ${sx(t.fn)} ${sx(t.arg)})`;
    case 'unop':
      return `(${t.op} ${sx(t.arg)})`;
    case 'binop':
    case 'rel':
    case 'logic':
      return `(${t.op} ${sx(t.left)} ${sx(t.right)})`;
    case 'not':
      return `(¬ ${sx(t.arg)})`;
    case 'quant':
      return `(${t.q} [${ds(t.decls)}]${t.pred ? ' ' + sx(t.pred) : ''} ${sx(t.body)})`;
  }
}

function tree(src: string): string {
  const r = parseTerm(src);
  expect(r.diagnostics, src).toEqual([]);
  return sx(r.term!);
}

function errorOf(src: string): string {
  const r = parseTerm(src);
  expect(r.term, src).toBeNull();
  expect(r.diagnostics).toHaveLength(1);
  return r.diagnostics[0].message;
}

describe('Library', () => {
  it('parses every section without diagnostics', () => {
    expect(parseGiven(LIBRARY.given).diagnostics).toEqual([]);
    for (const s of [LIBRARY.state, LIBRARY.init!, ...LIBRARY.operations, LOANS_OF]) {
      expect(parseDecls(s.decls).diagnostics, s.name).toEqual([]);
      expect(parsePreds(s.preds).diagnostics, s.name).toEqual([]);
    }
  });

  it('builds the expected trees', () => {
    expect(tree('onLoan = dom borrower')).toBe('(= onLoan (dom borrower))');
    expect(tree('borrower′ = borrower ∪ {book? ↦ member?}')).toBe('(= borrower′ (∪ borrower {(↦ book? member?)}))');
    expect(tree('member! = borrower(book?)')).toBe('(= member! (@ borrower book?))');
    expect(tree('books! = { b ∈ onLoan | borrower(b) = member? }')).toBe('(= books! {| b:onLoan | (= (@ borrower b) member?)})');
  });

  it('records names with decorations and spans', () => {
    const t = parseTerm('book? ∉ onLoan').term!;
    expect(t).toMatchObject({
      kind: 'rel',
      op: '∉',
      left: { kind: 'name', name: 'book?', base: 'book', decoration: '?', span: { from: 0, to: 5 } },
      right: { kind: 'name', name: 'onLoan', span: { from: 8, to: 14 } },
      span: { from: 0, to: 14 },
    });
  });
});

describe('precedence', () => {
  it.each([
    ['a ∧ b ∨ c', '(∨ (∧ a b) c)'],
    ['a ∨ b ∧ c', '(∨ a (∧ b c))'],
    ['a ⇒ b ⇒ c', '(⇒ a (⇒ b c))'],
    ['a ⇔ b ⇒ c', '(⇔ a (⇒ b c))'],
    ['¬ x ∈ S ∧ y', '(∧ (¬ (∈ x S)) y)'],
    ['¬ ¬ p', '(¬ (¬ p))'],
    ['x ∈ A ∪ B', '(∈ x (∪ A B))'],
    ['A ∪ B ∩ C', '(∪ A (∩ B C))'],
    ['A ∪ B ∖ C', '(∖ (∪ A B) C)'],
    ['a + b * c - d', '(- (+ a (* b c)) d)'],
    ['a div b mod c', '(mod (div a b) c)'],
    ['A ↔ B ⇸ C', '(↔ A (⇸ B C))'],
    ['A × B ⇸ C', '(⇸ (× A B) C)'],
    ['A × B × C', '(× A B C)'],
    ['(A × B) × C', '(× (× A B) C)'],
    ['a ↦ b ↦ c', '(↦ (↦ a b) c)'],
    ['x ↦ y ∈ R', '(∈ (↦ x y) R)'],
    ['1 .. n + 1', '(.. 1 (+ n 1))'],
    ['dom R ∪ ran R', '(∪ (dom R) (ran R))'],
    ['#onLoan + 1', '(+ (# onLoan) 1)'],
    ['#dom f', '(# (dom f))'],
    ['ℙ A × B', '(× (ℙ A) B)'],
    ['ℙ (A × B)', '(ℙ (× A B))'],
    ['-x + y', '(+ (neg x) y)'],
    ['x - -3', '(- x -3)'],
    ['-(3)', '(neg 3)'],
    ['a - b - c', '(- (- a b) c)'],
  ])('%s', (src, expected) => expect(tree(src)).toBe(expected));
});

describe('application', () => {
  it.each([
    ['f(x)', '(@ f x)'],
    ['f x', '(@ f x)'],
    ['rx p d', '(@ (@ rx p) d)'],
    ['rx(p)(d)', '(@ (@ rx p) d)'],
    ['(rx p) d', '(@ (@ rx p) d)'],
    ['dom rx(p)', '(dom (@ rx p))'],
    ['dom (rx p) ∩ A', '(∩ (dom (@ rx p)) A)'],
    ['# onLoan', '(# onLoan)'],
    ['f(a, b)', '(@ f (tuple a b))'],
    ['control a ∈ dom onDuty', '(∈ (@ control a) (dom onDuty))'],
    ['{landing a? ↦ a?}', '{(↦ (@ landing a?) a?)}'],
    ['-overdraft(a)', '(neg (@ overdraft a))'],
    ['(f ∪ g)(x)', '(@ (∪ f g) x)'],
  ])('%s', (src, expected) => expect(tree(src)).toBe(expected));
});

describe('atoms, sets and quantifiers', () => {
  it.each([
    ['∅', '∅'],
    ['{}', '∅'],
    ['{ }', '∅'],
    ['true ∨ false', '(∨ true false)'],
    ['ℕ₁ ⊆ ℕ', '(⊆ ℕ₁ ℕ)'],
    ['(a, b, c)', '(tuple a b c)'],
    ['{a, b}', '{a b}'],
    ['{x : S}', '{| x:S}'],
    ['{ x : S | x ∈ T }', '{| x:S | (∈ x T)}'],
    ['{ x ∈ S | x ∈ T }', '{| x:S | (∈ x T)}'],
    ['{ x : S; y : T | x = y • x ↦ y }', '{| x:S y:T | (= x y) • (↦ x y)}'],
    ['{ x : S • f(x) }', '{| x:S • (@ f x)}'],
    ['{ x, y ∈ S | x ≠ y }', '{| x,y:S | (≠ x y)}'],
    ['{x ∈ S}', '{(∈ x S)}'],
    ['{x ∈ S, y}', '{(∈ x S) y}'],
    ['∀ x : S • P', '(∀ [x:S] P)'],
    ['∀ x ∈ S • P', '(∀ [x:S] P)'],
    ['∀ x, y : S; z : T | x ≠ y • z ∈ U', '(∀ [x,y:S z:T] (≠ x y) (∈ z U))'],
    ['∃ x : S • P ∧ Q', '(∃ [x:S] (∧ P Q))'],
    ['P ∧ ∀ x : S • Q ∨ R', '(∧ P (∀ [x:S] (∨ Q R)))'],
    ['(∀ x : S • Q) ∨ R', '(∨ (∀ [x:S] Q) R)'],
    ['¬ ∃ x : S • P', '(¬ (∃ [x:S] P))'],
    ['∀ x : S • ∃ y : T • R', '(∀ [x:S] (∃ [y:T] R))'],
    ['∀ x : S @ P', '(∀ [x:S] P)'],
  ])('%s', (src, expected) => expect(tree(src)).toBe(expected));

  it('accepts ASCII spellings', () => {
    expect(tree("x' in S /\\ y |-> z notin R")).toBe('(∧ (∈ x′ S) (∉ (↦ y z) R))');
    expect(tree('forall f : A -|> B @ dom f <: A => not f = {}')).toBe('(∀ [f:(⇸ A B)] (⇒ (⊆ (dom f) A) (¬ (= f ∅))))');
  });
});

describe('realistic predicates from the templates', () => {
  it.each([
    ['∀ a : dom balance • balance(a) ≥ -overdraft(a)', '(∀ [a:(dom balance)] (≥ (@ balance a) (neg (@ overdraft a))))'],
    ['{ d ∈ DRUG | (p? ↦ d) ∈ prescribed }', '{| d:DRUG | (∈ (↦ p? d) prescribed)}'],
    ['#{ v ∈ registered | v ∈ dom ballot } ≤ #registered', '(≤ (# {| v:registered | (∈ v (dom ballot))}) (# registered))'],
    ['∀ p : patients; d : dom (rx p) • (rx p) d ≤ maxDose d', '(∀ [p:patients d:(dom (@ rx p))] (≤ (@ (@ rx p) d) (@ maxDose d)))'],
    ['∀ u : USER; p : PERMISSION • (u ↦ p) ∈ perms ⇔ (∃ r : ROLE • (u ↦ r) ∈ ua ∧ (r ↦ p) ∈ pa)', '(∀ [u:USER p:PERMISSION] (⇔ (∈ (↦ u p) perms) (∃ [r:ROLE] (∧ (∈ (↦ u r) ua) (∈ (↦ r p) pa)))))'],
    ['balance′ = balance ∖ {a? ↦ balance a?} ∪ {a? ↦ balance a? + amount?}', '(= balance′ (∪ (∖ balance {(↦ a? (@ balance a?))}) {(↦ a? (+ (@ balance a?) amount?))}))'],
  ])('%s', (src, expected) => expect(tree(src)).toBe(expected));
});

describe('friendly syntax errors', () => {
  it('reports out-of-scope constructs', () => {
    expect(errorOf('∀ p : patients • prescribed⦇')).toMatch(/^‘⦇ ⦈’ \(relational image\) is not part of this tutorial/);
    expect(errorOf('rx′ = rx ⊕ {p? ↦ d?}')).toBe('‘⊕’ (override) is not part of this tutorial — use ∪ and ∖ instead');
    expect(errorOf('at′ = {t?} ⩤ at')).toMatch(/^‘⩤’ \(domain subtraction\) is not part of this tutorial/);
    expect(errorOf('S ◁ R = R')).toMatch(/^‘◁’ \(domain restriction\) is not part of this tutorial/);
    expect(errorOf('f ++ g = h')).toMatch(/^‘⊕’/);
    expect(errorOf('S <| R = R')).toMatch(/^‘◁’/);
    expect(errorOf('S <<| R = R')).toMatch(/^‘⩤’/);
    expect(errorOf('f ∈ A ⤔ B')).toMatch(/^‘⤔’ \(partial injection\) is not part of this tutorial/);
    expect(errorOf('f ∈ A ↣ B')).toMatch(/not part of this tutorial/);
    expect(errorOf('REPORT ::= ok | fail')).toMatch(/^Free types \(‘::=’\) are not part of this tutorial/);
    expect(errorOf('AB == A × B')).toMatch(/abbreviations with ‘==’ are not part of this tutorial/);
    expect(errorOf('θState = x')).toMatch(/‘θ’ \(theta\) is not part of this tutorial/);
    expect(errorOf('s = ⟨a⟩')).toMatch(/^Sequences/);
    expect(errorOf('x ∈ 𝔽 A')).toMatch(/^Finite sets ‘𝔽’/);
  });

  it('points at the exact symbol', () => {
    const r = parseTerm('x ∈ R⦇{a}⦈');
    expect(r.diagnostics[0]).toMatchObject({ from: 5, to: 6, severity: 'error', kind: 'syntax' });
    const s = parseTerm('x ∈ 𝔽 A'); // a surrogate pair
    expect(s.diagnostics[0]).toMatchObject({ from: 4, to: 6 });
  });

  it('explains common mistakes', () => {
    expect(errorOf('borrower(book?')).toBe('Missing ‘)’ to close this ‘(’');
    expect(parseTerm('borrower(book?').diagnostics[0]).toMatchObject({ from: 8, to: 9 });
    expect(errorOf('{book? ↦ member?')).toBe('Missing ‘}’ to close this ‘{’');
    expect(errorOf('onLoan =')).toBe('Expected something after ‘=’');
    expect(errorOf('= onLoan')).toBe('Expected something before ‘=’');
    expect(errorOf('onLoan ∪ ∩ x')).toBe('Expected something between ‘∪’ and ‘∩’');
    expect(errorOf('x ∈ dom')).toBe('Expected something after ‘dom’');
    expect(errorOf('a < b < c')).toBe('Chains like ‘a < b < c’ are not allowed — write ‘a < b ∧ b < c’');
    expect(errorOf('a != b')).toBe('Write ‘≠’ (or ‘/=’) for “not equal”');
    expect(errorOf('p && q')).toBe('Write ‘∧’ for “and”');
    expect(errorOf('p || q')).toBe('Write ‘∨’ for “or”');
    expect(errorOf('x := x + 1')).toMatch(/^Z has no assignment/);
    expect(errorOf('book ? ∈ onLoan')).toBe('Write ‘?’ directly after the name, without a space (e.g. ‘x?’)');
    expect(errorOf('onLoan′′ = onLoan')).toBe('A name can have only one decoration (′, ? or !)');
    expect(errorOf('f()')).toMatch(/^Empty parentheses/);
    expect(errorOf('f[x]')).toMatch(/^Square brackets are only for given sets/);
    expect(errorOf('∀ x : S')).toBe('Expected ‘•’ and a predicate, e.g. ‘∀ x : S • P’');
    expect(errorOf('∀ x : • P')).toBe('Expected a type after ‘:’');
    expect(errorOf('2 x = y')).toBe('Missing operator before ‘x’');
    expect(errorOf('a = b)')).toBe('Unexpected ‘)’ — there is no matching opening bracket');
    expect(errorOf('x : NAME')).toBe('Declarations like ‘x : T’ go above the line (or after ∀ / ∃)');
    expect(errorOf('ΔState')).toBe('‘ΔState’ belongs in the declarations (above the line)');
  });
});

describe('parsePreds: lines and continuation', () => {
  it('treats each line as one predicate', () => {
    const r = parsePreds('book? ∉ onLoan\nborrower′ = borrower ∪ {book? ↦ member?}\n\n');
    expect(r.diagnostics).toEqual([]);
    expect(r.preds.map(sx)).toEqual(['(∉ book? onLoan)', '(= borrower′ (∪ borrower {(↦ book? member?)}))']);
  });

  it('continues after an infix operator, before an infix operator and inside brackets', () => {
    const r = parsePreds(
      [
        'borrower′ =', //             ends with an operator
        '  borrower ∪ {book? ↦ member?}',
        'onLoan′ = onLoan', //        next line starts with an operator
        '  ∪ {book?}',
        'books! = { b ∈ onLoan |', // inside braces (and ends with '|')
        '  borrower(b) = member? }',
        'f(a,', //                    ends with ','
        '  b) = c',
        '∀ x : S', //                 next line starts with '•'
        '  • x ∈ T',
        'p ∧', //                     ends with an operator
        '',
        'q',
      ].join('\n'),
    );
    expect(r.preds.map(sx)).toEqual([
      '(= borrower′ (∪ borrower {(↦ book? member?)}))',
      '(= onLoan′ (∪ onLoan {book?}))',
      '(= books! {| b:onLoan | (= (@ borrower b) member?)})',
      '(= (@ f (tuple a b)) c)',
      '(∀ [x:S] (∈ x T))',
      'q',
    ]);
    // an empty line always ends a predicate
    expect(r.diagnostics.map((d) => d.message)).toEqual(['Expected something after ‘∧’']);
  });

  it('does not treat a leading minus as a continuation', () => {
    expect(parsePreds('x = 1\n-y < 0').preds.map(sx)).toEqual(['(= x 1)', '(< (neg y) 0)']);
  });

  it('recovers from a syntax error in one predicate', () => {
    const r = parsePreds('onLoan = dom borrower\nonLoan ∈ ∈ x\nborrower′ = borrower');
    expect(r.preds.map(sx)).toEqual(['(= onLoan (dom borrower))', '(= borrower′ borrower)']);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ from: 31, to: 32, message: 'Expected something between ‘∈’ and ‘∈’' });
  });

  it('does not let an unclosed bracket swallow the following lines', () => {
    const text = 'onLoan = dom borrower\nmember! = borrower(book?\nbook? ∈ onLoan\nx = y';
    const r = parsePreds(text);
    expect(r.preds.map(sx)).toEqual(['(= onLoan (dom borrower))', '(∈ book? onLoan)', '(= x y)']);
    expect(r.diagnostics).toEqual([
      { from: text.indexOf('('), to: text.indexOf('(') + 1, severity: 'error', kind: 'syntax', message: 'Missing ‘)’ to close this ‘(’' },
    ]);
  });

  it('keeps stable indices for predicates that fail to parse', () => {
    const r = parsePredItems('a = b\nc = = d\ne = f');
    expect(r.items.map((i) => (i.term ? sx(i.term) : null))).toEqual(['(= a b)', null, '(= e f)']);
    expect(r.items[1].span).toEqual({ from: 6, to: 13 });
  });

  it('reports out-of-scope symbols per predicate', () => {
    const r = parsePreds('x ∈ S\nrx′ = rx ⊕ {p? ↦ d?}\ny ∈ S');
    expect(r.preds).toHaveLength(2);
    expect(r.diagnostics[0].message).toMatch(/^‘⊕’/);
  });
});

describe('parseDecls', () => {
  it('parses variable declarations, Δ/Ξ and schema imports', () => {
    const r = parseDecls('ΔLibrary\nbook? : BOOK\nmember! : MEMBER\nΞ Library\nLibrary′\nrx : PATIENT ⇸ (DRUG ⇸ ℕ₁)');
    expect(r.diagnostics).toEqual([]);
    expect(r.decls.map((d) => (d.kind === 'var' ? `${d.names.map((n) => n.name).join(',')}:${sx(d.type)}` : `${d.kind} ${d.schema}`))).toEqual([
      'delta Library',
      'book?:BOOK',
      'member!:MEMBER',
      'xi Library',
      'include Library′',
      'rx:(⇸ PATIENT (⇸ DRUG ℕ₁))',
    ]);
    expect(r.decls[0].span).toEqual({ from: 0, to: 8 });
  });

  it('allows only one variable per declaration line', () => {
    const r = parseDecls('allergies, prescribed : PATIENT ↔ DRUG\npatients : ℙ PATIENT; ward : WARD');
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      'Declare one variable per line: ‘allergies : PATIENT ↔ DRUG’ and ‘prescribed : PATIENT ↔ DRUG’ on separate lines.',
      'Declare one variable per line: put this declaration on its own line.',
    ]);
    // the declarations are kept, so the names cause no follow-up errors
    expect(r.decls.length).toBe(3);
  });

  it('ignores empty lines and continues multi-line types', () => {
    const r = parseDecls('\nonLoan : ℙ BOOK\n\nborrower : BOOK ⇸\n  MEMBER\n');
    expect(r.diagnostics).toEqual([]);
    expect(r.decls).toHaveLength(2);
  });

  it('explains mistakes', () => {
    const msgs = (s: string) => parseDecls(s).diagnostics.map((d) => d.message);
    expect(msgs('onLoan ∈ ℙ BOOK')).toEqual(['In a declaration, write ‘:’ instead of ‘∈’, e.g. ‘onLoan : …’']);
    expect(msgs('onLoan = dom borrower')).toEqual([
      'This looks like a predicate — predicates go below the line. A declaration looks like ‘x : T’.',
    ]);
    expect(msgs('dom borrower = onLoan')).toEqual(['Expected a declaration such as ‘x : T’ (predicates go below the line)']);
    expect(msgs('onLoan :')).toEqual(['Expected a type after ‘:’']);
    expect(msgs('onLoan ℙ BOOK')).toEqual(['Expected ‘:’ after ‘onLoan’']);
    expect(msgs('book?')).toEqual(['Expected ‘:’ and a type after ‘book?’, e.g. ‘book? : NAME’']);
    expect(msgs('Δ')).toEqual(['Expected the state schema name after ‘Δ’, e.g. ‘ΔState’']);
    expect(msgs('ΔS x')).toEqual(['Only the state schema name follows ‘Δ’']);
    expect(msgs('A ∧ B')).toEqual(['Combining schemas with ‘∧’ (schema calculus) is not part of this tutorial']);
    expect(msgs('f : A ⤔ B')).toEqual(['‘⤔’ (partial injection) is not part of this tutorial — use ‘⇸’']);
    expect(msgs('x : ℙ (BOOK\ny : MEMBER')).toEqual(['Missing ‘)’ to close this ‘(’']);
    expect(parseDecls('x : ℙ (BOOK\ny : MEMBER').decls).toHaveLength(1);
  });
});

describe('numbers', () => {
  const toks = (src: string) => lex(src).filter((t) => t.kind !== 'eof').map((t) => `${t.kind}:${t.value}`);

  it('lexes decimals as one token (to explain them), ranges and ℝ', () => {
    expect(toks('0.25 + 3')).toEqual(['number:0.25', 'sym:+', 'number:3']);
    expect(toks('1..5')).toEqual(['number:1', 'sym:..', 'number:5']);
    expect(toks('2.Feb')).toEqual(['number:2', 'error:.', 'ident:Feb']); // only matters in example values
    expect(toks('ℝx')).toEqual(['error:ℝ', 'ident:x']); // ℝ never becomes part of a name
  });

  it('accepts only whole numbers', () => {
    for (const src of ['x = 0.25', 'x = .5', 'x = 1.', 'x = 1,5', 'x = -1.5']) expect(errorOf(src), src).toBe('Only whole numbers are part of this tutorial.');
    expect(tree('{1,5} = {1, 5}')).toBe('(= {1 5} {1 5})'); // inside braces a comma separates elements
    expect(errorOf('t ∈ ℝ')).toBe('‘ℝ’ (real numbers) is not part of this tutorial — use ℤ (whole numbers)');
    expect(errorOf('x = y / 2')).toBe('Division ‘/’ is not part of this tutorial — use ‘div’ (division of whole numbers)');
  });

  it('rejects literals that cannot be represented exactly', () => {
    expect(tree('n = 9007199254740991')).toBe('(= n 9007199254740991)');
    expect(tree('n = -9007199254740991')).toBe('(= n -9007199254740991)');
    for (const src of ['n = 99999999999999999999', 'n = -99999999999999999999', 'n = 9007199254740992']) {
      expect(errorOf(src), src).toBe('Numbers this large are not supported here.');
    }
    expect(parseTerm('n = 99999999999999999999').diagnostics[0]).toMatchObject({ from: 4, to: 24 });
  });
});

describe('constructs that are not part of the tutorial', () => {
  it.each([
    ['f′ = f ⊕ {x ↦ y}', '‘⊕’ (override) is not part of this tutorial — use ∪ and ∖ instead'],
    ['S ◁ R = R', '‘◁’ (domain restriction) is not part of this tutorial'],
    ['S ⩤ R = R', '‘⩤’ (domain subtraction) is not part of this tutorial'],
    ['R ▷ S = R', 'Range restriction ‘▷’ is not part of this tutorial'],
    ['R ⩥ S = R', 'Range subtraction ‘⩥’ is not part of this tutorial'],
    ['R⦇{x}⦈ = ∅', '‘⦇ ⦈’ (relational image) is not part of this tutorial'],
    ['R∼ = R', 'Relational inverse ‘∼’ is not part of this tutorial'],
    ['R⁻¹ = R', 'Relational inverse (‘⁻¹’, ‘∼’) is not part of this tutorial'],
    ['R ⨾ S = T', 'Relational composition ‘⨾’ is not part of this tutorial'],
    ['f ∈ A ↣ B', '‘↣’ (total injection) is not part of this tutorial — use ‘→’'],
    ['f ∈ A ⤔ B', '‘⤔’ (partial injection) is not part of this tutorial — use ‘⇸’'],
    ['f ∈ A ↠ B', '‘↠’ (surjection) is not part of this tutorial — use ‘→’'],
    ['f ∈ A ⤀ B', '‘⤀’ (partial surjection) is not part of this tutorial — use ‘⇸’'],
    ['f ∈ A ⤖ B', '‘⤖’ (bijection) is not part of this tutorial — use ‘→’'],
    ['f ∈ A ⇻ B', '‘⇻’ (finite function) is not part of this tutorial — use ‘⇸’'],
    ['f ∈ A ⤗ B', '‘⤗’ is not part of this tutorial — use ⇸, → or ↔'],
    ['S ∈ ℙ₁ A', '‘ℙ₁’ (non-empty subsets) is not part of this tutorial — use ℙ and add ‘S ≠ ∅’'],
    ['s = ⟨a, b⟩', 'Sequences (‘seq’, ‘⟨ ⟩’) are not part of this tutorial'],
    ['∃₁ x : S • P', '‘∃₁’ (exactly one) is not part of this tutorial'],
    ['x = μ y : S | P', '‘μ’ (definite description) is not part of this tutorial'],
    ['f = λ x : S • x', '‘λ’ (lambda) is not part of this tutorial'],
    ['x ∈ ⋃ S', 'Generalised union ‘⋃’ is not part of this tutorial'],
    ['x ∈ ⋂ S', 'Generalised intersection ‘⋂’ is not part of this tutorial'],
    ['x = if p then a else b', '‘if … then … else’ is not part of this tutorial — write two implications: P ⇒ … and ¬ P ⇒ …'],
    ['let y == x + 1 • y > 0', '‘let’ is not part of this tutorial'],
  ])('%s', (src, message) => {
    const r = parseTerm(src);
    expect(r.term).toBeNull();
    expect(r.diagnostics[0].message).toContain(message);
    expect(r.diagnostics[0].message).toContain('not part of this tutorial');
  });

  it('recognises ASCII spellings of the arrows', () => {
    expect(errorOf('f ∈ A >-> B')).toMatch(/^‘↣’/);
    expect(errorOf('f ∈ A >+> B')).toMatch(/^‘⤔’/);
    expect(errorOf('f ∈ A ->> B')).toMatch(/^‘↠’/);
    expect(errorOf('f ∈ A +->> B')).toMatch(/^‘⤀’/);
    expect(errorOf('f ∈ A >->> B')).toMatch(/^‘⤖’/);
    expect(tree('f ∈ A -> B')).toBe('(∈ f (→ A B))');
    expect(tree('a > -b')).toBe('(> a (neg b))');
  });

  it('points at the construct', () => {
    expect(parseTerm('S ∈ ℙ₁ A').diagnostics[0]).toMatchObject({ from: 4, to: 6 });
    expect(parseTerm('∃₁ x : S • P').diagnostics[0]).toMatchObject({ from: 0, to: 2 });
  });
});

describe('parseGiven', () => {
  it('reads one or more groups', () => {
    const r = parseGiven('[NAME, DATE]\n[ROOM]');
    expect(r.diagnostics).toEqual([]);
    expect(r.names.map((n) => n.name)).toEqual(['NAME', 'DATE', 'ROOM']);
    expect(r.names[1].span).toEqual({ from: 7, to: 11 });
    expect(r.decl?.span).toEqual({ from: 0, to: 19 });
  });

  it('keeps reading names after a mistake', () => {
    const names = (src: string) => parseGiven(src).names.map((n) => n.name);
    const msgs = (src: string) => parseGiven(src).diagnostics.map((d) => d.message);
    expect(names('[PATIENT DRUG]')).toEqual(['PATIENT', 'DRUG']);
    expect(msgs('[PATIENT DRUG]')).toEqual(['Separate the names with ‘,’']);
    expect(names('[PATIENT,,DRUG]')).toEqual(['PATIENT', 'DRUG']);
    expect(msgs('[PATIENT,,DRUG]')).toEqual(['Expected a name between the commas']);
    expect(names('[A, ℕ, B]')).toEqual(['A', 'B']);
    expect(names('[A; B]')).toEqual(['A', 'B']);
  });

  it('does not define built-in or unsupported sets', () => {
    expect(parseGiven('[ℕ]')).toMatchObject({ decl: null, names: [] });
    expect(parseGiven('[ℕ]').diagnostics.map((d) => d.message)).toEqual(['‘ℕ’ is built in — no need to declare it']);
    expect(parseGiven('[ℝ]')).toMatchObject({ decl: null, names: [] });
    expect(parseGiven('[ℝ]').diagnostics.map((d) => d.message)).toEqual(['‘ℝ’ (real numbers) is not part of this tutorial — use ℤ (whole numbers)']);
  });

  it('accepts an empty text', () => {
    expect(parseGiven('  \n')).toEqual({ decl: null, names: [], diagnostics: [] });
  });

  it('explains mistakes and still returns the names it can read', () => {
    const r = parseGiven('[NAME DATE]\nTIME\n[A,\nREPORT ::= ok | failed\n[]\n[x?]\n[ℕ]');
    expect(r.names.map((n) => n.name)).toEqual(['NAME', 'DATE', 'A', 'x']);
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      'Separate the names with ‘,’',
      'Write given sets in square brackets, e.g. [TIME]',
      'Missing ‘]’ to close this ‘[’',
      'Free types (‘::=’) are not part of this tutorial — use a given set instead',
      'Write at least one name inside [ ]',
      'Given set names have no decoration — write ‘x’',
      '‘ℕ’ is built in — no need to declare it',
    ]);
  });
});
