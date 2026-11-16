// Common given sets offered on the Types step (NAME, DATE, …), from
// src/lib/content/defaultTypes.ts, normalised.

import * as mod from '../content/defaultTypes';

export interface DefaultSet {
  name: string;
  values: string[];
  /** Infinite in principle (shown with a trailing …). */
  infinite: boolean;
}

/** Sets that are naturally unbounded unless the content file says otherwise. */
const UNBOUNDED = new Set(['NAME', 'DATE', 'PERSON', 'ITEM', 'TIME', 'ID', 'EMAIL', 'ADDRESS']);

export const DEFAULT_SETS: DefaultSet[] = Object.values(mod as Record<string, unknown>)
  .filter(Array.isArray)
  .flat()
  .filter((g): g is { name: string; values: string[]; infinite?: boolean } => !!g && typeof g === 'object' && typeof (g as { name?: unknown }).name === 'string')
  .map((g) => ({ name: g.name, values: [...g.values], infinite: g.infinite ?? UNBOUNDED.has(g.name) }));
