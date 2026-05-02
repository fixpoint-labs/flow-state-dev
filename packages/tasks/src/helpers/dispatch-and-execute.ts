/**
 * `dispatchAndExecuteBlock` — the canonical "claim one, execute it,
 * record the result" inner step shared by every task-shaped pattern
 * (FIX-443 §7).
 *
 * Pipeline performed when the produced block runs:
 *   1. `dispatcher.claim(collection, workerId, ctx)`
 *   2. If null → return `{ claimed: false }` (caller's loop should exit
 *      or back off).
 *   3. Pack the task into `TaskWorkerInput`, look up the worker from
 *      the registry (or use the uniform worker), invoke the worker via
 *      the substrate `_runUnchecked` entry point.
 *   4. On success → `collection.complete(taskId, output)`.
 *   5. On throw → `collection.fail(taskId, message)` and (per the
 *      `onError` policy) either swallow or rethrow.
 *
 * BP-011 / FIX-503 deviation: the produced block is a `handler` whose
 * execute invokes the worker via `asRuntime(worker)._runUnchecked`. A
 * sibling-sequencer composition would require static knowledge of the
 * worker at build time, but the worker is selected at claim time from
 * `task.assignee` against a registry. Using a router-by-assignee inside
 * a sequencer is feasible only when the registry is fully enumerated up
 * front; the substrate escape keeps the helper compatible with both the
 * uniform-worker and registry shapes without forcing patterns to
 * pre-declare every worker.
 */
import { handler } from "@flow-state-dev/core";
import { asRuntime, type BlockContext, type BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { Task } from "../schema/task";
import type { TaskCollectionRef } from "../collection/types";
import type { TaskDispatcher } from "../dispatchers/types";
import type { TaskWorker, TaskWorkerInput, TaskWorkerRegistry } from "../workers/types";

export interface DispatchAndExecuteOptions {
  collection: TaskCollectionRef;
  dispatcher: TaskDispatcher;
  /** Single uniform worker, OR a registry keyed by `task.assignee`. */
  workers: TaskWorker | TaskWorkerRegistry;
  /**
   * Worker id for trace attribution. Most patterns hand a stable
   * `worker-${index}` from a forEach. Default: `"worker"`.
   */
  workerId?: string;
  /**
   * Failure policy. Default: `"skip"` — capture the error on the
   * task via `fail` and return; siblings continue. `"fail"` rethrows
   * after `fail` so the parent sequencer fails, too.
   */
  onError?: "skip" | "fail";
  /**
   * Optional name override. Default: `"dispatch-and-execute"`. Useful
   * when a pattern uses the helper multiple times in the same sequencer
   * and needs distinct trace identities.
   */
  name?: string;
}

export interface DispatchAndExecuteResult<TOut = unknown> {
  /** True when a task was claimed and executed (regardless of success). */
  claimed: boolean;
  /** Claimed task id when `claimed === true`. */
  taskId?: string;
  /** Worker output when execution succeeded. */
  output?: TOut;
  /** Error message when execution failed and `onError: "skip"` swallowed it. */
  error?: string;
}

/**
 * A `BlockDefinition` exposes a callable substrate dispatch entry point;
 * a registry is a plain record of named blocks. Discriminate on `_run`
 * rather than on `kind`-key presence — the latter would misroute a
 * registry that happens to use `"kind"` as an assignee key.
 */
function isUniformWorker(
  workers: TaskWorker | TaskWorkerRegistry
): workers is TaskWorker {
  return typeof (workers as { _run?: unknown })._run === "function";
}

function resolveWorker(
  workers: TaskWorker | TaskWorkerRegistry,
  task: Task
): TaskWorker {
  if (isUniformWorker(workers)) return workers;

  const assignee = task.assignee;
  if (assignee === undefined) {
    throw new Error(
      `[tasks] dispatchAndExecute: task "${task.id}" has no assignee, but a worker registry was supplied`
    );
  }
  const worker = workers[assignee];
  if (worker === undefined) {
    throw new Error(
      `[tasks] dispatchAndExecute: no worker registered under assignee "${assignee}" for task "${task.id}"`
    );
  }
  return worker;
}

/**
 * Pack a `Task` into the substrate's `TaskWorkerInput` shape. When the
 * task declares `deps`, this resolves each dep's `output` from the
 * collection and exposes them under `deps: Record<depId, output>`.
 * Workers that need upstream context read `input.deps` directly.
 */
function packWorkerInput(
  task: Task,
  collection: TaskCollectionRef,
): TaskWorkerInput {
  const deps: Record<string, unknown> = {};
  if (task.deps !== undefined) {
    for (const depId of task.deps) {
      const depTask = collection.get(depId);
      if (depTask !== undefined && depTask.output !== undefined) {
        deps[depId] = depTask.output;
      }
    }
  }
  return {
    taskId: task.id,
    goal: task.goal,
    input: task.input,
    attempts: task.attempts,
    feedback: task.feedback,
    metadata: task.metadata,
    ...(Object.keys(deps).length > 0 ? { deps } : {}),
  };
}

/**
 * Build a block that performs one claim → execute → record cycle.
 * Patterns compose this via `.then(dispatchAndExecuteBlock(...))` in
 * their own sequencer chains. Replaces the pre-FIX-503 free-function
 * helper that callers invoked from inside their own handler bodies
 * (BP-011 violation).
 */
export function dispatchAndExecuteBlock<TOut = unknown>(
  options: DispatchAndExecuteOptions
): BlockDefinition {
  const workerId = options.workerId ?? "worker";
  const onError = options.onError ?? "skip";
  const name = options.name ?? "dispatch-and-execute";

  return handler({
    name,
    inputSchema: z.unknown(),
    outputSchema: z.object({
      claimed: z.boolean(),
      taskId: z.string().optional(),
      output: z.unknown().optional(),
      error: z.string().optional(),
    }),
    execute: async (_input, ctx: BlockContext): Promise<DispatchAndExecuteResult<TOut>> => {
      const claimed = await options.dispatcher.claim(options.collection, workerId, ctx);
      if (claimed === null) {
        return { claimed: false };
      }

      const worker = resolveWorker(options.workers, claimed);
      const workerInput = packWorkerInput(claimed, options.collection);

      try {
        // Substrate path (FIX-503): the worker is selected dynamically from
        // `task.assignee`, so it can't be wired into a static sibling-step
        // sequencer composition. `_runUnchecked` is the sanctioned escape
        // for first-party substrate dispatch.
        const output = (await asRuntime(worker)._runUnchecked(workerInput, ctx)) as TOut;
        await options.collection.complete(claimed.id, output);
        return { claimed: true, taskId: claimed.id, output };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await options.collection.fail(claimed.id, message);
        if (onError === "fail") throw err;
        return { claimed: true, taskId: claimed.id, error: message };
      }
    },
  });
}
