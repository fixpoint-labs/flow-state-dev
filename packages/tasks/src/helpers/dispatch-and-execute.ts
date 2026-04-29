/**
 * `dispatchAndExecute` — the canonical "claim one, execute it, record
 * the result" inner step shared by every task-shaped pattern (FIX-443
 * §7).
 *
 * Pipeline:
 *   1. `dispatcher.claim(collection, workerId, ctx)`
 *   2. If null → return `{ claimed: false }` (caller's loop should exit
 *      or back off).
 *   3. Pack the task into `TaskWorkerInput`, look up the worker from
 *      the registry (or use the uniform worker), invoke `worker.run`.
 *   4. On success → `collection.complete(taskId, output)`.
 *   5. On throw → `collection.fail(taskId, message)` and (per the
 *      `onError` policy) either swallow or rethrow.
 *
 * The substrate keeps this helper deliberately small. Patterns that
 * need different shapes (e.g., concurrent N-worker drains) compose
 * `dispatchAndExecute` inside `forEach` / `loopBack` themselves.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
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
 * A `BlockDefinition` exposes a callable `run`; a registry is a plain
 * record of named blocks. Discriminate on `run` rather than on
 * `kind`-key presence — the latter would misroute a registry that
 * happens to use `"kind"` as an assignee key.
 */
function isUniformWorker(
  workers: TaskWorker | TaskWorkerRegistry
): workers is TaskWorker {
  return typeof (workers as { run?: unknown }).run === "function";
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

function packWorkerInput(task: Task): TaskWorkerInput {
  return {
    taskId: task.id,
    goal: task.goal,
    input: task.input,
    attempts: task.attempts,
    feedback: task.feedback,
    metadata: task.metadata,
  };
}

/**
 * Run one claim → execute → record cycle.
 *
 * This is a free function rather than a block factory so patterns can
 * call it inline inside their own handler `execute` bodies. A pattern
 * that wants a block-shaped wrapper can `handler({ execute: (...) =>
 * dispatchAndExecute(...) })` themselves.
 */
export async function dispatchAndExecute<TOut = unknown>(
  options: DispatchAndExecuteOptions,
  ctx: BlockContext
): Promise<DispatchAndExecuteResult<TOut>> {
  const workerId = options.workerId ?? "worker";
  const onError = options.onError ?? "skip";

  const claimed = await options.dispatcher.claim(options.collection, workerId, ctx);
  if (claimed === null) {
    return { claimed: false };
  }

  const worker = resolveWorker(options.workers, claimed);
  const workerInput = packWorkerInput(claimed);

  try {
    const output = (await worker.run(workerInput, ctx)) as TOut;
    await options.collection.complete(claimed.id, output);
    return { claimed: true, taskId: claimed.id, output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await options.collection.fail(claimed.id, message);
    if (onError === "fail") throw err;
    return { claimed: true, taskId: claimed.id, error: message };
  }
}
