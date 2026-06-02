/**
 * Shared planning-entry factories for the plan→seed idiom.
 *
 * Three patterns (plan-and-execute, supervisor, parallelTasks) previously
 * hand-rolled the same `setInitialState → emitPlanningMeta → planner →
 * seedTasksFromPlan` sub-sequencer. This file extracts the canonical
 * shape, parameterized only on what actually varies across callers:
 *
 * - `idPrefix`: P&E uses `"step"`, others use `"task"` (default).
 * - `inputDefault`: parallelTasks always maps `input: t.goal`.
 * - `t.input` vs `t.context` precedence: `t.input ?? t.context`
 *   (supervisor compat — `context` is the planner's output field).
 *
 * `createSeedTasksFromPlan` is also consumed standalone by parallelTasks
 * (which has no `setInitialState` / `emitPlanningMeta` steps).
 */
import { sequencer, handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  getOrCreateTaskCollection,
  type TaskInit,
} from "@flow-state-dev/tasks";
import { TASK_BOARD_META_COMPONENT_TYPE } from "../task-board/blocks/board-meta";

export interface PlanningEntryStateShape {
  goal?: string;
  status?: string;
  iteration?: number;
}

export interface SeedTasksFromPlanOptions<TState = unknown> {
  name: string;
  collectionId: string;
  /** Per-task retry budget. Omit to fall back to substrate default. */
  maxAttemptsPerTask?: number;
  /** `"goal"` replicates parallelTasks behavior (always `input: t.goal`). */
  inputDefault?: "goal" | "none";
  /** Auto-id prefix. Default `"task"`; P&E passes `"step"`. */
  idPrefix?: string;
  /** When present, `patchState({ status: "executing" })` after seeding. */
  stateSchema?: z.ZodType<TState>;
}

const seedTaskInputSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string().optional(),
      goal: z.string(),
      assignee: z.string().optional(),
      deps: z.array(z.string()).optional(),
      dependencies: z.array(z.string()).optional(),
      priority: z.union([z.number(), z.string()]).optional(),
      input: z.unknown().optional(),
      context: z.string().optional(),
      maxAttempts: z.number().optional(),
    }).passthrough(),
  ),
});

/**
 * Build a `.tap()`-shaped handler that seeds tasks from planner output
 * into the request-backed TaskCollection. Resolves the three divergences
 * (id prefix, input mapping, maxAttempts) behind options.
 */
export function createSeedTasksFromPlan<TState>(
  options: SeedTasksFromPlanOptions<TState>,
) {
  const {
    name,
    collectionId,
    maxAttemptsPerTask,
    inputDefault = "none",
    idPrefix = "task",
    stateSchema,
  } = options;

  return handler({
    name: `${name}-seed-tasks`,
    inputSchema: seedTaskInputSchema,
    ...(stateSchema ? { sequencerStateSchema: stateSchema } : {}),
    execute: async (planOutput, ctx) => {
      const collection = await getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });

      const tasks: TaskInit[] = planOutput.tasks.map((t, i) => {
        const resolvedInput = t.input ?? (inputDefault === "goal" ? t.goal : (t.context ?? undefined));

        return {
          id: t.id ?? `${idPrefix}-${i + 1}`,
          goal: t.goal,
          deps: t.deps ?? t.dependencies ?? [],
          ...(t.assignee !== undefined ? { assignee: t.assignee } : {}),
          ...(typeof t.priority === "number" ? { priority: t.priority } : {}),
          ...(resolvedInput !== undefined ? { input: resolvedInput } : {}),
          ...(maxAttemptsPerTask !== undefined
            ? { maxAttempts: t.maxAttempts ?? maxAttemptsPerTask }
            : t.maxAttempts !== undefined
              ? { maxAttempts: t.maxAttempts }
              : {}),
        };
      });

      if (tasks.length > 0) {
        await collection.addTasks(tasks);
      }

      if (stateSchema && ctx.sequencer) {
        await ctx.sequencer.patchState({ status: "executing" } as any);
      }
    },
  });
}

export interface PlanningEntryOptions<
  TInput extends { goal: string },
  TState extends PlanningEntryStateShape,
> {
  name: string;
  inputSchema: z.ZodType<TInput>;
  stateSchema: z.ZodType<TState>;
  planner: BlockDefinition<any, any>;
  maxAttemptsPerTask: number;
  activeStatusMessage?: string;
  /** Auto-id prefix forwarded to `createSeedTasksFromPlan`. Default `"task"`; P&E passes `"step"`. */
  idPrefix?: string;
}

/**
 * Build the entry sequencer: `setInitialState → emitPlanningMeta →
 * planner → seedTasksFromPlan`. Used by plan-and-execute and supervisor.
 */
export function createPlanningEntry<
  TInput extends { goal: string },
  TState extends PlanningEntryStateShape,
>(options: PlanningEntryOptions<TInput, TState>) {
  const {
    name,
    inputSchema,
    stateSchema,
    planner,
    maxAttemptsPerTask,
    activeStatusMessage,
    idPrefix,
  } = options;
  const collectionId = name;

  const setInitialState = handler({
    name: `${name}-set-initial-state`,
    inputSchema,
    sequencerStateSchema: stateSchema,
    execute: async (input, ctx) => {
      await ctx.sequencer!.patchState({
        goal: input.goal,
        status: "planning",
        iteration: 0,
      } as any);
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

  const seedTasks = createSeedTasksFromPlan({
    name,
    collectionId,
    maxAttemptsPerTask,
    stateSchema,
    ...(idPrefix ? { idPrefix } : {}),
  });

  return sequencer({
    name: `${name}-capture-and-plan`,
    inputSchema,
    stateSchema,
    ...(activeStatusMessage ? { activeStatusMessage } : {}),
  })
    .tap(setInitialState)
    .tap(emitPlanningMeta)
    .step(planner)
    .tap(seedTasks);
}
