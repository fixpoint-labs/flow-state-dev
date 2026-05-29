/**
 * `captureAndPlan` — entry sequencer for the supervisor pattern.
 *
 * BP-011 conformance: planner runs as a `.step(planner)` step, not via
 * `block.run` inside a handler. Steps:
 *   1. setInitialState — stamp goal / status / iteration on outer state
 *   2. emitPlanningMeta — fire `task-board-meta` "planning" component
 *   3. <planner>      — produces `{ tasks: [...] }`
 *   4. seedTasksFromPlan — translate to `TaskInit` and `addTasks` to the collection
 *
 * Seed step is `.tap()`-shaped per BP-012 (state-mutation only).
 */
import { sequencer, handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  getOrCreateTaskCollection,
  type TaskInit,
} from "@flow-state-dev/tasks";
import { TASK_BOARD_META_COMPONENT_TYPE } from "../../task-board/blocks/board-meta";
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
  const collectionId = name;

  const setInitialState = handler({
    name: `${name}-set-initial-state`,
    inputSchema: supervisorInputSchema,
    sequencerStateSchema: supervisorStateSchema,
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
    inputSchema: z
      .object({
        tasks: z.array(
          z
            .object({
              id: z.string().optional(),
              goal: z.string(),
              assignee: z.string().optional(),
              deps: z.array(z.string()).optional(),
              dependencies: z.array(z.string()).optional(),
              priority: z.union([z.string(), z.number()]).optional(),
              context: z.string().optional(),
              maxAttempts: z.number().optional(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
    sequencerStateSchema: supervisorStateSchema,
    execute: async (planOutput, ctx) => {
      const collection = getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });
      const tasks: TaskInit[] = planOutput.tasks.map((t, i) => ({
        id: t.id ?? `task-${i + 1}`,
        goal: t.goal,
        ...(t.assignee !== undefined ? { assignee: t.assignee } : {}),
        deps: t.deps ?? t.dependencies ?? [],
        ...(typeof t.priority === "number" ? { priority: t.priority } : {}),
        ...(t.context !== undefined ? { input: t.context } : {}),
        maxAttempts: t.maxAttempts ?? maxAttemptsPerTask,
      }));
      if (tasks.length > 0) await collection.addTasks(tasks);
      await ctx.sequencer!.patchState({ status: "executing" });
    },
  });

  return sequencer({
    name: `${name}-capture-and-plan`,
    inputSchema: supervisorInputSchema,
    stateSchema: supervisorStateSchema,
    activeStatusMessage: "Planning tasks",
  })
    .tap(setInitialState)
    .tap(emitPlanningMeta)
    .step(planner)
    .tap(seedTasksFromPlan);
}
