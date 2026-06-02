/**
 * `captureAndPlan` — entry sequencer for the supervisor pattern.
 *
 * Thin wrapper over `createPlanningEntry` from `shared/planning-entry.ts`.
 * Supervisor-specific: default `idPrefix` (`"task"`),
 * `activeStatusMessage: "Planning tasks"`, and the supervisor schemas.
 */
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { createPlanningEntry } from "../../shared/planning-entry";
import { supervisorInputSchema, supervisorStateSchema } from "../schemas";

export interface CaptureAndPlanOptions {
  name: string;
  planner: BlockDefinition<any, any>;
  /** Per-task retry budget stamped onto every seeded TaskInit. */
  maxAttemptsPerTask: number;
}

/** Build the entry sequencer; runs once at the top of the pipeline. */
export function createCaptureAndPlan(options: CaptureAndPlanOptions) {
  const { name, planner, maxAttemptsPerTask } = options;

  return createPlanningEntry({
    name,
    inputSchema: supervisorInputSchema,
    stateSchema: supervisorStateSchema,
    planner,
    maxAttemptsPerTask,
    activeStatusMessage: "Planning tasks",
  });
}
