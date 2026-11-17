import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ABANDON_MS, GoalRunner, type GoalJob } from './goalRunner';
import { runGoalJob, type GoalReply, type GoalRequest } from './goalJob';
import { createSpec, goalsOf, referenceSpecOf } from './topics';
import type { TemplateGoals } from '../z/goals';

/** Answers each request after `delay` ms with the spec's title; or fails to load. */
class FakeWorker {
  static all: FakeWorker[] = [];
  static delay = 100;
  static broken = false;
  posted: GoalRequest[] = [];
  terminated = false;
  onmessage: ((e: { data: GoalReply }) => void) | null = null;
  onerror: ((e: { message: string; preventDefault(): void }) => void) | null = null;
  constructor(
    public url: URL,
    public opts: { type?: string },
  ) {
    FakeWorker.all.push(this);
  }
  postMessage(req: GoalRequest) {
    this.posted.push(req);
    if (FakeWorker.broken) {
      setTimeout(() => this.onerror?.({ message: 'failed to load', preventDefault() {} }), 1);
      return;
    }
    setTimeout(() => {
      if (!this.terminated)
        this.onmessage?.({ data: { id: req.id, byStep: { t: [{ text: req.spec.title, achieved: true }] }, binding: { givens: {}, vars: {} } } });
    }, FakeWorker.delay);
  }
  terminate() {
    this.terminated = true;
  }
}

const job = (title: string): GoalJob => {
  const spec = createSpec('medication');
  spec.title = title;
  return { spec, reference: referenceSpecOf('medication')!, goals: goalsOf('medication') as TemplateGoals };
};
const titleOf = (r: { byStep: Record<string, { text: string }[]> } | null) => r?.byStep.t?.[0]?.text ?? null;

describe('GoalRunner with a worker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.all = [];
    FakeWorker.delay = 100;
    FakeWorker.broken = false;
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts a module worker from goals.worker.ts', async () => {
    const r = new GoalRunner();
    const p = r.check(job('A'));
    await vi.advanceTimersByTimeAsync(100);
    expect(titleOf(await p)).toBe('A');
    expect(FakeWorker.all).toHaveLength(1);
    expect(FakeWorker.all[0].url.pathname).toMatch(/\/goals\.worker\.ts$/);
    expect(FakeWorker.all[0].opts.type).toBe('module');
  });

  it('drops outdated results and checks only the newest waiting spec', async () => {
    const r = new GoalRunner();
    const a = r.check(job('A'));
    const b = r.check(job('B'));
    const c = r.check(job('C'));
    expect(await b).toBeNull(); // replaced while waiting, never sent
    await vi.advanceTimersByTimeAsync(100);
    expect(await a).toBeNull(); // finished, but C is newer
    await vi.advanceTimersByTimeAsync(100);
    expect(titleOf(await c)).toBe('C');
    expect(FakeWorker.all[0].posted.map((q) => q.spec.title)).toEqual(['A', 'C']);
  });

  it('restarts the worker when an outdated check runs long', async () => {
    FakeWorker.delay = 10 * ABANDON_MS;
    const r = new GoalRunner();
    const a = r.check(job('A'));
    await vi.advanceTimersByTimeAsync(500);
    const b = r.check(job('B'));
    await vi.advanceTimersByTimeAsync(ABANDON_MS - 500);
    expect(await a).toBeNull();
    expect(FakeWorker.all).toHaveLength(2);
    expect(FakeWorker.all[0].terminated).toBe(true);
    FakeWorker.delay = 100; // (the new worker's request was posted with the long delay)
    await vi.advanceTimersByTimeAsync(10 * ABANDON_MS);
    expect(titleOf(await b)).toBe('B');
  });

  it('falls back to the main thread if the worker fails', async () => {
    FakeWorker.broken = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = new GoalRunner();
    const j = job('Medication Prescribing');
    const p = r.check(j);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual(runGoalJob(j));
  });
});

describe('GoalRunner without Worker', () => {
  it('checks synchronously, as the worker would', async () => {
    expect(typeof Worker).toBe('undefined');
    const j = job('Medication Prescribing');
    const r = await new GoalRunner().check(j);
    expect(r).toEqual(runGoalJob(j));
    expect(Object.keys(r!.byStep)).toEqual(expect.arrayContaining(['types', 'state']));
  });

  it('works out the example binding with the goals (railway: Trains, Blocks, Signals)', async () => {
    const spec = createSpec('railway-interlocking');
    const ref = referenceSpecOf('railway-interlocking')!;
    const rename = (t: string) => t.replace(/\bTRAIN\b/g, 'Trains').replace(/\bBLOCK\b/g, 'Blocks').replace(/\bSIGNAL\b/g, 'Signals');
    spec.given = rename(ref.given);
    spec.state.decls = rename(ref.state.decls);
    spec.state.preds = rename(ref.state.preds);
    const r = await new GoalRunner().check({ spec, reference: ref, goals: goalsOf('railway-interlocking') as TemplateGoals });
    expect(r!.binding.givens).toMatchObject({ Trains: 'TRAIN', Blocks: 'BLOCK', Signals: 'SIGNAL' });
  });
});
