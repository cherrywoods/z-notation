// Reactive spec state of the open topic, autosaved per topic in localStorage.
//
//   import { store } from '$lib/spec/store.svelte';
//   store.openTopic('medication');
//   store.current            // SpecDoc (deeply reactive; direct mutation is autosaved too)
//   store.updateSchema('state', { preds: '…' });

import type { SchemaDoc, SpecDoc } from './model';
import { CUSTOM_ID, createSpec, slug } from './topics';

const KEY = (topicId: string) => `ztut:v1:${topicId}`;
const SAVE_DELAY = 400;

function load(topicId: string): SpecDoc | null {
  try {
    const raw = localStorage.getItem(KEY(topicId));
    if (!raw) return null;
    const doc = JSON.parse(raw) as SpecDoc;
    const ok =
      doc &&
      doc.topicId === topicId &&
      typeof doc.given === 'string' &&
      doc.state?.role === 'state' &&
      Array.isArray(doc.operations);
    return ok ? doc : null;
  } catch {
    return null;
  }
}

function save(doc: SpecDoc) {
  try {
    localStorage.setItem(KEY(doc.topicId), JSON.stringify(doc));
  } catch {
    /* storage full or unavailable: the tutorial still works, just without persistence */
  }
}

function forget(topicId: string) {
  try {
    localStorage.removeItem(KEY(topicId));
  } catch {
    /* ignore */
  }
}

class SpecStore {
  /** The SpecDoc of the open topic (null before the first openTopic). */
  current = $state<SpecDoc | null>(null);

  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending: SpecDoc | null = null;
  /** JSON of the doc as opened; unchanged docs are not written (templates stay fresh). */
  #baseline = '';
  #dirty = false;

  constructor() {
    $effect.root(() => {
      $effect(() => {
        const doc = this.current;
        if (!doc) return;
        const json = JSON.stringify(doc); // tracks every field (deep)
        if (!this.#dirty && json === this.#baseline) return;
        this.#dirty = true;
        this.#schedule(doc);
      });
    });
    if (typeof window !== 'undefined') {
      const flush = () => this.flush();
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
    }
  }

  #schedule(doc: SpecDoc) {
    this.#pending = doc;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), SAVE_DELAY);
  }

  /** Write pending changes now. */
  flush() {
    clearTimeout(this.#timer);
    if (this.#pending) save($state.snapshot(this.#pending) as SpecDoc);
    this.#pending = null;
  }

  /**
   * Open a topic: the saved version if there is one, else a fresh copy of the template.
   * For the own topic, a `customTitle` different from the saved one starts a new spec.
   */
  openTopic(id: string, customTitle?: string) {
    this.flush();
    const title = customTitle?.trim();
    let doc = load(id);
    if (id === CUSTOM_ID && title && doc && doc.title !== title) doc = null;
    // a new own topic is saved right away (its title must survive a reload)
    this.#open(doc ?? createSpec(id, title), !doc && id === CUSTOM_ID);
  }

  #open(doc: SpecDoc, dirty: boolean) {
    this.#baseline = JSON.stringify(doc);
    this.#dirty = dirty;
    this.current = doc;
  }

  /** Saved title of the own topic (to pre-fill the start page), if any. */
  savedCustomTitle(): string | undefined {
    if (this.current?.topicId === CUSTOM_ID) return this.current.title;
    return load(CUSTOM_ID)?.title;
  }

  setGiven(text: string) {
    if (this.current) this.current.given = text;
  }

  /** The schema with this id ('state', 'init' or an operation id). */
  schema(id: string): SchemaDoc | undefined {
    const c = this.current;
    if (!c) return undefined;
    if (id === 'state') return c.state;
    if (id === 'init') return c.init ?? undefined;
    return c.operations.find((o) => o.id === id);
  }

  updateSchema(id: string, patch: Partial<SchemaDoc>) {
    const s = this.schema(id);
    if (s) Object.assign(s, { ...patch, id: s.id, role: s.role });
  }

  /** Append a new (update) operation and return it. */
  addOperation(): SchemaDoc {
    const c = this.current;
    if (!c) throw new Error('no topic open');
    const names = new Set(c.operations.map((o) => o.name));
    const ids = new Set(c.operations.map((o) => o.id));
    let n = c.operations.length + 1;
    while (names.has(`Operation${n}`) || ids.has(`op-${slug(`Operation${n}`)}`)) n++;
    const name = `Operation${n}`;
    const op: SchemaDoc = {
      id: `op-${slug(name)}`,
      role: 'operation',
      opKind: 'update',
      name,
      decls: `Δ${c.state.name}`,
      preds: '',
    };
    c.operations.push(op);
    return c.operations[c.operations.length - 1];
  }

  removeOperation(id: string) {
    const c = this.current;
    if (c) c.operations = c.operations.filter((o) => o.id !== id);
  }

  addInit() {
    const c = this.current;
    if (!c || c.init) return;
    c.init = { id: 'init', role: 'init', name: `Init${c.state.name}`, decls: c.state.name, preds: '' };
  }

  removeInit() {
    if (this.current) this.current.init = null;
  }

  /** Back to the template (own topic: blank skeleton with the same title). */
  resetTopic() {
    const c = this.current;
    if (!c) return;
    clearTimeout(this.#timer);
    this.#pending = null;
    forget(c.topicId);
    const custom = c.topicId === CUSTOM_ID;
    this.#open(createSpec(c.topicId, custom ? c.title : undefined), custom);
  }
}

export const store = new SpecStore();
