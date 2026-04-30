/**
 * `captureAndPlan` — entry sequencer for the plan-and-execute pattern.
 *
 * Runs once at the top of the pipeline. Composed (not inlined) per
 * BP-011: the planner block is a `.then(planner)` step rather than an
 * `await planner.run(...)` call inside a handler.
 *
 * Steps:
 *   1. `setInitialState` — stamps `goal`, `status: "planning"`, and
 *      `iteration: 0` onto the outer sequencer state.
 *   2. `emitPlanningMeta` — fires a `task-board-meta` component item
 *      with `status: "planning"` so renderers can show the planning
 *      phase.
 *   3. `<planner>` — user-supplied or default decomposer. Output shape:
 *      `{ tasks: Array<{ id?, goal, deps?|dependencies? }> }`.
 *   4. `seedTasksFromPlan` — translates planner output into substrate
 *      `TaskInit` shape (mapping legacy `dependencies` → `deps`,
 *      stamping `maxAttempts`) and adds them to the request-backed
 *      TaskCollection.
 *
 * The seed step is `.tap()`-shaped per BP-012 — it mutates the
 * collection but produces no novel output.
 */
import { sequencer, handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  getOrCreateTaskCollection,
  type TaskInit,
} from "@flow-state-dev/tasks";
import {
  TASK_BOARD_META_COMPONENT_TYPE,
} from "../../task-board/blocks/board-meta";
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
}

/**
 * Build the entry sequencer. The returned block runs once at the top
 * of the plan-and-execute pipeline before the first board drain.
 */
export function createCaptureAndPlan(options: CaptureAndPlanOptions) {
  const { name, planner, maxAttemptsPerTask } = options;
  const collectionId = name;

  const setInitialState = handler({
    name: `${name}-set-initial-state`,
    inputSchema: planAndExecuteInputSchema,
    sequencerStateSchema: planAndExecuteStateSchema,
    execute: async (input, ctx) => {
      await ctx.sequencer!.patchState({
        goal: input.goal,
        status: "planning",
        iteration: 0,
      });
    },
  });

  const emitPlanningMeta = handler({
    name: `${name}-meta-planning`,
    inputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      ctx.emitComponent(
        TASK_BOARD_META_COMPONENT_TYPE,
        { collectionId, status: "planning" },
        { key: collectionId },
      );
    },
  });

  const seedTasksFromPlan = handler({
    name: `${name}-seed-tasks`,
    inputSchema: z.object({
      tasks: z.array(
        z.object({
          id: z.string().optional(),
          goal: z.string(),
          dependencies: z.array(z.string()).optional(),
          deps: z.array(z.string()).optional(),
          // Accept string or number for compatibility with the default
          // decomposer's "high"/"medium"/"low" output. Only numeric values
          // forward to the substrate's `TaskInit.priority`; strings drop.
          priority: z.union([z.number(), z.string()]).optional(),
          input: z.unknown().optional(),
          maxAttempts: z.number().optional(),
        }).passthrough(),
      ),
    }),
    execute: async (planOutput, ctx) => {
      const collection = getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });

      const tasks: TaskInit[] = planOutput.tasks.map((t, i) => ({
        id: t.id ?? `step-${i + 1}`,
        goal: t.goal,
        deps: t.deps ?? t.dependencies ?? [],
        ...(typeof t.priority === "number" ? { priority: t.priority } : {}),
        ...(t.input !== undefined ? { input: t.input } : {}),
        maxAttempts: t.maxAttempts ?? maxAttemptsPerTask,
      }));

      if (tasks.length > 0) {
        await collection.addTasks(tasks);
      }

      await ctx.sequencer!.patchState({ status: "executing" });
    },
  });

  return sequencer({
    name: `${name}-capture-and-plan`,
    inputSchema: planAndExecuteInputSchema,
    stateSchema: planAndExecuteStateSchema,
  })
    .tap(setInitialState)
    .tap(emitPlanningMeta)
    .then(planner)
    .tap(seedTasksFromPlan);
}
