/**
 * `cascadeSkipDependents` — after a board drain, transitively cancels
 * any pending task whose deps include an `errored` task.
 *
 * A task-board substrate building block: consumers `.tap()` it after
 * `board.block` to fold dep-blocked pendings into terminal `cancelled`
 * status (plan-and-execute and supervisor both wire it this way).
 * State-mutation only (no output) per BP-012.
 *
 * The handler iterates a fixed-point loop so multi-level dep chains are
 * fully drained on a single call (e.g. a → b → c, and `a` errors → `b`
 * is cancelled, then `c` is cancelled). Each cancelled task is also
 * stamped with the `"skipped"` label so `normalizeOutputStatus` can
 * translate it back to the legacy `"skipped"` status in the final
 * output.
 *
 * The substrate's terminal-status taxonomy uses `cancelled` for
 * deliberately-stopped work and reserves `errored` for hard failures —
 * the legacy P&E `"skipped"` semantic ("dependency failed, work cannot
 * proceed") maps onto `cancelled + label`, which is the convention
 * `parallelTasks` and the docs adopt.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { getOrCreateTaskCollection, type Task } from "@flow-state-dev/tasks";

export interface CascadeSkipDependentsOptions {
  /** Pattern name (also used as the request collection id). */
  name: string;
}

/** Build the cascade-skip handler. Wired in via `.tap()`. */
export function createCascadeSkipDependents(
  options: CascadeSkipDependentsOptions,
) {
  const { name } = options;
  const collectionId = name;

  return handler({
    name: `${name}-cascade-skip`,
    inputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      const collection = await getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });

      // Tasks that should cascade: every `errored` plus every `cancelled`
      // we ourselves stamped this pass — both block downstream pendings.
      const cascading = new Set<string>(
        collection
          .list({ status: "errored" })
          .map((t: Task) => t.id),
      );
      for (const t of collection.list({ status: "cancelled" })) {
        if (t.labels?.includes("skipped")) {
          cascading.add(t.id);
        }
      }

      if (cascading.size === 0) return;

      // Fixed-point: keep cancelling until no pending task is blocked.
      let changed = true;
      while (changed) {
        changed = false;
        const pending = collection.list({ status: "pending" });
        for (const task of pending) {
          const deps = task.deps ?? [];
          const failedDep = deps.find((d) => cascading.has(d));
          if (failedDep === undefined) continue;
          await collection.cancel(task.id, `dep ${failedDep} failed`);
          await collection.addLabel(task.id, "skipped");
          cascading.add(task.id);
          changed = true;
        }
      }
    },
  });
}
