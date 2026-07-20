/**
 * parallelTasks pattern — fan-out / fan-in orchestration backed by taskBoard.
 *
 * Decomposes a goal into sub-tasks, runs a worker concurrently for each via
 * the taskBoard primitive, then synthesizes the completed results. One pass,
 * no feedback loop. Use Supervisor when tasks need judgment and iteration.
 *
 * Pipeline:
 *   [planner] → [seedTasksFromPlan] → [board.drain] → [collectResults] → [synthesizer]
 */
import { sequencer, handler, utility } from "@flow-state-dev/core";
import type { SequencerDefinition } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { createSeedTasksFromPlan } from "../shared/planning-entry";
import { parallelTasksInputSchema, type SubTaskErrorStrategy } from "./schemas";

export type { SubTaskErrorStrategy } from "./schemas";
export { parallelTasksInputSchema } from "./schemas";

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
   * When omitted, `utility.combiner()` is used.
   */
  synthesizer?: BlockDefinition<any, any>;

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

  const finalize = synthesizer ?? utility.combiner({
    name: `${name}-merger`,
    ...(outputSchema ? { outputSchema } : {})
  });

  const board = taskBoard({
    name: `${name}-board`,
    collection: { collectionId: name },
    workers: worker,
    concurrency: maxConcurrency,
    dispatcher: "fifo",
    onIdle: "complete",
    onError: boardOnError,
  });

  const seedTasks = createSeedTasksFromPlan({
    name,
    collectionId: name,
    inputDefault: "goal",
  });

  // Collects completed task outputs after the board drains.
  // Filters to `completed` only — failed and skipped tasks are excluded
  // from the synthesizer input.
  const collectResults = handler({
    name: `${name}-collect-results`,
    activeStatusMessage: "Combining results",
    inputSchema: z.unknown(),
    outputSchema: z.array(z.unknown()),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const completed = await ctx.cap[board.capability.name].listTasks({
        status: "completed",
      });
      return completed
        .map((t) => t.output)
        .filter((o): o is unknown => o !== undefined);
    }
  });

  return sequencer({
    name,
    inputSchema: parallelTasksInputSchema,
    activeStatusMessage: "Planning tasks",
  })
    .step(activePlanner)
    .tap(seedTasks)
    .step(board.drain)
    .step(collectResults)
    .step(finalize) as SequencerDefinition<any, any>;
}
