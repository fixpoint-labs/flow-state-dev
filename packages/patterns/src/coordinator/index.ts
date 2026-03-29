/**
 * Coordinator Pattern
 *
 * Single-pass fan-out/fan-in orchestration: decompose a goal into sub-tasks,
 * dispatch them concurrently, and merge the results.
 *
 * Pipeline: [plan] → [extract tasks] → [dispatch worker] → [merge results]
 *           decomposer   .map()         .forEach()          combiner
 *
 * No feedback loop — trusts sub-task results and merges them in one pass.
 * Use the Supervisor pattern when tasks need judgment and iteration.
 */
import { sequencer, handler } from "@flow-state-dev/core";
import { utility } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import { coordinatorInputSchema, type SubTaskErrorStrategy } from "./schemas";

export type { SubTaskErrorStrategy } from "./schemas";
export { coordinatorInputSchema } from "./schemas";

export interface CoordinatorConfig<
  TOutputSchema extends ZodTypeAny = ZodTypeAny
> {
  /** Name for this coordinator instance. */
  name: string;

  /** The worker block that processes each sub-task. */
  worker: BlockDefinition<any, any>;

  /** Maximum number of sub-tasks to run concurrently. Defaults to 3. */
  maxConcurrency?: number;

  /** Override the planning step. Defaults to `utility.decomposer()`. */
  planner?: BlockDefinition<any, any>;

  /** Override the merge step. Defaults to `utility.combiner()`. */
  merger?: BlockDefinition<any, any>;

  /**
   * How to handle individual sub-task failures.
   * - `skip` (default): exclude failed sub-tasks from merge
   * - `fail`: abort entire coordination on any failure
   * - `retry`: retry per worker's retry policy before failing
   */
  onSubTaskError?: SubTaskErrorStrategy;

  /** Schema for the merged output. Passed to the default combiner if no custom merger is provided. */
  outputSchema?: TOutputSchema;
}

const SKIPPED_SENTINEL = "__coordinatorSkipped";

/**
 * Creates a coordinator block — a sequencer that decomposes a goal into
 * sub-tasks, dispatches a worker for each concurrently, and merges results.
 */
export function coordinator<
  TOutputSchema extends ZodTypeAny = ZodTypeAny
>(config: CoordinatorConfig<TOutputSchema>) {
  const errorStrategy = config.onSubTaskError ?? "skip";

  const planner = config.planner ?? utility.decomposer({
    name: `${config.name}-planner`
  });

  const merger = config.merger ?? utility.combiner({
    name: `${config.name}-merger`,
    ...(config.outputSchema ? { outputSchema: config.outputSchema } : {})
  });

  // When using "skip" or "retry" strategy, wrap the worker to catch errors
  // instead of letting them abort the forEach.
  const taskRunner = errorStrategy === "fail"
    ? config.worker
    : handler({
        name: `${config.name}-task-runner`,
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async (input, ctx) => {
          try {
            return await config.worker.run(input, ctx);
          } catch (error) {
            if (errorStrategy === "retry" && config.worker.config.retry) {
              throw error;
            }
            return { [SKIPPED_SENTINEL]: true, error: String(error) };
          }
        }
      });

  const pipeline = sequencer({
    name: config.name,
    inputSchema: coordinatorInputSchema
  })
    // Step 1: Plan — decompose goal into sub-tasks
    .then(planner)
    // Step 2: Extract task goals for iteration
    .map((planResult: { tasks: Array<{ goal: string }> }) =>
      planResult.tasks.map((task) => task.goal)
    )
    // Step 3: Dispatch — run worker for each sub-task concurrently
    .forEach(taskRunner, {
      maxConcurrency: config.maxConcurrency ?? 3
    });

  // Step 4: Filter skipped results when using skip/retry strategy
  if (errorStrategy !== "fail") {
    return pipeline
      .map((results: unknown[]) =>
        results.filter(
          (r) => !(r && typeof r === "object" && SKIPPED_SENTINEL in r)
        )
      )
      // Step 5: Merge — combine all results
      .then(merger);
  }

  // Step 5: Merge — combine all results
  return pipeline.then(merger);
}
