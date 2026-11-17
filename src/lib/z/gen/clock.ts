// The clock of the example searches. Normally real time (performance.now). Inside
// `deterministically` it is a work clock instead: it advances with the work done
// (evaluated term nodes, clock readings), so every search stops after the same work
// on every machine and under any load, and gives the same result.

const realNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Work-clock milliseconds per evaluated term node and per clock reading. */
const EVAL_MS = 0.0003;
const READ_MS = 0.001;

let work: { t: number } | null = null;

/** Milliseconds: real time, or work time inside `deterministically`. */
export const now = (): number => (work ? (work.t += READ_MS) : realNow());

/** Count evaluated term nodes (or elements of a set operation) on the work clock (no-op on the real clock). */
export function spend(n = 1): void {
  if (work) work.t += EVAL_MS * n;
}

/** For tests: from now on, run every search on the work clock (true) or in real time. */
export function useWorkClock(on: boolean): void {
  work = on ? { t: 0 } : null;
}

/** Run `fn` on the work clock (see above); nested calls share the outer clock. */
export function deterministically<T>(fn: () => T): T {
  if (work) return fn();
  work = { t: 0 };
  try {
    return fn();
  } finally {
    work = null;
  }
}
