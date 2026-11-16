// Plain-DOM rendering of Z text with the same highlighting classes as the editor
// (for CodeMirror tooltips, which are created outside Svelte).

import { highlight } from '../z/lexer';

export function renderZ(text: string, givenSets: ReadonlySet<string> = new Set()): HTMLSpanElement {
  const root = document.createElement('span');
  root.className = 'z-text z-inline';
  let pos = 0;
  for (const s of highlight(text, givenSets)) {
    if (s.from > pos) root.append(text.slice(pos, s.from));
    const span = document.createElement('span');
    span.className = s.cls;
    span.textContent = text.slice(s.from, s.to);
    root.append(span);
    pos = s.to;
  }
  if (pos < text.length) root.append(text.slice(pos));
  return root;
}
