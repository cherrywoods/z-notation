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
  name: string;
  kind?: OpKind;
  prompt?: string;
  declarations?: TemplateLine[];
  predicates?: TemplateLine[];
}
interface Template {
  id?: string;
  title: string;
  short?: string;
  icon?: string;
  blurb?: string;
  description?: string;
  typesPrompt?: string;
  requirements?: { id: string; text: string }[];
  givenSets?: { name: string; values?: string[]; comment?: string; hidden?: boolean; infinite?: boolean }[];
  state: TemplateSchema;
  init?: TemplateSchema | null;
  operations?: TemplateSchema[];
  /** Z set displays for fixed-data state variables, e.g. { maxDose: '{aspirin ↦ 4000, …}' }. */
  fixedValues?: Record<string, string>;
}

/** Stable order on the start page; unknown ids follow alphabetically. */
const ORDER = [
  'medication',
  'blood-transfusion',
  'bank-account',
  'access-control',
  'railway-interlocking',
  'air-traffic-control',
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
  const reqText = new Map((t.requirements ?? []).map((r) => [r.id, r.text]));
  const given = (t.givenSets ?? []).filter((g) => !g.hidden).map((g) => g.name);
  const pools: Record<string, string[]> = {};
  for (const g of t.givenSets ?? []) if (g.values?.length) pools[g.name] = [...g.values];

  const schema = (s: TemplateSchema, id: string, role: SchemaRole): SchemaDoc => {
    const lines = [...(s.declarations ?? []), ...(s.predicates ?? [])];
    const doc: SchemaDoc = {
      id,
      role,
      name: s.name,
      decls: visibleText(s.declarations),
      preds: visibleText(s.predicates),
    };
    const prompt = s.prompt?.trim() || hiddenPrompt(lines, reqText);
    if (prompt) doc.prompt = prompt;
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
    given: given.length ? `[${given.join(', ')}]` : '',
    pools,
    state: schema(t.state, 'state', 'state'),
    init: t.init ? schema(t.init, 'init', 'init') : null,
    operations,
  };
  if (t.typesPrompt) spec.typesPrompt = t.typesPrompt;
  if (t.fixedValues && Object.keys(t.fixedValues).length) spec.fixed = { ...t.fixedValues };
  const infinite = (t.givenSets ?? []).filter((g) => g.infinite).map((g) => g.name);
  if (infinite.length) spec.infinite = infinite;
  return spec;
}

function visibleText(lines: TemplateLine[] | undefined): string {
  return (lines ?? [])
    .filter((l) => !l.hidden)
    .map((l) => l.text)
    .join('\n');
}

/** Prompt from the requirements of hidden lines (each requirement once, in order). */
function hiddenPrompt(lines: TemplateLine[], reqText: Map<string, string>): string {
  const ids: string[] = [];
  for (const l of lines)
    if (l.hidden) for (const r of l.requirements ?? []) if (!ids.includes(r)) ids.push(r);
  return ids
    .map((id) => reqText.get(id))
    .filter((x): x is string => !!x)
    .join(' ');
}

// ── own topic ────────────────────────────────────────────────────────────────

function defaultPools(): Record<string, string[]> {
  return Object.fromEntries(DEFAULT_GIVEN_SETS.map((g) => [g.name, [...g.values]]));
}

function customSpec(title: string): SpecDoc {
  const stateName = pascalCase(title) || 'System';
  return {
    topicId: CUSTOM_ID,
    title,
    given: '',
    typesPrompt: 'Which kinds of things does your system deal with?',
    pools: defaultPools(),
    infinite: DEFAULT_SETS.filter((d) => d.infinite).map((d) => d.name),
    state: { id: 'state', role: 'state', name: stateName, decls: '', preds: '' },
    init: null,
    operations: [
      {
        id: 'op-query',
        role: 'operation',
        opKind: 'query',
        name: 'Query',
        decls: `Ξ${stateName}`,
        preds: '',
      },
      {
        id: 'op-update',
        role: 'operation',
        opKind: 'update',
        name: 'Update',
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
