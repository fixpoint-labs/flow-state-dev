/**
 * workstream-vet — the session-lived board.
 *
 * The seam this vet exists to exercise: a `taskBoard` driven through its
 * collection-FACTORY slot with a resource-backed collection over the
 * session-scoped `wsvetTasks` resource collection — the cross-request
 * backing none of the built-in factories expose.
 *
 * Idle mode is `wait` + a local `shouldExit`: `complete-or-blocked` counts
 * `awaiting_review` as in-flight (FIX-443 §10.1) and would spin on the open
 * human task. The claimable predicate is inlined (~5 lines) because the
 * substrate's `hasClaimableTask` is not exported from the public subpath and
 * this prototype is zero-`packages/*` by rule.
 */
import { taskBoard } from "@flow-state-dev/patterns";
import {
  getOrCreateTaskCollection,
  type TaskCollectionRef,
} from "@flow-state-dev/tasks";
import { BOARD_COLLECTION_ID, DRAFTER } from "./resources";
import { drafterWorker } from "./drafter";

/**
 * Build the board's `TaskCollectionRef` from any block context. Fresh per
 * call — the resource backing hydrates its sync mirror at construction, so
 * re-calling picks up tasks other blocks created since.
 */
export async function boardCollection(ctx: any): Promise<TaskCollectionRef> {
  return getOrCreateTaskCollection({
    backing: "resource",
    collectionId: BOARD_COLLECTION_ID,
    collection: ctx.resources.wsvetTasks,
    ctx,
  });
}

/** Local claimable predicate: a `pending` task whose deps are all `completed`. */
export function hasClaimable(collection: TaskCollectionRef): boolean {
  const completed = new Set(
    collection.list({ status: "completed" }).map((t) => t.id),
  );
  return collection
    .list({ status: "pending" })
    .some((t) => (t.deps ?? []).every((d) => completed.has(d)));
}

export const board = taskBoard({
  name: "wsvet-board",
  collection: (ctx) => boardCollection(ctx),
  // Registry form: routes by `task.assignee` (and throws on a claimable task
  // without one) — so every draft/revise task is seeded with `assignee:
  // "drafter"`, and human tasks are born `awaiting_review` (never claimable).
  workers: { [DRAFTER]: drafterWorker },
  concurrency: 1,
  dispatcher: "topological",
  onIdle: "wait",
  // Exit when nothing is running and nothing is claimable — i.e. when only
  // human-blocked (or terminal) work remains. This is what lets a request
  // END while the workstream stays open.
  shouldExit: (c) => c.count({ status: "in_progress" }) === 0 && !hasClaimable(c),
});
