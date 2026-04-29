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
  input?: TIn;
  /**
   * Pattern-supplied dep outputs, keyed by dep task id. Convenience for
   * workers that want to read upstream results without re-querying the
   * collection. Patterns that don't materialize dep outputs leave this
   * undefined.
   */
  deps?: Record<string, unknown>;
  attempts: number;
  feedback?: string;
  metadata?: Record<string, unknown>;
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
