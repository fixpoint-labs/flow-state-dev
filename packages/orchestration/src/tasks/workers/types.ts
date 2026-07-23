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

/**
 * Input contract handed to every worker. The pattern's
 * `dispatchAndExecute` step packs the claimed task's salient fields
 * into this shape so workers don't depend on the substrate's `Task`
 * type directly.
 */
export type TaskWorkerInput<TIn = unknown> = {
  taskId: string;
  goal: string;
  /** Concise label for the task, distinct from `goal`. Mirrors `Task.title`. */
  title?: string;
  /**
   * Readable per-task support text — the request/conversation slice the
   * worker needs to act on this task. Mirrors `Task.context`. Distinct
   * from the generic typed `input` payload below: `context` is prose data
   * the worker renders into its prompt, not a typed directive.
   */
  context?: string;
  input?: TIn;
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
  deps?: Record<string, unknown>;
  attempts: number;
  feedback?: string;
  metadata?: Record<string, unknown>;
  /**
   * Selected observations from prior tasks in this board run.
   * Populated when the Task Board's `flowPolicy` returns a non-empty
   * selection for this task. Workers may read either the raw
   * `observations` list or the pre-rendered `narrative` when the
   * policy supplied one. Absent when no policy is configured or when
   * the policy selected nothing.
   *
   * Typed loosely as `unknown` here so workers that don't reach for
   * prior work don't pick up a transitive type dep. The concrete
   * shape is `TaskPriorWork`, also exported from this package
   * (`@flow-state-dev/orchestration`).
   */
  priorWork?: unknown;
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
