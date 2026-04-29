/**
 * Build the per-iteration worker step for the Task Board pipeline.
 *
 * The worker step takes a `Task` (piped from `claimTask` via the
 * pipeline's `.thenIf` connector) and produces whatever the worker
 * returns. The worker block runs as a first-class step in the
 * sequencer — it is NOT invoked from inside another block's `execute`
 * (BP-011). The pipeline composes it directly via `.then(workerStep)`.
 *
 * Two shapes:
 *
 * - **Uniform worker.** The user supplies a single block. We pre-
 *   connect it with a connector that adapts `Task → TaskWorkerInput`,
 *   yielding a block whose input is a `Task`. Pre-connecting is
 *   appropriate per BP-013 because this adaptation is purpose-built
 *   for the pattern (the input contract belongs to the pattern, not
 *   to a runtime route choice).
 *
 * - **Worker registry.** The user supplies `Record<assignee, block>`.
 *   We build a `router` whose `routes` are the registered workers and
 *   whose `execute` selects by `task.assignee`, returning
 *   `selected.connectInput(() => packWorkerInput(task))`. The
 *   adaptation lives inside the router's `execute` per BP-013 — the
 *   workers themselves keep their generic `TaskWorkerInput` schema
 *   and stay reusable.
 *
 * Registry-miss errors (assignee absent, or no assignee on the task)
 * throw out of the router. The error propagates up through the
 * sequencer's `.rescue()` to `recordError`, which writes
 * `collection.fail` against the worker's per-state `currentTaskId` —
 * exactly the offending task, never a sibling's concurrently-claimed
 * work.
 */
import { router } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  taskSchema,
  type Task,
  type TaskWorker,
  type TaskWorkerInput,
  type TaskWorkerRegistry,
} from "@flow-state-dev/tasks";

/**
 * True when `workers` is a single block (callable `.run`) rather than
 * a record of blocks. Discriminates on `run` not on key presence so a
 * registry that happens to have a key called `"run"` doesn't
 * misroute.
 */
export function isUniformWorker(
  workers: TaskWorker | TaskWorkerRegistry
): workers is TaskWorker {
  return typeof (workers as { run?: unknown }).run === "function";
}

/** Pack a `Task` into the substrate's `TaskWorkerInput` shape. */
export function packWorkerInput(task: Task): TaskWorkerInput {
  return {
    taskId: task.id,
    goal: task.goal,
    input: task.input,
    attempts: task.attempts,
    feedback: task.feedback,
    metadata: task.metadata,
  };
}

export interface BuildWorkerStepOptions {
  /** Block-name prefix for the synthesised router (registry path only). */
  name: string;
  workers: TaskWorker | TaskWorkerRegistry;
}

/**
 * Returns a block that takes a `Task` and produces the worker's
 * output. For uniform workers the result is the worker pre-connected
 * with `Task → TaskWorkerInput`. For registries the result is a
 * router that selects by `task.assignee` and connectInputs the
 * selected block per BP-013.
 *
 * The output type is `unknown` because worker outputs are
 * heterogeneous; consumers that need a typed shape should use the
 * uniform-worker path with a worker that declares its own
 * `outputSchema`. The `routes` array is typed as
 * `BlockDefinition<any, any>[]` for the same reason — each worker in
 * a registry can declare its own input/output schemas, and the
 * router's static type can't model that union usefully (matches the
 * convention used by `dispatch-specialist` in the blackboard
 * pattern).
 */
export function buildWorkerStep(
  options: BuildWorkerStepOptions
): BlockDefinition<any, any> {
  const { name, workers } = options;

  if (isUniformWorker(workers)) {
    return workers.connectInput<Task>((task) => packWorkerInput(task)) as
      BlockDefinition<any, any>;
  }

  const routes = Object.values(workers) as BlockDefinition<any, any>[];

  return router({
    name: `${name}-worker-router`,
    inputSchema: taskSchema,
    outputSchema: z.unknown(),
    routes,
    execute: (task: Task) => {
      if (task.assignee === undefined) {
        throw new Error(
          `[task-board] task "${task.id}" has no assignee, but a worker registry was supplied`
        );
      }
      const selected = workers[task.assignee];
      if (selected === undefined) {
        throw new Error(
          `[task-board] no worker registered under assignee "${task.assignee}" for task "${task.id}"`
        );
      }
      return selected.connectInput(() => packWorkerInput(task)) as
        BlockDefinition<any, any>;
    },
  }) as BlockDefinition<any, any>;
}
