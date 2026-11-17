import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state';
import { applySnippet, type SnippetTarget } from './zEditor';

/** An editor stand-in: the document with the selection `from`–`to` (default: the cursor at the end). */
function editor(doc: string, from = doc.length, to = from): SnippetTarget & { text(): string; selected(): string } {
  let state = EditorState.create({ doc, selection: EditorSelection.single(from, to) });
  return {
    get state() {
      return state;
    },
    dispatch(tr: Transaction) {
      state = tr.state;
    },
    text: () => state.doc.toString(),
    selected: () => state.sliceDoc(state.selection.main.from, state.selection.main.to),
  };
}

/** Insert `template` with `sel` selected in `doc`; returns the new text and what is selected then. */
function insert(doc: string, sel: string, template: string) {
  const from = doc.indexOf(sel);
  const ed = editor(doc, from, from + sel.length);
  applySnippet(ed, template);
  return [ed.text(), ed.selected()];
}

describe('palette snippets with a selection', () => {
  it('put the selection, unchanged, in the first field', () => {
    expect(insert('a ∈ S\nb ∈ T', 'a ∈ S\nb ∈ T', '${P} ⇒ ${Q}')).toEqual(['a ∈ S\nb ∈ T ⇒ Q', 'Q']);
    expect(insert('x = {p?}', '{p?}', '${A} ∪ ${B}')).toEqual(['x = {p?} ∪ B', 'B']);
    expect(insert('x = ${a}', '${a}', '${A} ∪ ${B}')).toEqual(['x = ${a} ∪ B', 'B']);
    expect(insert('x = f', 'f', '${f}(${x})')).toEqual(['x = f(x)', 'x']);
  });

  it('do not link the other fields to the selection', () => {
    expect(insert('B', 'B', '${A} ∪ ${B}')).toEqual(['B ∪ B', 'B']);
    const ed = editor('B', 0, 1);
    applySnippet(ed, '${A} ∪ ${B}');
    // typing into the field changes only the field
    ed.dispatch(ed.state.update(ed.state.replaceSelection('C')));
    expect(ed.text()).toBe('B ∪ C');
  });

  it('keep braces and backslashes inside a template', () => {
    expect(insert('x = {a} \\ {b}', '{a} \\ {b}', '{${a}, ${b}}')).toEqual(['x = {{a} \\ {b}, b}', 'b']);
    expect(insert('#{p?}', '{p?}', '{ ${x} ∈ ${S} | ${P} }')).toEqual(['#{ {p?} ∈ S | P }', 'S']);
    expect(insert('  a ∈ S\n  b ∈ T', 'a ∈ S\n  b ∈ T', '∀ ${x} ∈ ${S} . ${P}')).toEqual(['  ∀ a ∈ S\n  b ∈ T ∈ S . P', 'S']);
  });

  it('wrap the selection in one-field templates', () => {
    expect(insert('x = borrower', 'borrower', 'dom ${R}')).toEqual(['x = dom borrower', '']);
    expect(insert('n = {a}', '{a}', '#${S}')).toEqual(['n = #{a}', '']);
  });

  it('replace the selection by a plain symbol', () => {
    expect(insert('p and q', 'and', '∧')).toEqual(['p ∧ q', '']);
  });
});

describe('palette snippets at the cursor', () => {
  it('reuse a left operand', () => {
    const ed = editor('x = onLoan ');
    applySnippet(ed, '${A} ∪ ${B}');
    expect([ed.text(), ed.selected()]).toEqual(['x = onLoan ∪ B', 'B']);
  });
  it('insert the template with its fields', () => {
    const ed = editor('');
    applySnippet(ed, '${A} ∪ ${B}');
    expect([ed.text(), ed.selected()]).toEqual(['A ∪ B', 'A']);
  });
});
