/**
 * `applyReplan` — adds replanner-produced tasks to the active board's
 * collection during a replan iteration.
 *
 * Runs after either:
 *   - the replanner block (when `evaluatePlanProgress` returned
 *     `decision: "replan"` without pre-baked `tasks`), or
 *   - the evaluator itself (when the evaluator returned `tasks` inline,
 *     skipping the replanner step).
 *
 * Returns `{ decision: "continue" }` so the loop predicate
 * (`r.decision !== "complete"`) keeps the board re-entry alive for one
 * more iteration. If the replanner emits a task whose `id` collides
 * with an existing collection entry the substrate's `addTask` throws —
 * that's a hard contract violation by the replanner and intentionally
 * propagates.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  getOrCreateTaskCollection,
  type TaskInit,
} from "@flow-state-dev/tasks";
import { planAndExecuteStateSchema } from "../schemas";

export interface ApplyReplanOptions {
  /** Pattern name (also used as the request collection id). */
  name: string;
  /** Default `maxAttempts` to stamp on tasks that don't carry one. */
  maxAttemptsPerTask: number;
}

/**
 * Build the apply-replan handler. The input may carry the evaluator's
 * pre-baked tasks OR the replanner's output; either way we expect a
 * `tasks: TaskInit[]` array.
 */
export function createApplyReplan(options: ApplyReplanOptions) {
  const { name, maxAttemptsPerTask } = options;
  const collectionId = name;

  return handler({
    name: `${name}-apply-replan`,
    inputSchema: z
      .object({
        tasks: z.array(
          z
            .object({
              id: z.string().optional(),
              goal: z.string(),
              deps: z.array(z.string()).optional(),
              dependencies: z.array(z.string()).optional(),
              priority: z.union([z.number(), z.string()]).optional(),
              maxAttempts: z.number().optional(),
              input: z.unknown().optional(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
    outputSchema: z.object({
      decision: z.enum(["continue", "replan", "complete"]).default("continue"),
    }),
    sequencerStateSchema: planAndExecuteStateSchema,

    execute: async (input, ctx) => {
      const collection = getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });

      const tasks: TaskInit[] = input.tasks.map((t) => ({
        ...(t.id !== undefined ? { id: t.id } : {}),
        goal: t.goal,
        deps: t.deps ?? t.dependencies ?? [],
        ...(typeof t.priority === "number" ? { priority: t.priority } : {}),
        ...(t.input !== undefined ? { input: t.input } : {}),
        maxAttempts: t.maxAttempts ?? maxAttemptsPerTask,
      }));

      if (tasks.length > 0) {
        await collection.addTasks(tasks);
      }

      return { decision: "continue" as const };
    },
  });
}
