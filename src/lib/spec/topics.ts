// Topics: the target systems from templates/*.json (tutorial format, see docs/design.md
// "Template format") and the student's own topic 'custom'.

import { DEFAULT_SETS } from './defaults';
import type { OpKind, SchemaDoc, SchemaRole, SpecDoc } from './model';
import { DEFAULT_GIVEN_SETS } from '../content/defaultTypes';

/** What the start page needs to show a topic bubble. */
export interface TopicInfo {
  id: string;
  /** Title of the system (in the templates the same as `short`). */
  title: string;
  /** The system's name: bubble label and tutorial header (≤ ~26 characters, wraps to two lines). */
  short: string;
  /** Lucide icon name (kebab-case). */
  icon: string;
  /** One-line teaser (≤ 70 characters). */
  blurb: string;
}

export const CUSTOM_ID = 'custom';

// ── template format ──────────────────────────────────────────────────────────

interface TemplateLine {
  text: string;
  requirements?: string[];
  comment?: string;
  hidden?: boolean;
}
interface TemplateSchema {
  /** State only: placeholder for the empty predicate part (the key safety property). */
  invariantPrompt?: string;
  name: string;
  kind?: OpKind;
  prompt?: string;
  declarations?: TemplateLine[];
  predicates?: TemplateLine[];
}
interface Template {
  id?: string;
  /**
   * Bump it when a change makes old saves misleading (renamed types or variables, so
   * goals and examples no longer fit). Saves of an older revision are put aside and the
   * topic starts fresh (see store.svelte.ts). Missing = 1.
   */
  revision?: number;
  title: string;
  short?: string;
  icon?: string;
  blurb?: string;
  description?: string;
  /** The System step's bullet points (context for students), about four short sentences. */
  card?: string[] | string;
  typesPrompt?: string;
  requirements?: { id: string; text: string }[];
  givenSets?: { name: string; values?: string[]; comment?: string; hidden?: boolean; infinite?: boolean }[];
  state: TemplateSchema;
  init?: TemplateSchema | null;
  operations?: TemplateSchema[];
  /** Z set displays for fixed-data state variables, e.g. { maxDose: '{aspirin ↦ 4000, …}' }. */
  fixedValues?: Record<string, string>;
  /** Further given sets offered in the Types tool bar (besides givenSets). */
  typeOptions?: { name: string; values?: string[]; infinite?: boolean }[];
  /** Step goals (docs/design.md "Step goals"). */
  goals?: TemplateGoals;
}

/** How a goal is checked (names refer to the template's reference spec). */
export interface GoalCheck {
  given?: string;
  var?: string | string[];
  holds?: string;
}
export interface Goal {
  text: string;
  check: GoalCheck;
}
/** Goals per step: Types, State, Init, and operations by their template name. */
export interface TemplateGoals {
  types?: Goal[];
  state?: Goal[];
  init?: Goal[];
  ops?: Record<string, Goal[]>;
}

/**
 * Order on the start page, from the simplest system to the most complex (the own
 * topic comes last). The ring places them anti-clockwise from its east-most slot.
 * Unknown ids follow alphabetically.
 */
const ORDER = [
  'bank-account',
  'medication',
  'air-traffic-control',
  'railway-interlocking',
  'blood-transfusion',
  'access-control',
];

const files = import.meta.glob('/templates/*.json', { eager: true, import: 'default' }) as Record<
  string,
  unknown
>;

function isTemplate(x: unknown): x is Template {
  if (!x || typeof x !== 'object') return false;
  const t = x as Partial<Template>;
  return (
    typeof t.title === 'string' &&
    !!t.state &&
    typeof t.state === 'object' &&
    typeof t.state.name === 'string'
  );
}

const TEMPLATES = new Map<string, Template>();
for (const [path, data] of Object.entries(files)) {
  const fileId = path.replace(/^.*\//, '').replace(/\.json$/, '');
  if (!isTemplate(data)) {
    console.warn(`[topics] skipping ${path}: not in the tutorial template format (no "state")`);
    continue;
  }
  TEMPLATES.set(fileId, data);
}

const rank = (id: string) => {
  const i = ORDER.indexOf(id);
  return i < 0 ? ORDER.length : i;
};

export const TOPICS: TopicInfo[] = [...TEMPLATES.entries()]
  .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
  .map(([id, t]) => ({
    id,
    title: t.title,
    short: t.short ?? t.title,
    icon: t.icon ?? 'box',
    blurb: t.blurb ?? '',
  }));

/** The own-topic bubble (not part of TOPICS). */
export const CUSTOM_TOPIC: TopicInfo = {
  id: CUSTOM_ID,
  title: 'Own topic',
  short: 'Own topic',
  icon: 'pencil',
  blurb: 'Specify a system of your own.',
};

/** Is `id` a topic that can be opened (listed or custom)? */
export function hasTopic(id: string): boolean {
  return id === CUSTOM_ID || TEMPLATES.has(id);
}

/** The topic's name as on its bubble (undefined for the own topic). */
export function topicName(id: string): string | undefined {
  return TOPICS.find((t) => t.id === id)?.short;
}

/** Template revision of a topic (1 unless the template says otherwise; own topic: 1). */
export function revisionOf(id: string): number {
  const r = TEMPLATES.get(id)?.revision;
  return typeof r === 'number' && r > 1 ? r : 1;
}

/** The step goals of a template topic (undefined for the own topic). */
export function goalsOf(id: string): TemplateGoals | undefined {
  return TEMPLATES.get(id)?.goals;
}

/** Operation id (as createSpec assigns them) → the template's operation name. */
function opNames(t: Template): Map<string, string> {
  const ids = new Map<string, string>();
  for (const op of t.operations ?? []) {
    let id = `op-${slug(op.name) || 'operation'}`;
    for (let n = 2; ids.has(id); n++) id = `op-${slug(op.name)}-${n}`;
    ids.set(id, op.name);
  }
  return ids;
}

/** The goals of one step ('types', 'state', 'init' or an operation id); [] if none. */
export function stepGoalsOf(topicId: string, stepId: string): Goal[] {
  const t = TEMPLATES.get(topicId);
  const g = t?.goals;
  if (!t || !g) return [];
  if (stepId === 'types' || stepId === 'state' || stepId === 'init') return g[stepId] ?? [];
  const name = opNames(t).get(stepId);
  return (name && g.ops?.[name]) || [];
}

/**
 * The template's reference spec: all lines, hidden ones included, with the same
 * operation ids as createSpec. Goals are checked against it.
 */
export function referenceSpecOf(topicId: string): SpecDoc | undefined {
  if (!REFERENCES.has(topicId)) REFERENCES.set(topicId, buildReference(topicId));
  return REFERENCES.get(topicId);
}
const REFERENCES = new Map<string, SpecDoc | undefined>();

function buildReference(topicId: string): SpecDoc | undefined {
  const t = TEMPLATES.get(topicId);
  if (!t) return undefined;
  const spec = fromTemplate(topicId, t);
  const all = (lines?: TemplateLine[]) => (lines ?? []).map((l) => l.text).join('\n');
  const fill = (doc: SchemaDoc, s: TemplateSchema) => {
    doc.decls = all(s.declarations);
    doc.preds = all(s.predicates);
  };
  spec.given = `[${(t.givenSets ?? []).map((g) => g.name).join(', ')}]`;
  fill(spec.state, t.state);
  if (spec.init && t.init) fill(spec.init, t.init);
  (t.operations ?? []).forEach((op, i) => fill(spec.operations[i], op));
  return spec;
}

/** The System step's bullet points of a template topic ([] for the own topic). */
export function cardOf(id: string): string[] {
  const card = TEMPLATES.get(id)?.card;
  const items = Array.isArray(card) ? card : typeof card === 'string' ? [card] : [];
  return items.map((s) => s.trim()).filter(Boolean);
}

/** Lucide icon name of a topic (the own topic: its bubble's icon). */
export function iconOf(id: string): string {
  return id === CUSTOM_ID ? CUSTOM_TOPIC.icon : (TOPICS.find((t) => t.id === id)?.icon ?? 'box');
}

/** Title of a topic for display (custom topics carry their own title in the SpecDoc). */
export function topicTitle(id: string): string | undefined {
  return TEMPLATES.get(id)?.title;
}

// ── SpecDoc construction ─────────────────────────────────────────────────────

/** Fresh SpecDoc for a topic. Throws for unknown ids (check with hasTopic first). */
export function createSpec(topicId: string, customTitle?: string): SpecDoc {
  if (topicId === CUSTOM_ID) return customSpec(customTitle?.trim() || 'My System');
  const t = TEMPLATES.get(topicId);
  if (!t) throw new Error(`unknown topic '${topicId}'`);
  return fromTemplate(topicId, t);
}

function fromTemplate(topicId: string, t: Template): SpecDoc {
  // Students start bare: an empty Types line and schemas with only their names.
  // The template's lines are the reference spec (used by tests), never shown.
  const pools: Record<string, string[]> = {};
  for (const g of t.givenSets ?? []) if (g.values?.length) pools[g.name] = [...g.values];

  const schema = (s: TemplateSchema, id: string, role: SchemaRole): SchemaDoc => {
    const doc: SchemaDoc = {
      id,
      role,
      name: s.name,
      decls: '',
      preds: '',
    };
    // the editors show generic prompts; the template's prompt texts are not used
    if (role === 'operation') doc.opKind = s.kind === 'query' ? 'query' : 'update';
    return doc;
  };

  const usedIds = new Set<string>();
  const operations = (t.operations ?? []).map((op) => {
    let id = `op-${slug(op.name) || 'operation'}`;
    for (let n = 2; usedIds.has(id); n++) id = `op-${slug(op.name)}-${n}`;
    usedIds.add(id);
    return schema(op, id, 'operation');
  });

  const spec: SpecDoc = {
    topicId,
    title: t.title,
    given: '[]',
    pools,
    state: schema(t.state, 'state', 'state'),
    init: t.init ? schema(t.init, 'init', 'init') : null,
    operations,
  };
  const revision = revisionOf(topicId);
  if (revision > 1) spec.revision = revision;
  if (t.typesPrompt) spec.typesPrompt = t.typesPrompt;
  if (t.fixedValues && Object.keys(t.fixedValues).length) spec.fixed = { ...t.fixedValues };
  const infinite = (t.givenSets ?? []).filter((g) => g.infinite).map((g) => g.name);
  if (infinite.length) spec.infinite = infinite;
  return spec;
}


// ── own topic ────────────────────────────────────────────────────────────────

function defaultPools(): Record<string, string[]> {
  return Object.fromEntries(DEFAULT_GIVEN_SETS.map((g) => [g.name, [...g.values]]));
}

/** State schema name of an own topic, from its title: 'parking garage' → 'ParkingGarage'. */
export function stateNameOf(title: string): string {
  return pascalCase(title) || 'System';
}

/** `base` if it is not taken, else the first free one of `base2`, `base3`, … */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

function customSpec(title: string): SpecDoc {
  const stateName = stateNameOf(title);
  const initName = `Init${stateName}`;
  // a system called "Query" keeps its name; the default operation moves aside
  const query = uniqueName('Query', [stateName, initName]);
  const update = uniqueName('Update', [stateName, initName, query]);
  return {
    topicId: CUSTOM_ID,
    title,
    given: '[]',
    typesPrompt: 'Which kinds of things does your system deal with?',
    pools: defaultPools(),
    infinite: DEFAULT_SETS.filter((d) => d.infinite).map((d) => d.name),
    state: { id: 'state', role: 'state', name: stateName, decls: '', preds: '' },
    init: { id: 'init', role: 'init', name: initName, decls: '', preds: '' },
    operations: [
      {
        id: 'op-query',
        role: 'operation',
        opKind: 'query',
        name: query,
        decls: `Ξ${stateName}`,
        preds: '',
      },
      {
        id: 'op-update',
        role: 'operation',
        opKind: 'update',
        name: update,
        decls: `Δ${stateName}`,
        preds: '',
      },
    ],
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 'parking garage' → 'ParkingGarage' (letters/digits only, never starts with a digit). */
export function pascalCase(s: string): string {
  const out = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  return out.replace(/^[0-9]+/, '');
}

/**
 * Given sets offered in the Types step's tool bar: a template's own sets plus a few
 * related ones (computed from the template, so older saved specs get them too).
 * Undefined for the own topic (which offers the generic NAME, DATE, …).
 */
export function typeOptionsOf(topicId: string): { name: string; values: string[]; infinite: boolean }[] | undefined {
  const t = TEMPLATES.get(topicId);
  if (!t) return undefined;
  return [...(t.givenSets ?? []), ...(t.typeOptions ?? [])]
    .filter((g, i, all) => all.findIndex((o) => o.name === g.name) === i)
    .map((g) => ({ name: g.name, values: [...(g.values ?? [])], infinite: !!g.infinite }));
}
