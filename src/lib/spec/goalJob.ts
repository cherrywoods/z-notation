// One goal check and the messages to and from the goal worker (goalRunner.ts,
// goals.worker.ts). Kept apart so that the worker does not import the runner.

import { analyseSpec, type Analysis } from '../z/index';
import { checkGoals, exampleBinding, type GoalStatus, type TemplateGoals } from '../z/goals';
import type { ExampleBinding } from '../z/results';
import type { SpecDoc } from './model';

/** Goal statuses by step id, and the binding the examples use (both from one matching). */
export interface GoalResults {
  byStep: Record<string, GoalStatus[]>;
  binding: ExampleBinding;
}

export interface GoalJob {
  /** The student's spec (plain JSON). */
  spec: SpecDoc;
  /** The template's reference spec and goals (topics.ts referenceSpecOf / goalsOf). */
  reference: SpecDoc;
  goals: TemplateGoals;
}
export interface GoalRequest extends GoalJob {
  id: number;
}
export type GoalReply = ({ id: number } & GoalResults) | { id: number; error: string };

/** Check the goals of `job` (`an`: the spec's analysis, if already done). */
export function runGoalJob(job: GoalJob, an?: Analysis): GoalResults {
  const a = an ?? analyseSpec(job.spec);
  const byStep = checkGoals(job.spec, a, job.reference, job.goals);
  // right after the check: it reuses the check's memoised examples
  return { byStep, binding: exampleBinding(job.spec, a, job.reference, job.goals) };
}
