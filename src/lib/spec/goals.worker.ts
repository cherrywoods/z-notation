// Web Worker of the goal checks (started by goalRunner.ts): analyses the posted spec,
// checks the topic's goals and works out the example binding (z/goals.ts exampleBinding).
// The memo caches of z/goals.ts live here, across requests.

import { runGoalJob, type GoalReply, type GoalRequest } from './goalJob';

const reply = (r: GoalReply) => (self as unknown as { postMessage(m: GoalReply): void }).postMessage(r);

self.onmessage = (e: MessageEvent<GoalRequest>) => {
  const { id, spec, reference, goals } = e.data;
  try {
    reply({ id, ...runGoalJob({ spec, reference, goals }) });
  } catch (err) {
    reply({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
