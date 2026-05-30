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
 * more iteration.
 *
 * Id-collision handling: an LLM replanner naturally re-emits ids that
 * already exist in the collection (e.g. it asks to "redo task-1"). The
 * substrate's `addTasks` rejects duplicates, so we auto-suffix the
 * conflicting ids with `-replan-N` and remap any within-batch deps that
 * referenced the original id. The replanner's intent — adding fresh
 * work — is preserved without breaking referential integrity inside
 * the batch.
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
      const collection = await getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });

      const taken = new Set(collection.list().map((t) => t.id));

      // Build a remap from the replanner's chosen id (if any) to the id
      // we'll actually use. Suffix duplicates so the LLM's natural
      // "redo task-1" output doesn't collide with the original.
      const idRemap = new Map<string, string>();
      for (const t of input.tasks) {
        if (t.id === undefined) continue;
        let candidate = t.id;
        let suffix = 1;
        while (taken.has(candidate)) {
          candidate = `${t.id}-replan-${suffix}`;
          suffix++;
        }
        idRemap.set(t.id, candidate);
        taken.add(candidate);
      }

      const tasks: TaskInit[] = input.tasks.map((t) => {
        const remappedId =
          t.id !== undefined ? idRemap.get(t.id) : undefined;
        const rawDeps = t.deps ?? t.dependencies ?? [];
        const remappedDeps = rawDeps.map((d) => idRemap.get(d) ?? d);
        return {
          ...(remappedId !== undefined ? { id: remappedId } : {}),
          goal: t.goal,
          deps: remappedDeps,
          ...(typeof t.priority === "number" ? { priority: t.priority } : {}),
          ...(t.input !== undefined ? { input: t.input } : {}),
          maxAttempts: t.maxAttempts ?? maxAttemptsPerTask,
        };
      });

      if (tasks.length > 0) {
        await collection.addTasks(tasks);
      }

      return { decision: "continue" as const };
    },
  });
}
