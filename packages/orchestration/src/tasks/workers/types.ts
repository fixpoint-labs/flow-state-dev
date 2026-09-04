/**
 * Worker contract types (FIX-443 §5).
 *
 * Workers are plain `BlockDefinition<TaskWorkerInput<TIn>, TOut>` — there
 * is no parallel "worker" abstraction. This preserves capability
 * composition: a worker is a generator/handler/sequencer like any
 * other, free to declare its own resources, capabilities, and tools.
 *
 * Patterns accept either:
 *   - a single uniform worker (every task goes through it), or
 *   - a worker registry (`Record<assignee, BlockDefinition>` keyed by
 *     `task.assignee`).
 *
 * Worker output write-back is the pattern's responsibility, not the
 * worker's. Workers return their result; `dispatchAndExecute` (or any
 * pattern) calls `collection.complete(taskId, output)` afterward.
 */
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";

/**
 * Input contract handed to every worker. The pattern's
 * `dispatchAndExecute` / board `packWorkerInput` packs the claimed
 * task's salient fields into this shape so workers don't depend on
 * `Task` directly.
 *
 * This Zod object is also the declared `inputSchema` workers reuse —
 * a declared schema is a filter, so a field the substrate packs but
 * this object omits reaches no worker that declares it. The TypeScript
 * type below is inferred from this object (with `input` re-genericized),
 * so the two cannot drift.
 */
export const taskWorkerInputSchema = z.object({
  taskId: z.string(),
  goal: z.string(),
  /** Concise label for the task, distinct from `goal`. Mirrors `Task.title`. */
  title: z.string().optional(),
  /**
   * Readable per-task support text — the request/conversation slice the
   * worker needs to act on this task. Mirrors `Task.context`. Distinct
   * from the generic typed `input` payload below: `context` is prose data
   * the worker renders into its prompt, not a typed directive.
   */
  context: z.string().optional(),
  input: z.unknown().optional(),
  /**
   * Dep outputs keyed by dep task id, materialized from the collection
   * at claim time. Always populated when the task declares
   * `task.deps[]` and those deps have produced output (`completed`
   * status). Workers read upstream results from `input.deps[depId]`
   * without re-querying the collection.
   *
   * Substrate-supplied as of FIX-447 follow-up. The substrate's
   * `packWorkerInput` reads each `task.deps[]` entry, fetches the
   * dep's `output` from the live collection, and populates this map
   * before invoking the worker. Patterns no longer need to plumb dep
   * results through their own glue — this happens in the worker
   * dispatch path itself.
   */
  deps: z.record(z.unknown()).optional(),
  attempts: z.number().int().nonnegative(),
  feedback: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  /**
   * Selected observations from prior tasks in this board run.
   * Populated when the Task Board's `flowPolicy` returns a non-empty
   * selection for this task. Workers may read either the raw
   * `observations` list or the pre-rendered `narrative` when the
   * policy supplied one. Absent when no policy is configured or when
   * the policy selected nothing.
   *
   * `unknown` so workers that don't reach for prior work don't pick
   * up a transitive type. The concrete shape is `TaskPriorWork`.
   * Optional so an unselected slot stays an absent key (the detached
   * path's JSON-safety gate rejects present `undefined`).
   */
  priorWork: z.unknown().optional(),
});

/**
 * Input contract handed to every worker. Inferred from
 * {@link taskWorkerInputSchema}; `input` is re-genericized so a
 * worker can name its payload type without a second field list.
 */
export type TaskWorkerInput<TIn = unknown> = Omit<
  z.infer<typeof taskWorkerInputSchema>,
  "input"
> & {
  input?: TIn;
};

/**
 * Worker block alias. Any `BlockDefinition` whose input matches
 * `TaskWorkerInput<TIn>` is a valid worker. Forward-compat: agents and
 * skills register under the same alias once those systems land
 * (FIX-454).
 */
export type TaskWorker<TIn = unknown, TOut = unknown> = BlockDefinition<any, any, TaskWorkerInput<TIn>, TOut>;

/**
 * Worker registry: a record of named worker blocks. The dispatching
 * pattern looks up `registry[task.assignee]` at execute time.
 */
export type TaskWorkerRegistry = Record<string, TaskWorker>;
