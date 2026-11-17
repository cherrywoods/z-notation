// CodeMirror 6 setup for editing Z text: symbol highlighting with explainer hovers,
// ASCII auto-replacement, snippet insertion (SymbolLibrary palette) and diagnostics.

import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  placeholder as placeholderExt,
  drawSelection,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { EditorState, StateEffect, StateField, RangeSetBuilder, Compartment, type Extension, type Transaction } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { snippet } from '@codemirror/autocomplete';
import { linter, setDiagnostics, forEachDiagnostic, type Diagnostic } from '@codemirror/lint';
import { highlight, isIdentChar } from '../z/lexer';
import { autoReplace } from './autoReplace';
import { renderZ } from './renderZ';
import { explain, type ExplainerContext } from '../../ui/explain/explain.svelte';
import type { ZDiagnostic, Derivation } from '../spec/model';

// ── context shared with the highlighter / hover (given-set names, Δ/Ξ context) ──

export interface ZEditorContext {
  givenSets: string[];
  explainCtx?: ExplainerContext;
}

const setContext = StateEffect.define<ZEditorContext>();
const contextField = StateField.define<ZEditorContext>({
  create: () => ({ givenSets: [] }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setContext)) value = e.value;
    return value;
  },
});

// ── highlighting ─────────────────────────────────────────────────────────────

function buildDecorations(view: EditorView): DecorationSet {
  const ctx = view.state.field(contextField);
  const text = view.state.doc.toString();
  const builder = new RangeSetBuilder<Decoration>();
  const spans = highlight(text, new Set(ctx.givenSets));
  for (const s of spans) {
    if (s.to <= s.from) continue;
    const attrs: Record<string, string> = { class: s.cls };
    if (s.explain) attrs['data-explain'] = s.explain;
    builder.add(s.from, s.to, Decoration.mark({ attributes: attrs }));
  }
  return builder.finish();
}

const zHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(setContext)))) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ── explainer hover / click ─────────────────────────────────────────────────

function insideDiagnostic(view: EditorView, pos: number): boolean {
  let found = false;
  forEachDiagnostic(view.state, (d, from, to) => {
    if (pos >= from && pos <= to) found = true;
  });
  return found;
}

let hovered: Element | null = null;

/** The decorated name or given-set name around `pos` (e.g. `prescribed′`, `p?`, `PATIENT`). */
function subjectAt(view: EditorView, pos: number): string | undefined {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  let i = pos - line.from;
  // the hovered span may be the decoration itself: step back onto the name
  if (i > 0 && /[′'?!]/.test(text[i] ?? '') && isIdentChar(text[i - 1])) i--;
  let a = i;
  let b = i;
  while (a > 0 && isIdentChar(text[a - 1])) a--;
  while (b < text.length && isIdentChar(text[b])) b++;
  if (a === b) return undefined;
  const deco = /[′'?!]/.test(text[b] ?? '') ? text[b].replace("'", '′') : '';
  return text.slice(a, b) + deco;
}

function explainRequest(view: EditorView, target: Element, pinned: boolean) {
  const id = target.getAttribute('data-explain')!;
  const ctx = view.state.field(contextField);
  let subject: string | undefined;
  if (id === 'prime' || id === 'input' || id === 'output' || id === 'given') {
    subject = subjectAt(view, view.posAtDOM(target));
  }
  return {
    id,
    anchor: target.getBoundingClientRect(),
    source: target,
    pinned,
    ctx: { ...ctx.explainCtx, givenSets: ctx.givenSets, subject },
  };
}

const explainHover = EditorView.domEventHandlers({
  mousemove(event, view) {
    const target = (event.target as Element | null)?.closest?.('[data-explain]') ?? null;
    if (target === hovered) return false;
    hovered = target;
    if (!target) {
      explain.hide();
      return false;
    }
    const pos = view.posAtDOM(target);
    if (insideDiagnostic(view, pos)) {
      explain.hide();
      return false;
    }
    explain.show(explainRequest(view, target, false));
    return false;
  },
  mouseleave() {
    hovered = null;
    explain.hide();
    return false;
  },
  click(event, view) {
    // pointer clicks pin the explainer; touch taps only place the caret
    if ((event as PointerEvent).pointerType === 'touch') return false;
    const target = (event.target as Element | null)?.closest?.('[data-explain]');
    if (!target) return false;
    explain.show(explainRequest(view, target, true));
    return false; // keep normal caret placement
  },
});

// ── diagnostics ─────────────────────────────────────────────────────────────

function renderDerivation(d: Derivation): HTMLElement {
  const box = document.createElement('div');
  box.className = 'z-derivation-mini';
  if (d.kind === 'chain') {
    const head = document.createElement('div');
    head.append(renderZ(d.start));
    box.append(head);
    for (const s of d.steps) {
      const row = document.createElement('div');
      row.className = 'z-derivation-step';
      const expr = renderZ(`${s.rel} ${s.expr}`);
      const why = document.createElement('span');
      why.className = 'z-derivation-reason';
      why.textContent = `[${s.reason}]`;
      row.append(expr, why);
      box.append(row);
    }
  } else {
    for (const p of d.premises) {
      const row = document.createElement('div');
      row.className = 'z-derivation-step';
      const expr = renderZ(p.text);
      const why = document.createElement('span');
      why.className = 'z-derivation-reason';
      why.textContent = `[${p.reason}]`;
      row.append(expr, why);
      box.append(row);
    }
    const c = document.createElement('div');
    c.className = 'z-derivation-conclusion';
    c.append(renderZ(`⊢ ${d.conclusion}`));
    box.append(c);
  }
  return box;
}

export function toCmDiagnostics(diags: ZDiagnostic[], docLength: number): Diagnostic[] {
  return diags.map((d) => {
    const from = Math.max(0, Math.min(d.from, docLength));
    const to = Math.max(from, Math.min(d.to, docLength));
    const cm: Diagnostic = {
      from,
      to,
      severity: d.kind === 'redundant' ? 'info' : d.severity === 'info' ? 'info' : d.severity,
      message: d.message,
      markClass: d.kind === 'redundant' ? 'z-redundant' : undefined,
    };
    if (d.derivation) {
      const der = d.derivation;
      cm.renderMessage = () => {
        const wrap = document.createElement('div');
        const msg = document.createElement('div');
        msg.textContent = d.message;
        wrap.append(msg, renderDerivation(der));
        return wrap;
      };
    }
    return cm;
  });
}

// ── theme ───────────────────────────────────────────────────────────────────

/** The stylus icon of the prompts (src/ui/views/Prompt.svelte) as a CSS mask. */
const STYLUS = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linejoin='round'><path d='M2.5 13.5h3l7.4-7.4a1.4 1.4 0 0 0 0-2l-1-1a1.4 1.4 0 0 0-2 0L2.5 10.5v3Z'/></svg>",
)}")`;

const zTheme = EditorView.theme({
  '&': {
    fontFamily: 'var(--font-z)',
    fontSize: '1.15rem',
    background: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-z)', lineHeight: '1.65', overflow: 'visible' },
  '.cm-content': { padding: '2px 0', caretColor: 'var(--fg)' },
  '.cm-line': { padding: '0 4px' },
  '.cm-placeholder': {
    fontFamily: 'var(--font-ui)',
    fontSize: '0.95rem',
    fontStyle: 'normal',
    color: 'var(--ui-fg)',
  },
  // one prompt per line, each with the same stylus as the step prompts
  '.z-ph-line': { display: 'block' },
  '.z-ph-line::before': {
    content: '""',
    display: 'inline-block',
    width: '15px',
    height: '15px',
    marginRight: '10px',
    verticalAlign: '-2px',
    backgroundColor: 'currentColor',
    maskImage: STYLUS,
    WebkitMaskImage: STYLUS,
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
  },
  // On an empty line CodeMirror may measure the caret next to the placeholder with
  // height 0; keep it visible.
  '.cm-cursor': { borderLeftColor: 'var(--fg)', borderLeftWidth: '1.5px', minHeight: '1.25em' },
  // focused and still empty: the prompt steps back so the caret stands out
  '&.cm-focused .cm-placeholder': { opacity: '0.55' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    background: '#b6e3ff !important',
  },
  '.cm-snippetField': {
    background: 'var(--diff-added-bg)',
    outline: '1.5px dashed var(--z-type)',
    outlineOffset: '1px',
    borderRadius: '3px',
  },
  '.cm-snippetFieldPosition': {
    borderLeft: '1.5px dashed var(--z-type)',
  },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--error)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy #9a6700',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-info': {
    backgroundImage: 'none',
    textDecoration: 'underline dotted var(--info)',
    textDecorationThickness: '2px',
    textUnderlineOffset: '4px',
  },
  '.cm-tooltip': {
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-md)',
    background: 'var(--bg)',
  },
  '.cm-tooltip.cm-tooltip-lint': {
    padding: '2px',
    maxWidth: '440px',
  },
  '.cm-diagnostic': {
    padding: '6px 10px',
    borderLeftWidth: '3px',
    fontFamily: 'var(--font-ui)',
    fontSize: '0.88rem',
    lineHeight: '1.4',
  },
  '.cm-diagnostic .z-text': { fontSize: '1rem' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--error)' },
  '.cm-diagnostic-info': { borderLeftColor: 'var(--info)' },
  '.z-derivation-mini': { marginTop: '6px', fontSize: '1rem' },
  '.z-derivation-step': { display: 'flex', gap: '14px', justifyContent: 'space-between', alignItems: 'baseline' },
  '.z-derivation-conclusion': { marginTop: '2px' },
  '.z-derivation-reason': { fontFamily: 'var(--font-ui)', fontSize: '0.8rem', color: 'var(--fg-muted)' },
});

// ── public API ──────────────────────────────────────────────────────────────

export interface CreateOptions {
  parent: HTMLElement;
  doc: string;
  placeholder?: string;
  context: ZEditorContext;
  ariaLabel?: string;
  onChange?: (text: string) => void;
  onFocus?: (view: EditorView) => void;
  onBlur?: (view: EditorView) => void;
  /** Move focus to a neighbouring editor (ArrowDown at the end / ArrowUp at the start). */
  onEdge?: (dir: 'next' | 'prev') => boolean;
}

/** Placeholder text → element with one line (and stylus) per `\n`-separated prompt. */
function placeholderDom(text: string): HTMLElement {
  const root = document.createElement('span');
  for (const line of text.split('\n')) {
    const el = document.createElement('span');
    el.className = 'z-ph-line';
    el.textContent = line;
    root.append(el);
  }
  return root;
}

export function createZEditor(opts: CreateOptions): EditorView {
  const editable = new Compartment();
  const extensions: Extension[] = [
    contextField.init(() => opts.context),
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    autoReplace(),
    zHighlighter,
    explainHover,
    linter(null, { delay: 0 }),
    keymap.of([
      {
        key: 'ArrowDown',
        run: (v) => {
          const sel = v.state.selection.main;
          if (sel.empty && v.state.doc.lineAt(sel.head).number === v.state.doc.lines && opts.onEdge) return opts.onEdge('next');
          return false;
        },
      },
      {
        key: 'ArrowUp',
        run: (v) => {
          const sel = v.state.selection.main;
          if (sel.empty && v.state.doc.lineAt(sel.head).number === 1 && opts.onEdge) return opts.onEdge('prev');
          return false;
        },
      },
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    zTheme,
    editable.of(EditorView.editable.of(true)),
    EditorView.contentAttributes.of({ 'aria-label': opts.ariaLabel ?? 'Z text', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange?.(u.state.doc.toString());
      if (u.focusChanged) {
        if (u.view.hasFocus) opts.onFocus?.(u.view);
        else opts.onBlur?.(u.view);
      }
    }),
  ];
  if (opts.placeholder) extensions.push(placeholderExt(placeholderDom(opts.placeholder)));
  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({ doc: opts.doc, extensions }),
  });
  return view;
}

export function setEditorContext(view: EditorView, ctx: ZEditorContext) {
  view.dispatch({ effects: setContext.of(ctx) });
}

export function setEditorDiagnostics(view: EditorView, diags: ZDiagnostic[]) {
  view.dispatch(setDiagnostics(view.state, toCmDiagnostics(diags, view.state.doc.length)));
}

/** Replace the whole document (external change), keeping it out of the undo history's way. */
export function setEditorText(view: EditorView, text: string) {
  if (view.state.doc.toString() === text) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

/**
 * Insert a SymbolLibrary snippet at the cursor. `template` uses `${X}` fields.
 * If text directly before the cursor looks like a left operand (identifier, `)` or
 * `}`), a binary snippet `${X} op ${Y}` reuses it: `NAME|` + ⇸ → `NAME ⇸ ${Y}`.
 * A selection becomes the content of the first field, exactly as it is.
 */
export function insertSnippet(view: EditorView, template: string) {
  applySnippet(view, template);
  view.focus();
}

/** Where `applySnippet` inserts: an EditorView, or a stand-in (tests). */
export interface SnippetTarget {
  readonly state: EditorState;
  dispatch(tr: Transaction): void;
}

/** The document change of `insertSnippet` (exported for tests). */
export function applySnippet(target: SnippetTarget, template: string): void {
  const { state } = target;
  const sel = state.selection.main;
  let from = sel.from;
  let to = sel.to;
  let tpl = template;
  const field = /[#$]\{[^}]*\}/.exec(template);
  if (sel.empty) {
    const binary = /^\$\{[^}]*\} (\S+) /.exec(template);
    if (binary) {
      const line = state.doc.lineAt(from);
      const before = state.doc.sliceString(line.from, from);
      const trimmed = before.replace(/ +$/, '');
      const last = trimmed[trimmed.length - 1];
      if (last && (isIdentChar(last) || last === ')' || last === '}' || last === '′' || last === '?' || last === '!')) {
        // drop the first field; normalise spacing to exactly one space before the operator
        from = line.from + trimmed.length;
        tpl = ' ' + template.slice(binary[0].length - binary[1].length - 1);
      }
    }
  } else if (field) {
    // The selection fills the first field. It is not a field itself, so it is neither
    // linked to the other fields nor re-read as snippet syntax.
    const selected = state.sliceDoc(sel.from, sel.to);
    const before = template.slice(0, field.index);
    const after = template.slice(field.index + field[0].length);
    if (!/[#$]\{/.test(after)) {
      // no field left: plain text (`dom` + selection)
      target.dispatch(state.update(state.replaceSelection(before + selected + after), { userEvent: 'input' }));
      return;
    }
    if (!before) {
      // `${A} ∪ ${B}`: keep the selection where it is and add the rest after it
      from = to = sel.to;
      tpl = after;
    } else {
      const indent = /^\s*/.exec(state.doc.lineAt(sel.from).text)![0];
      tpl = before + literalSnippetText(selected, indent) + after;
    }
  }
  if (!tpl.includes('${')) {
    target.dispatch(state.update(state.replaceSelection(tpl), { userEvent: 'input' }));
    return;
  }
  snippet(tpl)(target, null, from, to);
}

/**
 * `text` as literal text inside a snippet template: braces escaped. The snippet indents
 * every further line like the line it starts on, so that indentation is taken off first.
 */
function literalSnippetText(text: string, indent: string): string {
  return text
    .split('\n')
    .map((l, i) => (i > 0 && indent && l.startsWith(indent) ? l.slice(indent.length) : l))
    .join('\n')
    .replace(/[{}]/g, '\\$&');
}
