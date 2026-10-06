/**
 * `cascadeSkipDependents` — after a board drain, transitively cancels
 * any pending task whose deps include an `errored` task.
 *
 * A task-board substrate building block: consumers `.tap()` it after
 * `board.drain` to fold dep-blocked pendings into terminal `cancelled`
 * status (plan-and-execute and supervisor both wire it this way).
 * State-mutation only (no output) per BP-012.
 *
 * The handler iterates a fixed-point loop so multi-level dep chains are
 * fully drained on a single call (e.g. a → b → c, and `a` errors → `b`
 * is cancelled, then `c` is cancelled). Each cancelled task is also
 * stamped with the `"skipped"` label so `normalizeOutputStatus` can
 * translate it back to the legacy `"skipped"` status in the final
 * output. A cancel the substrate declines (the task was settled by
 * someone else first) is never labelled, and is cascaded from only when
 * the settled task is already a cascade source (a rival cascade skipped it).
 *
 * The substrate's terminal-status taxonomy uses `cancelled` for
 * deliberately-stopped work and reserves `errored` for hard failures —
 * the legacy P&E `"skipped"` semantic ("dependency failed, work cannot
 * proceed") maps onto `cancelled + label`, which is the convention
 * `parallelTasks` and the docs adopt.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { getOrCreateTaskCollection, type Task } from "../../tasks";

export interface CascadeSkipDependentsOptions {
  /** Pattern name (also used as the request collection id). */
  name: string;
}

/**
 * Whether a task's dependents must be skipped: it failed, or a cascade
 * cancelled it (the `skipped` label is that cascade's mark). The one rule
 * for both seeding the cascade set and re-reading a task whose cancel was
 * declined.
 */
function isCascadeSource(task: Pick<Task, "status" | "labels">): boolean {
  return (
    task.status === "errored" ||
    (task.status === "cancelled" && (task.labels?.includes("skipped") ?? false))
  );
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
        backing: "state",
        collectionId,
      });

      // Tasks that should cascade: every `errored` plus every `cancelled`
      // a cascade stamped `skipped` — both block downstream pendings.
      const cascading = new Set<string>(
        collection
          .list()
          .filter(isCascadeSource)
          .map((t: Task) => t.id),
      );

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
          const cancelled = await collection.cancel(task.id, `dep ${failedDep} failed`);
          // Only a cancel that landed is ours to label. The snapshot above can
          // be stale by the time the write arrives — another actor may already
          // have settled the task — and `cancel` declines rather than throws
          // then. Labelling it anyway would mark a task this pass never
          // cancelled as a dead dependency, and every later pass would skip
          // its dependents off the back of that label (FIX-985).
          if (cancelled.outcome !== "recorded") {
            // Declined, so re-read the task: it still cascades if it is a
            // source by the same rule the set was seeded with (a rival cascade
            // skipped it first), so the chain keeps walking in this call. A
            // task that was stopped or completed instead is left alone with
            // its dependents. Terminal status is absorbing, so this read
            // cannot be overtaken.
            const settled = collection.get(task.id);
            if (settled !== undefined && isCascadeSource(settled)) {
              cascading.add(task.id);
              changed = true;
            }
            continue;
          }
          await collection.addLabel(task.id, "skipped");
          cascading.add(task.id);
          changed = true;
        }
      }
    },
  });
}
