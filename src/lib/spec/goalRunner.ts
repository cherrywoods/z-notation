// Goal checks (z/goals.ts) in a module Web Worker, so that a slow check never freezes
// the editor. The worker analyses the posted spec itself and keeps the memo caches of
// goals.ts across requests.
//
//   const runner = new GoalRunner();
//   runner.check({ spec, reference, goals }, an).then((byStep) => …);   // null: outdated
//
// Only the latest request counts. One check runs at a time; a request that arrives
// meanwhile waits (a newer one replaces it) and the running check's result is dropped.
// If that check is still running ABANDON_MS after it started, the worker is restarted
// (losing its caches) so the newest spec gets checked. Without Worker (vitest, SSR), or
// if the worker cannot start, checks run synchronously on the main thread.

import type { Analysis } from '../z/index';
import { runGoalJob, type GoalJob, type GoalReply, type GoalRequest, type GoalResults } from './goalJob';

export type { GoalJob, GoalResults };

/** How long an outdated check may keep running before the worker is restarted. */
export const ABANDON_MS = 2000;

interface Pending {
  id: number;
  job: GoalJob;
  /** The main thread's analysis of `spec` (for the synchronous fallback). */
  an?: Analysis;
  resolve: (r: GoalResults | null) => void;
  reject: (e: unknown) => void;
  since?: number;
}

export class GoalRunner {
  #worker: Worker | null = null;
  /** No worker (not supported, or it failed to start): check synchronously. */
  #sync = typeof Worker === 'undefined';
  #seq = 0;
  #running: Pending | null = null;
  #waiting: Pending | null = null;
  #abandon: ReturnType<typeof setTimeout> | undefined;

  /** Check the goals; resolves with null if a newer request made this one outdated. */
  check(job: GoalJob, an?: Analysis): Promise<GoalResults | null> {
    return new Promise((resolve, reject) => {
      const p: Pending = { id: ++this.#seq, job, an, resolve, reject };
      this.#waiting?.resolve(null);
      this.#waiting = null;
      if (this.#sync || !this.#ensureWorker()) return this.#runHere(p);
      if (!this.#running) return this.#start(p);
      this.#waiting = p;
      this.#watch();
    });
  }

  /** Stop the worker (pending requests resolve with null). */
  dispose() {
    clearTimeout(this.#abandon);
    this.#worker?.terminate();
    this.#worker = null;
    this.#running?.resolve(null);
    this.#waiting?.resolve(null);
    this.#running = this.#waiting = null;
  }

  #runHere(p: Pending) {
    try {
      p.resolve(runGoalJob(p.job, p.an));
    } catch (e) {
      p.reject(e);
    }
  }

  #ensureWorker(): boolean {
    if (this.#worker) return true;
    try {
      const w = new Worker(new URL('./goals.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<GoalReply>) => this.#reply(w, e.data);
      w.onerror = (e) => {
        e.preventDefault?.();
        this.#fail(w, e.message || 'worker error');
      };
      this.#worker = w;
      return true;
    } catch (e) {
      console.warn('[goals] no worker, checking on the main thread', e);
      this.#sync = true;
      return false;
    }
  }

  #start(p: Pending) {
    p.since = Date.now();
    this.#running = p;
    const req: GoalRequest = { id: p.id, ...p.job };
    this.#worker!.postMessage(req);
  }

  /** A newer request waits: give the running check until ABANDON_MS, then restart. */
  #watch() {
    clearTimeout(this.#abandon);
    const r = this.#running;
    if (!r) return;
    this.#abandon = setTimeout(() => this.#restart(), Math.max(0, (r.since ?? 0) + ABANDON_MS - Date.now()));
  }

  #restart() {
    const next = this.#waiting;
    if (!this.#running || !next) return;
    this.#worker?.terminate();
    this.#worker = null;
    this.#running.resolve(null);
    this.#running = this.#waiting = null;
    if (this.#ensureWorker()) this.#start(next);
    else this.#runHere(next);
  }

  #reply(from: Worker, reply: GoalReply) {
    const p = this.#running;
    if (from !== this.#worker || !p || reply.id !== p.id) return;
    clearTimeout(this.#abandon);
    this.#running = null;
    const next = this.#waiting;
    this.#waiting = null;
    if (next) {
      p.resolve(null); // outdated
      this.#start(next);
    } else if ('error' in reply) p.reject(new Error(reply.error));
    else p.resolve(reply.byStep);
  }

  /** The worker failed (e.g. it could not load): check the newest request here from now on. */
  #fail(from: Worker, message: string) {
    if (from !== this.#worker) return;
    console.warn('[goals] worker failed, checking on the main thread:', message);
    clearTimeout(this.#abandon);
    from.terminate();
    this.#worker = null;
    this.#sync = true;
    const latest = this.#waiting ?? this.#running;
    if (this.#waiting) this.#running?.resolve(null);
    this.#running = this.#waiting = null;
    if (latest) this.#runHere(latest);
  }
}
