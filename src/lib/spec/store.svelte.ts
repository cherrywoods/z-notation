// Reactive spec state of the open topic, autosaved per topic in localStorage.
//
//   import { store } from '$lib/spec/store.svelte';
//   store.openTopic('medication');
//   store.current            // SpecDoc (deeply reactive; direct mutation is autosaved too)
//   store.updateSchema('state', { preds: '…' });

import { untrack } from 'svelte';
import type { SchemaDoc, SpecDoc } from './model';
import { CUSTOM_ID, createSpec, revisionOf, slug, stateNameOf, uniqueName } from './topics';
import { givenNames, renameStateRefs, schemaNameError, schemasOf } from './helpers';

// v2: systems start bare (names only). Saves from the pre-filled v1 are dropped.
const KEY = (topicId: string) => `ztut:v2:${topicId}`;

try {
  for (const k of Object.keys(localStorage)) if (k.startsWith('ztut:v1:')) localStorage.removeItem(k);
} catch {
  /* storage unavailable */
}
const SAVE_DELAY = 400;

const isSchema = (s: unknown): s is SchemaDoc =>
  !!s &&
  typeof s === 'object' &&
  typeof (s as SchemaDoc).id === 'string' &&
  typeof (s as SchemaDoc).name === 'string' &&
  typeof (s as SchemaDoc).decls === 'string' &&
  typeof (s as SchemaDoc).preds === 'string';

function wellFormed(doc: unknown, topicId: string): doc is SpecDoc {
  const d = doc as SpecDoc;
  return (
    !!d &&
    typeof d === 'object' &&
    d.topicId === topicId &&
    typeof d.title === 'string' &&
    typeof d.given === 'string' &&
    !!d.pools &&
    typeof d.pools === 'object' &&
    isSchema(d.state) &&
    d.state.role === 'state' &&
    (d.init === null || (isSchema(d.init) && d.init.role === 'init')) &&
    Array.isArray(d.operations) &&
    d.operations.every(isSchema)
  );
}

/**
 * Put aside a save made from an older revision of the template (`ztut:v2:<id>:old`, or
 * `:old2` for a revision-2 save, …); the topic then starts fresh.
 */
function retire(topicId: string, raw: string, revision: number) {
  try {
    localStorage.setItem(`${KEY(topicId)}:old${revision > 1 ? revision : ''}`, raw);
    localStorage.removeItem(KEY(topicId));
  } catch {
    /* ignore */
  }
}

function load(topicId: string): SpecDoc | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY(topicId));
    if (!raw) return null;
    const doc: unknown = JSON.parse(raw);
    if (wellFormed(doc, topicId)) {
      const revision = typeof doc.revision === 'number' ? doc.revision : 1;
      if (revision >= revisionOf(topicId)) return doc;
      retire(topicId, raw, revision);
      return null;
    }
  } catch {
    /* unparsable: back it up below */
  }
  // keep the unreadable save; the next save would overwrite it
  try {
    if (raw) localStorage.setItem(`${KEY(topicId)}:broken`, raw);
  } catch {
    /* ignore */
  }
  return null;
}

/** Write a doc; false if storage is full or unavailable (the tutorial still works). */
function save(doc: SpecDoc): boolean {
  try {
    localStorage.setItem(KEY(doc.topicId), JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

function forget(topicId: string) {
  try {
    localStorage.removeItem(KEY(topicId));
  } catch {
    /* ignore */
  }
}

/** Names a new schema must not take: the schema names and the given sets. */
const takenNames = (doc: SpecDoc) => [...schemasOf(doc).map((s) => s.name.trim()), ...givenNames(doc.given)];

/**
 * New title of the own topic. The state schema follows if its name still comes from the
 * old title (the student has not renamed it) and the new name is free. True if it did.
 */
function retitle(doc: SpecDoc, title: string): boolean {
  if (doc.title === title) return false;
  const from = doc.state.name.trim();
  const follow = from === stateNameOf(doc.title);
  doc.title = title;
  const to = stateNameOf(title);
  if (!follow || to === from || schemaNameError(doc, 'state', to)) return false;
  doc.state.name = to;
  renameStateRefs(doc, from, to);
  return true;
}

/** Steps whose examples are obsolete: the removed ones, or null for all (another doc). */
type StepsGone = (ids: string[] | null) => void;

class SpecStore {
  /** The SpecDoc of the open topic (null before the first openTopic). */
  current = $state<SpecDoc | null>(null);

  #timer: ReturnType<typeof setTimeout> | undefined;
  /**
   * JSON of the open doc as last written. A doc opened unchanged starts with its own
   * JSON, so it is only written once it changes (templates stay fresh); '' = write it.
   */
  #written = '';
  /** Docs whose last save failed (storage blocked or full), kept for this session. */
  #unsaved = new Map<string, SpecDoc>();
  /** The open doc is an own topic opened by a link, neither named nor saved yet. */
  #untitled = false;
  /** Last valid name of the state schema (renames update the references to it). */
  #stateName = '';
  #stepsGone: StepsGone[] = [];

  constructor() {
    $effect.root(() => {
      $effect(() => this.syncStateName());
      $effect(() => {
        const doc = this.current;
        if (!doc) return;
        // tracks every field (deep)
        if (JSON.stringify(doc) !== this.#written) this.#schedule();
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

  #schedule() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), SAVE_DELAY);
  }

  /** Write pending changes now. */
  flush() {
    clearTimeout(this.#timer);
    const doc = this.current;
    if (!doc) return;
    const snap = $state.snapshot(doc) as SpecDoc;
    const json = JSON.stringify(snap);
    if (json === this.#written) return;
    this.#written = json;
    this.#untitled = false;
    if (save(snap)) this.#unsaved.delete(snap.topicId);
    else this.#unsaved.set(snap.topicId, snap);
  }

  /**
   * Renaming the state schema (Ward → Hospital) updates ΔWard / ΞWard, the Init import
   * and InitWard. Invalid intermediate names (empty, "Hos pital") wait. Run by an effect.
   */
  syncStateName() {
    const doc = this.current;
    if (!doc) return;
    const name = doc.state.name.trim();
    if (name === this.#stateName || schemaNameError(doc, 'state', name)) return;
    const from = this.#stateName;
    this.#stateName = name;
    untrack(() => renameStateRefs(doc, from, name));
  }

  /** Called with the steps whose example seeds and modes are obsolete (see StepsGone). */
  onStepsGone(fn: StepsGone) {
    this.#stepsGone.push(fn);
  }

  /**
   * Open a topic: the open doc if it is the same topic, else the saved version, else a
   * fresh copy of the template. For the own topic, a `customTitle` renames it.
   */
  openTopic(id: string, customTitle?: string) {
    this.flush();
    const title = id === CUSTOM_ID ? customTitle?.trim() : undefined;
    const open = this.current;
    if (open?.topicId === id) {
      // keep it (with storage blocked, a reload would lose this session's work)
      if (!title) return;
      if (retitle(open, title)) this.#stateName = open.state.name;
      if (this.#untitled) {
        // named now: save it even if nothing else changed
        this.#untitled = false;
        this.#written = '';
        this.#schedule();
      }
      return;
    }
    const unsaved = this.#unsaved.get(id);
    const doc = unsaved ? structuredClone(unsaved) : load(id);
    if (doc) {
      const renamed = !!title && doc.title !== title;
      if (title) retitle(doc, title);
      this.#open(doc, !!unsaved || renamed);
    } else {
      // a new own topic named on the start page is saved at once (the title must
      // survive a reload); one opened by a link only once the student edits it
      this.#open(createSpec(id, title), id === CUSTOM_ID && !!title);
      this.#untitled = id === CUSTOM_ID && !title;
    }
  }

  /** Show `doc`; `write`: save it even if unchanged. */
  #open(doc: SpecDoc, write: boolean) {
    clearTimeout(this.#timer);
    this.#written = write ? '' : JSON.stringify(doc);
    this.#untitled = false;
    const name = doc.state.name.trim();
    this.#stateName = schemaNameError(doc, 'state', name) ? '' : name;
    this.current = doc;
    for (const fn of this.#stepsGone) fn(null);
    if (write) this.#schedule();
  }

  /** Title of the own topic to pre-fill the start page (saved or named), if any. */
  savedCustomTitle(): string | undefined {
    const c = this.current;
    if (c?.topicId === CUSTOM_ID) return this.#untitled && JSON.stringify(c) === this.#written ? undefined : c.title;
    return (this.#unsaved.get(CUSTOM_ID) ?? load(CUSTOM_ID))?.title;
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

  /**
   * The state schema's name for a new Δ/Ξ import or Init: its name, or while that is
   * being edited (empty, invalid), the last valid one; the import follows the next rename.
   */
  #stateRef(c: SpecDoc): string {
    const name = c.state.name.trim();
    if (!schemaNameError(c, 'state', name)) return name;
    if (!this.#stateName) this.#stateName = uniqueName('State', takenNames(c));
    return this.#stateName;
  }

  /** Append a new (update) operation and return it. */
  addOperation(): SchemaDoc {
    const c = this.current;
    if (!c) throw new Error('no topic open');
    const names = new Set(takenNames(c));
    const ids = new Set(c.operations.map((o) => o.id));
    let n = c.operations.length + 1;
    while (names.has(`Operation${n}`) || ids.has(`op-${slug(`Operation${n}`)}`)) n++;
    const name = `Operation${n}`;
    const op: SchemaDoc = {
      id: `op-${slug(name)}`,
      role: 'operation',
      opKind: 'update',
      name,
      decls: `Δ${this.#stateRef(c)}`,
      preds: '',
    };
    c.operations.push(op);
    return c.operations[c.operations.length - 1];
  }

  removeOperation(id: string) {
    const c = this.current;
    if (!c) return;
    c.operations = c.operations.filter((o) => o.id !== id);
    for (const fn of this.#stepsGone) fn([id]);
  }

  addInit() {
    const c = this.current;
    if (!c || c.init) return;
    const state = this.#stateRef(c);
    c.init = { id: 'init', role: 'init', name: uniqueName(`Init${state}`, takenNames(c)), decls: state, preds: '' };
  }

  removeInit() {
    if (!this.current) return;
    this.current.init = null;
    for (const fn of this.#stepsGone) fn(['init']);
  }

  /** Back to the template (own topic: blank skeleton with the same title). */
  resetTopic() {
    const c = this.current;
    if (!c) return;
    forget(c.topicId);
    this.#unsaved.delete(c.topicId);
    const custom = c.topicId === CUSTOM_ID;
    const untitled = custom && this.#untitled;
    this.#open(createSpec(c.topicId, custom ? c.title : undefined), custom && !untitled);
    this.#untitled = untitled;
  }
}

export const store = new SpecStore();
