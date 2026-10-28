/**
 * The `planner` flow — one file under `workforce/flows/workers/`, basename =
 * the flow the planner's `WORKER.md` names in its `flow:` line.
 *
 * The planner files work for its delegates on its own conversation's board.
 * Its flow carries Workforce's filing kit (`defineSessionBoard`), so a
 * conversation with the planner has the task actions (`createTask_tasks`,
 * `updateTask_tasks`, `answerTask_tasks`, `listTasks_tasks`, …) while one of
 * the planner's `delegates:` takes a task. A row filed there names its
 * delegate by worker id, and the board hands it to that worker's task
 * session at once. A user answers a row parked on its worker's question
 * through the same conversation's `answerTask_tasks`.
 *
 * No model: the planner's own turn says it heard a line, and a task's notice
 * lands in the conversation as a line without waking it.
 */

import { defineFlow } from "@flow-state-dev/core";
import { defineSessionBoard, workerConfigSchema, type WorkerInstallation } from "@flow-state-dev/workforce";
import { hearingDoor } from "../../../../run-lab/hearing-door.mts";

/** The flow the planner's `WORKER.md` names in its `flow:` line. **Pinned** — the basename must match. */
export const PLANNER_FLOW = "planner";

export interface PlannerFlowOptions {
  /** The installation whose workers run on this flow, and whose delegates take its tasks. */
  installation: WorkerInstallation;
}

/**
 * Build the `planner` flow: the hearing door, and the filing kit over the
 * conversation's own board.
 */
export function definePlannerFlow(options: PlannerFlowOptions) {
  const { installation } = options;
  const kit = defineSessionBoard({ installation, flowKind: PLANNER_FLOW });
  return defineFlow({
    kind: PLANNER_FLOW,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(kit.sessionStateShape), serverOwned: [...kit.serverOwned] },
    resources: { ...installation.resources, ...kit.resources },
    actions: { ...hearingDoor, ...kit.actions },
    // A task's notice lands as a line in the conversation; nothing here acts on it.
    internal: { actions: kit.entries(hearingDoor.respond.block, () => "fixed") },
  } as never);
}
