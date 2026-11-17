// One goal check and the messages to and from the goal worker (goalRunner.ts,
// goals.worker.ts). Kept apart so that the worker does not import the runner.

import { analyseSpec, type Analysis } from '../z/index';
import { checkGoals, type GoalStatus, type TemplateGoals } from '../z/goals';
import type { SpecDoc } from './model';

export type GoalResults = Record<string, GoalStatus[]>;

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
export type GoalReply = { id: number; byStep: GoalResults } | { id: number; error: string };

/** Check the goals of `job` (`an`: the spec's analysis, if already done). */
export function runGoalJob(job: GoalJob, an?: Analysis): GoalResults {
  return checkGoals(job.spec, an ?? analyseSpec(job.spec), job.reference, job.goals);
}
