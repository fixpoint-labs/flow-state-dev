/**
 * Run a claimed task through the configured worker.
 *
 * Resolves a `Task` to its worker — uniform if `workers` is a single
 * block, otherwise registry lookup by `task.assignee`. Packs the
 * substrate's `TaskWorkerInput` shape and invokes the worker. Captures
 * the output or the thrown error and returns it as a tagged result —
 * does NOT write back to the collection. That's `recordResult`'s job
 * (so the two are independently composable).
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import type {
  Task,
  TaskWorker,
  TaskWorkerInput,
  TaskWorkerRegistry,
} from "@flow-state-dev/tasks";

export interface RunWorkerOptions {
  name: string;
  /** Single uniform worker, OR a registry keyed by `task.assignee`. */
  workers: TaskWorker | TaskWorkerRegistry;
}

export interface RunWorkerInput {
  /** The claimed task to run — typically piped from `claimTask`. */
  task: Task;
}

export type RunWorkerOutput =
  | { taskId: string; ok: true; output: unknown }
  | { taskId: string; ok: false; error: string };

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
      `[task-board] runWorker: task "${task.id}" has no assignee, but a worker registry was supplied`
    );
  }
  const worker = workers[assignee];
  if (worker === undefined) {
    throw new Error(
      `[task-board] runWorker: no worker registered under assignee "${assignee}" for task "${task.id}"`
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

export function createRunWorker(options: RunWorkerOptions) {
  const { name, workers } = options;
  return handler({
    name,
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (input: RunWorkerInput, ctx): Promise<RunWorkerOutput> => {
      const task = input.task;
      if (task === undefined) {
        throw new Error(
          `[task-board] runWorker: missing task on input — pipe from claimTask`
        );
      }
      const worker = resolveWorker(workers, task);
      try {
        const output = await worker.run(packWorkerInput(task), ctx);
        return { taskId: task.id, ok: true, output };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { taskId: task.id, ok: false, error: message };
      }
    },
  });
}
