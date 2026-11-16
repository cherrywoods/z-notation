// A small library (book loans) specification, used as a test fixture.

import type { SpecDoc } from '../../spec/model';

export const LIBRARY: SpecDoc = {
  topicId: 'library',
  title: 'Library',
  given: '[BOOK, MEMBER]',
  pools: {
    BOOK: ['Dune', 'Emma', 'Hamlet', 'Ulysses', 'Beloved', 'Ivanhoe', 'Walden', 'Persuasion'],
    MEMBER: ['Ada', 'Ben', 'Cleo', 'Dev', 'Eva', 'Finn', 'Gus', 'Hana'],
  },
  state: {
    id: 'state',
    role: 'state',
    name: 'Library',
    decls: 'onLoan : ℙ BOOK\nborrower : BOOK ⇸ MEMBER',
    preds: 'onLoan = dom borrower',
  },
  init: {
    id: 'init',
    role: 'init',
    name: 'InitLibrary',
    decls: 'Library',
    preds: 'onLoan = ∅',
  },
  operations: [
    {
      id: 'op-find',
      role: 'operation',
      opKind: 'query',
      name: 'FindBorrower',
      decls: 'ΞLibrary\nbook? : BOOK\nmember! : MEMBER',
      preds: 'book? ∈ onLoan\nmember! = borrower(book?)',
    },
    {
      id: 'op-lend',
      role: 'operation',
      opKind: 'update',
      name: 'Lend',
      decls: 'ΔLibrary\nbook? : BOOK\nmember? : MEMBER',
      preds: 'book? ∉ onLoan\nborrower′ = borrower ∪ {book? ↦ member?}',
    },
  ],
};

/** LoansOf, useful as an extra test case (set comprehension over the state). */
export const LOANS_OF = {
  id: 'op-loans',
  role: 'operation' as const,
  opKind: 'query' as const,
  name: 'LoansOf',
  decls: 'ΞLibrary\nmember? : MEMBER\nbooks! : ℙ BOOK',
  preds: 'books! = { b ∈ onLoan | borrower(b) = member? }',
};
