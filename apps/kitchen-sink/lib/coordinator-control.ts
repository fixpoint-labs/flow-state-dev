/**
 * The goal checks' controls on `support.help`, the coordinator (`GOAL_CONTROL`).
 *
 * - `no-route` reads every coordinator on `routing: best-fit` as
 *   `routing: everyone`, so every delegate hears every post. A check that one
 *   specialist answers and nobody else runs must FAIL under it.
 * - `answers-go-on` reads every coordinator with `rounds: 1`, so each answer
 *   goes back out to the other delegates. A check that an answer wakes nobody
 *   must FAIL under it.
 * - `no-delivery` registers the coordinator flow with no flow a delegate takes
 *   a post on, so a post reaches nobody. A check that the routed specialist
 *   runs must FAIL under it.
 *
 * Each changes what the app hands the package, never the package: a worker's
 * settings as the files are read, or the flows the coordinator is built with.
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

/** The flows a delegate takes a post on, or none under `no-delivery`. */
export function delegateFlowsUnderControl<T>(flows: T[]): T[] {
  return goalControl() === "no-delivery" ? [] : flows;
}
