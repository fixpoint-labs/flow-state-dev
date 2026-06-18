/**
 * `captureAndPlan` — entry sequencer for the plan-and-execute pattern.
 *
 * Thin wrapper over `createPlanningEntry` from `shared/planning-entry.ts`.
 * P&E-specific: `idPrefix: "step"`, `activeStatusMessage: "Planning the steps"`,
 * and the P&E schemas.
 */
import type { BlockDefinition } from "@flow-state-dev/core/types";
import {
  createPlanningEntry,
  type TaskContextSupply,
} from "../../shared/planning-entry";
import {
  planAndExecuteInputSchema,
  planAndExecuteStateSchema,
} from "../schemas";

export interface CaptureAndPlanOptions {
  /** Pattern name. Used for block names and as the request collection id. */
  name: string;
  /** Resolved planner block — user-supplied or factory-built default. */
  planner: BlockDefinition<any, any>;
  /**
   * Per-task retry budget stamped onto every seeded `TaskInit`. Default
   * `1` (no retries) preserves pre-migration behavior.
   */
  maxAttemptsPerTask: number;
  /** Per-task context supply (FIX-827). Default `"goal"`. */
  taskContext?: TaskContextSupply;
}

/**
 * Build the entry sequencer. The returned block runs once at the top
 * of the plan-and-execute pipeline before the first board drain.
 */
export function createCaptureAndPlan(options: CaptureAndPlanOptions) {
  const { name, planner, maxAttemptsPerTask, taskContext } = options;

  return createPlanningEntry({
    name,
    inputSchema: planAndExecuteInputSchema,
    stateSchema: planAndExecuteStateSchema,
    planner,
    maxAttemptsPerTask,
    activeStatusMessage: "Planning the steps",
    idPrefix: "step",
    ...(taskContext !== undefined ? { taskContext } : {}),
  });
}
