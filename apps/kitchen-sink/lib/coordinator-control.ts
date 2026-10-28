/**
 * The goal checks' controls on `support.help`, the coordinator (`GOAL_CONTROL`).
 *
 * - `no-route` reads every coordinator on `routing: best-fit` as
 *   `routing: everyone`, so every delegate hears every post. A check that one
 *   specialist answers and nobody else runs must FAIL under it.
 * - `answers-go-on` reads every coordinator with `rounds: 1`, so each answer
 *   goes back out to the other delegates. A check that an answer wakes nobody
 *   must FAIL under it.
 * - `no-delivery` registers the `agent` flow as one whose workers take no
 *   task, so the delegate check refuses every specialist and a message
 *   reaches nobody. A check that the routed specialist runs must FAIL under
 *   it.
 *
 * Each changes what the app hands the package, never the package: a worker's
 * settings as the files are read, or the flows it registers.
 *
 * Honoured only under `KITCHEN_SINK_TEST_MODE=1` (`goalControl`), so a control
 * can never reach a deployed build.
 */
import type { WorkerManifest } from "@flow-state-dev/workforce";

import { goalControl } from "./goal-control";

/** The workers as read, or with each coordinator's settings changed when a control asks. */
export function coordinatorWorkersUnderControl(workers: WorkerManifest[]): WorkerManifest[] {
  const control = goalControl();
  if (control !== "no-route" && control !== "answers-go-on") return workers;
  return workers.map((worker) => {
    if (worker.declared.flow !== "coordinator") return worker;
    if (control === "answers-go-on") return { ...worker, declared: { ...worker.declared, rounds: 1 } };
    return worker.declared.routing === "best-fit"
      ? { ...worker, declared: { ...worker.declared, routing: "everyone" } }
      : worker;
  });
}

/**
 * The `agent` flow as registered: itself, or, under `no-delivery`, the same
 * flow with no task entry, registered as a manager only, so no worker on it
 * is a delegate (FIX-2083: a delegate is a worker whose flow takes tasks).
 */
export function agentFlowUnderControl<T extends object>(agent: T): T | { flow: T; roles: ["manager"] } {
  if (goalControl() !== "no-delivery") return agent;
  const mint = (...args: unknown[]) => (agent as unknown as (...a: unknown[]) => unknown)(...args);
  return { flow: Object.assign(mint, agent, { task: { actions: {} } }) as unknown as T, roles: ["manager"] };
}
