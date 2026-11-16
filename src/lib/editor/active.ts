// Tracks the editor that last had focus, so the symbol library can insert into it.

import { EditorView } from '@codemirror/view';
import { insertSnippet } from './zEditor';

let active: EditorView | null = null;
const listeners = new Set<(v: EditorView | null) => void>();

export function setActiveEditor(view: EditorView | null) {
  active = view;
  for (const l of listeners) l(active);
}

export function getActiveEditor(): EditorView | null {
  // a destroyed view has no parent anymore
  if (active && !active.dom.isConnected) active = null;
  return active;
}

export function forgetEditor(view: EditorView) {
  if (active === view) setActiveEditor(null);
}

export function onActiveEditorChange(fn: (v: EditorView | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Insert into the active editor; falls back to the first editor on the page. */
export function insertIntoActive(template: string): boolean {
  let view = getActiveEditor();
  if (!view) {
    const dom = document.querySelector<HTMLElement>('.cm-editor');
    view = dom ? EditorView.findFromDOM(dom) : null;
  }
  if (!view) return false;
  insertSnippet(view, template);
  return true;
}
