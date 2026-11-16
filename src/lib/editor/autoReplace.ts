// Auto-replacement of ASCII shortcuts by Z symbols while typing (`->` → `→`,
// `-|>` → `⇸`, `in ` → `∈ `, …). Each replacement is its own undo step, so Ctrl+Z
// brings back the ASCII text (like autocorrect).

import { EditorView } from '@codemirror/view';
import { EditorSelection, Transaction, type Extension, type TransactionSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { ASCII_GLYPH_SHORTCUTS, ASCII_WORD_SHORTCUTS } from '../z/symbols';
import { isIdentChar, lex } from '../z/lexer';

const GLYPHS = ASCII_GLYPH_SHORTCUTS; // longest first
const WORDS = new Map(ASCII_WORD_SHORTCUTS.filter(([w]) => w !== 'Delta' && w !== 'Xi'));
const SCHEMA_WORDS = new Map<string, string>([
  ['Delta', 'Δ'],
  ['Xi', 'Ξ'],
]);

/** Is `s` a proper prefix of some longer glyph shortcut? (then we wait for the next key) */
function isProperPrefix(s: string): boolean {
  return GLYPHS.some(([a]) => a.length > s.length && a.startsWith(s));
}

/** Longest glyph shortcut that is a suffix of `s`. */
function glyphSuffix(s: string): [string, string] | undefined {
  return GLYPHS.find(([a]) => s.endsWith(a));
}

/** The identifier run directly before position `end` in `text` (or ''). */
function wordBefore(text: string, end: number): string {
  let i = end;
  while (i > 0 && isIdentChar(text[i - 1])) i--;
  return text.slice(i, end);
}

export interface Replacement {
  from: number; // in line-relative coordinates of `before`
  to: number;
  insert: string;
}

/**
 * Decide what to do when `typed` is typed after `before` (the text of the current line
 * up to the cursor). Returns the replacement to apply to `before + typed`, or null.
 * Exported for tests.
 */
export function computeReplacement(before: string, typed: string): Replacement | null {
  if (typed.length !== 1) return null;
  const s = before + typed;

  // 1. Delta/Xi followed by an uppercase letter or a space: ΔState
  if (/[A-Z ]/.test(typed)) {
    const w = wordBefore(before, before.length);
    const sym = SCHEMA_WORDS.get(w);
    const startOk = before.length - w.length === 0 || !isIdentChar(before[before.length - w.length - 1]);
    if (sym && startOk) {
      const from = before.length - w.length;
      // a space after Delta/Xi is swallowed: the schema name follows directly
      return { from, to: s.length, insert: typed === ' ' ? sym : sym + typed };
    }
  }

  // 2. Glyph shortcuts that are complete now (longest match wins). If the match could
  //    still grow into a longer shortcut (`<=` → `<=>`, `\` → `\/`), wait for the next key.
  const g = glyphSuffix(s);
  if (g) {
    if (!isProperPrefix(g[0])) return { from: s.length - g[0].length, to: s.length, insert: g[1] };
    return null;
  }

  // 3. A pending glyph shortcut (e.g. `<=` waiting for a possible `>`) that the typed
  //    character does not continue: replace it now and keep the typed character.
  const p = glyphSuffix(before);
  if (p && isProperPrefix(p[0]) && !GLYPHS.some(([a]) => a.startsWith(p[0] + typed))) {
    return { from: before.length - p[0].length, to: s.length, insert: p[1] + typed };
  }

  // 4. Word shortcuts (in, notin, union, inter, forall, exists, not, PP, NN, NN1, ZZ, RR),
  //    replaced when the word is finished by a non-identifier character.
  if (!isIdentChar(typed)) {
    const w = wordBefore(before, before.length);
    const sym = WORDS.get(w);
    const startOk = before.length - w.length === 0 || !isIdentChar(before[before.length - w.length - 1]);
    // don't replace a word followed by a decoration (e.g. an input called `in?`)
    if (sym && startOk && !['?', '!', "'", '′'].includes(typed)) {
      return { from: before.length - w.length, to: s.length, insert: sym + typed };
    }
  }
  return null;
}

/** Replace ASCII shortcuts in a whole text (used for paste and on blur). */
export function normalizeAscii(text: string): string {
  const toks = lex(text);
  let out = '';
  let pos = 0;
  for (const t of toks) {
    if (t.kind === 'eof') break;
    const src = text.slice(t.from, t.to);
    let rep: string | null = null;
    if ((t.kind === 'sym' || t.kind === 'keyword') && src !== t.value && !/^(dom|ran|div|mod)$/.test(t.value)) {
      // keep `{}` as ∅, `..` stays
      rep = t.value;
    } else if (t.kind === 'ident' && t.decoration === '′' && src.endsWith("'")) {
      rep = src.slice(0, -1) + '′';
    } else if (t.kind === 'ident' && /^(PP|NN|NN1|ZZ|RR)$/.test(src)) {
      rep = WORDS.get(src) ?? null;
    }
    if (rep !== null) {
      out += text.slice(pos, t.from) + rep;
      pos = t.to;
    }
  }
  return out + text.slice(pos);
}

function applyReplacement(view: EditorView, lineFrom: number, r: Replacement, typedSpec: TransactionSpec) {
  // First the plain typing (so Ctrl+Z after the replacement restores the ASCII text) …
  view.dispatch(typedSpec);
  // … then the replacement as a separate, isolated history event.
  const from = lineFrom + r.from;
  const to = lineFrom + r.to;
  view.dispatch({
    changes: { from, to, insert: r.insert },
    selection: EditorSelection.cursor(from + r.insert.length),
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.autoreplace')],
  });
}

export function autoReplace(): Extension {
  return [
    EditorView.inputHandler.of((view, from, to, text) => {
      if (text.length !== 1 || from !== to) return false;
      if (view.composing) return false;
      const line = view.state.doc.lineAt(from);
      const before = view.state.doc.sliceString(line.from, from);
      const r = computeReplacement(before, text);
      if (!r) return false;
      applyReplacement(view, line.from, r, {
        changes: { from, to, insert: text },
        selection: EditorSelection.cursor(from + text.length),
        userEvent: 'input.type',
      });
      return true;
    }),
    // Pasted ASCII is normalised in one go.
    EditorView.domEventHandlers({
      paste(event, view) {
        const text = event.clipboardData?.getData('text/plain');
        if (!text) return false;
        const norm = normalizeAscii(text);
        if (norm === text) return false;
        event.preventDefault();
        view.dispatch(view.state.replaceSelection(norm), { userEvent: 'input.paste', scrollIntoView: true });
        return true;
      },
      blur(_event, view) {
        // flush pending shortcuts (e.g. a trailing `<=`), and anything typed via IME
        const text = view.state.doc.toString();
        const norm = normalizeAscii(text);
        if (norm !== text) {
          view.dispatch({
            changes: { from: 0, to: text.length, insert: norm },
            annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.autoreplace')],
          });
        }
        return false;
      },
    }),
  ];
}
