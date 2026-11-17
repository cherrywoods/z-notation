// Store and live example state, run without the browser: in vitest the Svelte runes
// compile for the server, so $state is plain data and effects do not run (saves are
// written with store.flush()).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOM_ID, createSpec, revisionOf } from './topics';
import { schemaNameError } from './helpers';

// fresh singletons per test (the store keeps unsaved docs for the session)
let store: typeof import('./store.svelte').store;
let live: typeof import('./live.svelte').live;

class MemoryStorage {
  map = new Map<string, string>();
  blocked = false;
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    if (this.blocked) throw new Error('blocked');
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.blocked) throw new Error('blocked');
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    if (this.blocked) throw new Error('blocked');
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

let storage: MemoryStorage;
const saved = (id: string) => {
  const raw = storage.map.get(`ztut:v2:${id}`);
  return raw ? JSON.parse(raw) : null;
};

beforeEach(async () => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
  ({ store } = await import('./store.svelte'));
  ({ live } = await import('./live.svelte'));
});

describe('own topic title', () => {
  it('renaming keeps the spec; an unedited state name follows the title', () => {
    store.openTopic(CUSTOM_ID, 'Libary');
    expect(store.current!.state.name).toBe('Libary');
    store.current!.state.decls = 'books : ℙ BOOK';
    store.current!.operations[1].decls = 'ΔLibary\nb? : BOOK';
    store.flush();
    store.openTopic('bank-account');

    store.openTopic(CUSTOM_ID, 'Library');
    store.flush();
    const c = store.current!;
    expect(c.title).toBe('Library');
    expect(c.state.decls).toBe('books : ℙ BOOK');
    expect(c.state.name).toBe('Library');
    expect(c.operations.map((o) => o.decls)).toEqual(['ΞLibrary', 'ΔLibrary\nb? : BOOK']);
    expect(c.init?.name).toBe('InitLibrary');
    expect(saved(CUSTOM_ID).title).toBe('Library');
    expect(saved(CUSTOM_ID).state.decls).toBe('books : ℙ BOOK');
  });

  it('a state name the student chose stays', () => {
    store.openTopic(CUSTOM_ID, 'Libary');
    store.current!.state.name = 'Shelf';
    store.openTopic(CUSTOM_ID, 'Library'); // same topic still open: renamed in place
    expect(store.current!.title).toBe('Library');
    expect(store.current!.state.name).toBe('Shelf');
  });

  it('a link to an own topic that does not exist is not saved until edited', () => {
    store.openTopic(CUSTOM_ID);
    store.flush();
    expect(saved(CUSTOM_ID)).toBeNull();
    expect(store.savedCustomTitle()).toBeUndefined();
    store.openTopic(CUSTOM_ID, 'Garage');
    store.flush();
    expect(saved(CUSTOM_ID).title).toBe('Garage');
    expect(store.current!.state.name).toBe('Garage');
    expect(store.savedCustomTitle()).toBe('Garage');
  });
});

describe('schema names', () => {
  it('a fresh own topic has no name clashes', () => {
    for (const title of ['Query', 'Update', 'Init System', 'x']) {
      const spec = createSpec(CUSTOM_ID, title);
      for (const s of [spec.state, spec.init!, ...spec.operations])
        expect(schemaNameError(spec, s.id, s.name), `${title}: ${s.name}`).toBeNull();
    }
  });

  it('a new operation avoids the state name', () => {
    store.openTopic(CUSTOM_ID, 'Shop');
    store.current!.state.name = 'Operation3';
    const op = store.addOperation();
    expect(op.name).not.toBe('Operation3');
    expect(schemaNameError(store.current!, op.id, op.name)).toBeNull();
  });

  it('while the state name is invalid, new imports use the last valid one', () => {
    store.openTopic(CUSTOM_ID, 'Shop');
    store.current!.state.name = '';
    expect(store.addOperation().decls).toBe('ΔShop');
    store.removeInit();
    store.addInit();
    expect(store.current!.init).toMatchObject({ name: 'InitShop', decls: 'Shop' });
    // the rename effect: the new imports follow
    store.current!.state.name = 'Store';
    store.syncStateName();
    expect(store.current!.operations.at(-1)!.decls).toBe('ΔStore');
    expect(store.current!.init).toMatchObject({ name: 'InitStore', decls: 'Store' });
  });

  it('a saved spec with an invalid state name gets a placeholder that a rename repairs', () => {
    const spec = createSpec(CUSTOM_ID, 'Shop');
    spec.state.name = '';
    storage.setItem(`ztut:v2:${CUSTOM_ID}`, JSON.stringify(spec));
    store.openTopic(CUSTOM_ID);
    const op = store.addOperation();
    expect(op.decls).toMatch(/^Δ\w+$/);
    store.current!.state.name = 'Till';
    store.syncStateName();
    expect(store.schema(op.id)!.decls).toBe('ΔTill');
  });
});

describe('storage blocked', () => {
  it('re-opening the open topic keeps this session’s work', () => {
    store.openTopic('bank-account');
    storage.blocked = true;
    store.current!.given = '[PERSON]';
    store.flush();
    store.openTopic('bank-account');
    expect(store.current!.given).toBe('[PERSON]');
  });

  it('switching topics keeps unsaved work for the session', () => {
    storage.blocked = true;
    store.openTopic('bank-account');
    store.current!.given = '[PERSON]';
    store.openTopic('medication');
    store.openTopic('bank-account');
    expect(store.current!.given).toBe('[PERSON]');
  });
});

describe('template revisions', () => {
  it('a save of an older revision is put aside and the topic starts fresh', () => {
    expect(revisionOf('bank-account')).toBeGreaterThan(1);
    const old = createSpec('bank-account');
    delete old.revision; // saved by a version without revisions
    old.given = '[CUSTOMER]';
    const oldRaw = JSON.stringify(old);
    storage.setItem('ztut:v2:bank-account', oldRaw);
    const med = createSpec('medication');
    med.given = '[PATIENT]';
    const medRaw = JSON.stringify(med);
    storage.setItem('ztut:v2:medication', medRaw);

    store.openTopic('bank-account');
    expect(store.current!.given).toBe('[]');
    expect(storage.map.get('ztut:v2:bank-account:old')).toBe(oldRaw);
    expect(storage.map.has('ztut:v2:bank-account')).toBe(false);

    // new work carries the revision and loads again
    store.current!.given = '[PERSON]';
    store.openTopic('medication');
    expect(store.current!.given).toBe('[PATIENT]'); // other topics: untouched
    expect(storage.map.get('ztut:v2:medication')).toBe(medRaw);
    expect(saved('bank-account').revision).toBe(revisionOf('bank-account'));
    store.openTopic('bank-account');
    expect(store.current!.given).toBe('[PERSON]');
    expect(storage.map.get('ztut:v2:bank-account:old')).toBe(oldRaw);
  });

  it('topics without a revision keep revision 1 and no field', () => {
    expect(revisionOf('medication')).toBe(1);
    expect(revisionOf(CUSTOM_ID)).toBe(1);
    expect(createSpec('medication').revision).toBeUndefined();
    expect(createSpec(CUSTOM_ID, 'Shop').revision).toBeUndefined();
  });
});

describe('example seeds and modes', () => {
  it('are reset when a step is removed', () => {
    store.openTopic(CUSTOM_ID, 'Shop');
    const op = store.addOperation();
    live.modes[op.id] = 'blocked';
    live.regenerate(op.id);
    const seed = live.seedFor(op.id);
    store.removeOperation(op.id);
    const again = store.addOperation();
    expect(again.id).toBe(op.id);
    expect(live.modes[again.id]).toBeUndefined();
    expect(live.seedFor(again.id)).not.toBe(seed);
    live.modes.init = 'blocked';
    store.removeInit();
    expect(live.modes.init).toBeUndefined();
  });

  it('are reset when another topic is opened, kept when the same one is re-opened', () => {
    store.openTopic('bank-account');
    live.modes['op-x'] = 'blocked';
    live.regenerate('state');
    const seed = live.seedFor('state');
    store.openTopic('bank-account');
    expect(live.modes['op-x']).toBe('blocked');
    expect(live.seedFor('state')).toBe(seed);
    store.openTopic('medication');
    expect(live.modes['op-x']).toBeUndefined();
    expect(live.seeds.state).toBeUndefined();
  });
});
