/**
 * The one definition of a task board's exit question (FIX-990).
 *
 * Two blocks need to know whether a board still has work to do: the worker's
 * idle-wait predicate (`predicates.ts`), which decides whether a sleeping
 * worker should stir, and the exit check (`blocks/check-board.ts`), which
 * decides whether the worker loop keeps iterating. They used to answer it with
 * two hand-written spellings, and those had already drifted — the wake test
 * treated "no in-flight worker" as terminal while the exit check additionally
 * required "and nothing is claimable" before calling a board `blocked`.
 *
 * Collapsing them here is behaviour-preserving DRY, not part of the fix for
 * the stale-view bug this issue is about. It earns its place by removing a live
 * drift risk in the exact pair of functions that bug taught us to distrust.
 *
 * Verdicts:
 *
 * - `drained` — every task reached a terminal status. Dominates the others.
 * - `blocked` — no worker is producing state changes and no `pending` task can
 *   be claimed (every remaining one has a non-`completed` dep), so continuing
 *   would spin forever. `complete-or-blocked` only.
 * - `exit` — `onIdle: "wait"` and the caller's `shouldExit` said to stop.
 * - `continue` — there is still something to wait on.
 *
 * The exit check maps a non-`continue` verdict straight onto its `reason`. The
 * wake test needs one thing more: a board can hold newly claimable work while
 * this classifier correctly reads `continue`, and a worker asleep through that
 * is the promptness defect. So the wake test is
 * `hasClaimableTask(c) || boardQuiescence(c, opts) !== "continue"` — the
 * claimable disjunct is deliberate and load-bearing, not redundant.
 */
import type { TaskCollectionRef } from "../tasks";
import { hasClaimableTask, inFlightCount } from "./shared";

/** What the board's exit question currently answers. See the file header. */
export type BoardQuiescence = "drained" | "blocked" | "exit" | "continue";

export interface BoardQuiescenceOptions {
  onIdle: "wait" | "complete" | "complete-or-blocked";
  /** `onIdle: "wait"` only — the caller's own termination test. */
  shouldExit?: (collection: TaskCollectionRef) => boolean;
}

/**
 * Classify the board's current state. Synchronous and read-only: a handful of
 * count/list reads over the collection's sync view, cheap enough to run on
 * every idle-wait fan-out event.
 */
export function boardQuiescence(
  collection: TaskCollectionRef,
  options: BoardQuiescenceOptions
): BoardQuiescence {
  if (options.onIdle === "wait") {
    return options.shouldExit?.(collection) === true ? "exit" : "continue";
  }
  // Drained dominates: every task reached a terminal status.
  if (inFlightCount(collection) === 0) return "drained";
  if (options.onIdle === "complete") return "continue";
  return collection.count({ status: ["in_progress", "awaiting_review"] }) === 0 &&
    !hasClaimableTask(collection)
    ? "blocked"
    : "continue";
}
