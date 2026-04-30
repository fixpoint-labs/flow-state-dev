/**
 * parallelTasks pattern — fan-out / fan-in orchestration backed by taskBoard.
 *
 * Decomposes a goal into sub-tasks, runs a worker concurrently for each via
 * the taskBoard primitive, then synthesizes the completed results. One pass,
 * no feedback loop. Use Supervisor when tasks need judgment and iteration.
 *
 * Pipeline:
 *   [planner] → [seedTasksFromPlan] → [board.block] → [collectResults] → [synthesizer]
 *
 * `coordinator()` is a deprecated alias for this factory.
 */
import { sequencer, handler, utility } from "@flow-state-dev/core";
import type { SequencerDefinition } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import { getOrCreateTaskCollection } from "@flow-state-dev/tasks";
import { taskBoard } from "../task-board";
import { parallelTasksInputSchema, type SubTaskErrorStrategy } from "./schemas";

export type { SubTaskErrorStrategy } from "./schemas";
export { parallelTasksInputSchema } from "./schemas";

// Backward-compat re-export so existing `coordinatorInputSchema` imports still work.
export { parallelTasksInputSchema as coordinatorInputSchema } from "./schemas";

export interface ParallelTasksConfig<
  TOutputSchema extends ZodTypeAny = ZodTypeAny
> {
  /** Name for this parallelTasks instance. */
  name: string;

  /** The worker block that processes each sub-task. Receives `TaskWorkerInput`. */
  worker: BlockDefinition<any, any>;

  /** Maximum number of sub-tasks to run concurrently. Defaults to 3. */
  maxConcurrency?: number;

  /** Override the planning step. Defaults to `utility.decomposer()`. */
  planner?: BlockDefinition<any, any>;

  /**
   * Final synthesis block. Receives `unknown[]` of completed task outputs.
   * When omitted, `merger` is used. When both are omitted, `utility.combiner()`
   * is used.
   */
  synthesizer?: BlockDefinition<any, any>;

  /**
   * Deprecated alias for `synthesizer`. Kept for backward compatibility with
   * the coordinator API.
   */
  merger?: BlockDefinition<any, any>;

  /**
   * How to handle individual sub-task failures.
   * - `skip` (default): exclude failed sub-tasks; pass completed results to synthesizer
   * - `fail`: abort entire coordination on any failure
   * - `retry`: not supported — treated as `skip` with a one-time construction warning
   */
  onSubTaskError?: SubTaskErrorStrategy;

  /** Schema for the synthesized output. Passed to the default combiner when no custom synthesizer is provided. */
  outputSchema?: TOutputSchema;
}

/** Backward-compat alias. `CoordinatorConfig` is the same shape as `ParallelTasksConfig`. */
export type CoordinatorConfig<TOutputSchema extends ZodTypeAny = ZodTypeAny> =
  ParallelTasksConfig<TOutputSchema>;

/**
 * Creates a parallelTasks block — a sequencer that decomposes a goal into
 * sub-tasks, dispatches a worker for each concurrently via taskBoard, and
 * synthesizes results.
 */
export function parallelTasks<TOutputSchema extends ZodTypeAny = ZodTypeAny>(
  config: ParallelTasksConfig<TOutputSchema>
): SequencerDefinition<any, any> {
  const {
    name,
    worker,
    maxConcurrency = 3,
    planner,
    synthesizer,
    merger,
    onSubTaskError = "skip",
    outputSchema,
  } = config;

  if (onSubTaskError === "retry") {
    console.warn(
      `[flow-state-dev] parallelTasks "${name}": onSubTaskError="retry" is not supported ` +
      `and will be treated as "skip". Remove the option to suppress this warning.`
    );
  }

  const boardOnError: "skip" | "fail" = onSubTaskError === "fail" ? "fail" : "skip";

  const defaultPlanner = utility.decomposer({ name: `${name}-planner` });
  const activePlanner = planner ?? defaultPlanner;

  const finalize = synthesizer ?? merger ?? utility.combiner({
    name: `${name}-merger`,
    ...(outputSchema ? { outputSchema } : {})
  });

  const board = taskBoard({
    name: `${name}-board`,
    collection: { backing: "request", collectionId: name },
    workers: worker,
    concurrency: maxConcurrency,
    dispatcher: "fifo",
    onIdle: "complete",
    onError: boardOnError,
  });

  // Seeds tasks from the planner output into the board collection.
  // Preserves all TaskInit fields (id, deps, priority, maxAttempts, assignee)
  // that a custom planner may produce, mirroring plan-and-execute and
  // supervisor seed steps. State mutation only (BP-012).
  const seedTasksFromPlan = handler({
    name: `${name}-seed-tasks`,
    inputSchema: z.object({
      tasks: z.array(z.object({
        id: z.string().optional(),
        goal: z.string(),
        deps: z.array(z.string()).optional(),
        dependencies: z.array(z.string()).optional(),
        assignee: z.string().optional(),
        // Accept string or number for compatibility with the default
        // decomposer's "high"/"medium"/"low" output. Only numeric values
        // forward to the substrate.
        priority: z.union([z.number(), z.string()]).optional(),
        maxAttempts: z.number().optional(),
      }).passthrough())
    }),
    execute: async (planOutput, ctx) => {
      const collection = getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId: name,
      });
      const tasks = planOutput.tasks.map((t, i) => ({
        id: t.id ?? `task-${i + 1}`,
        goal: t.goal,
        deps: t.deps ?? t.dependencies ?? [],
        ...(t.assignee !== undefined ? { assignee: t.assignee } : {}),
        ...(typeof t.priority === "number" ? { priority: t.priority } : {}),
        ...(t.maxAttempts !== undefined ? { maxAttempts: t.maxAttempts } : {}),
        input: t.goal,
      }));
      await collection.addTasks(tasks);
    }
  });

  // Collects completed task outputs after the board drains.
  // Filters to `completed` only — mirrors the old coordinator's behavior
  // of excluding failed/skipped tasks from the synthesizer input.
  const collectResults = handler({
    name: `${name}-collect-results`,
    inputSchema: z.unknown(),
    outputSchema: z.array(z.unknown()),
    execute: (_input, ctx) => {
      const collection = getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId: name,
      });
      return collection
        .list({ status: "completed" })
        .map((t) => t.output)
        .filter((o): o is unknown => o !== undefined);
    }
  });

  return sequencer({ name, inputSchema: parallelTasksInputSchema })
    .then(activePlanner)
    .tap(seedTasksFromPlan)
    .then(board.block)
    .then(collectResults)
    .then(finalize) as SequencerDefinition<any, any>;
}
