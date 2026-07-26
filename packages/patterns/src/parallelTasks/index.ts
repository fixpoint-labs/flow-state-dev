/**
 * parallelTasks pattern — fan-out / fan-in orchestration backed by taskBoard.
 *
 * Decomposes a goal into sub-tasks, runs a worker concurrently for each via
 * the taskBoard primitive, then synthesizes the completed results. One pass,
 * no feedback loop. Use Supervisor when tasks need judgment and iteration.
 *
 * Expressed on the `goalSeekLoop` primitive (FIX-910) as a single-pass loop —
 * `maxIterations: 1` with an always-`done` judge, so there is exactly one drain
 * and no feedback iteration. The seed (planner + seedTasksFromPlan) and the
 * finalize (collectResults + synthesizer) become the loop's `seed`/`finalize`
 * slots; the bespoke drain-and-collect pipeline is gone.
 */
import { sequencer, handler, utility } from "@flow-state-dev/core";
import type { SequencerDefinition } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import { taskBoard, goalSeekLoop, type Verdict } from "@flow-state-dev/orchestration/task-board";
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
  /**
   * Creation bounds for the internal board (FIX-931). Defaults 500/100 —
   * unchanged behavior when unset. A planner that legitimately produces more
   * than the enqueue bound would otherwise fail its whole seed with no way to
   * raise the ceiling, so both are reachable here: a number, or `null` for
   * explicitly unbounded on that axis.
   */
  maxTotalTasks?: number | null;
  maxEnqueuedTasks?: number | null;

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
    // Reachable creation bounds (FIX-931): the board enforces them, so a caller
    // who legitimately needs a bigger board must be able to say so. Unset falls
    // through to the 500/100 defaults, and `board.caps` is what the seed writer
    // is handed, so the two can never disagree.
    ...(config.maxTotalTasks !== undefined ? { maxTotalTasks: config.maxTotalTasks } : {}),
    ...(config.maxEnqueuedTasks !== undefined
      ? { maxEnqueuedTasks: config.maxEnqueuedTasks }
      : {}),
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
    // The board's bounds, so the planner's seed writes through a capped ref
    // rather than a second uncapped one over the same ledger (FIX-931).
    caps: board.caps,
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

  // Seed: plan the goal, then seed the board — the loop's produce step.
  const seed = sequencer({
    name: `${name}-plan`,
    inputSchema: parallelTasksInputSchema,
  })
    .step(activePlanner)
    .tap(seedTasks);

  // Finalize: collect completed outputs, then merge/synthesize. Both steps —
  // `goalSeekLoop` projects the settled board before invoking `finalize`, but
  // `collectResults` re-reads the collection, so the projection is ignored and
  // the merge/`outputSchema` step still runs (parity with the old
  // `.step(collectResults).step(finalize)` tail).
  const finalizeStep = sequencer({ name: `${name}-finalize` })
    .step(collectResults)
    .step(finalize);

  return goalSeekLoop({
    name,
    inputSchema: parallelTasksInputSchema,
    activeStatusMessage: "Planning tasks",
    board,
    seed,
    // Single pass: after the one drain the work is done by construction.
    judge: (): Verdict => ({ decision: "done", reason: "converged" }),
    maxIterations: 1,
    finalize: finalizeStep,
  }) as SequencerDefinition<any, any>;
}
