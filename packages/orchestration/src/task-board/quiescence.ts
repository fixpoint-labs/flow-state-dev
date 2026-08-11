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
 * - `drained` — nothing is left for THIS drain to wait on. Dominates the
 *   others.
 * - `blocked` — no worker is producing state changes and no `pending` task can
 *   be claimed (every remaining one has a non-`completed` dep), so continuing
 *   would spin forever. `complete-or-blocked` only.
 * - `exit` — `onIdle: "wait"` and the caller's `shouldExit` said to stop.
 * - `continue` — there is still something to wait on.
 *
 * ## "for this drain" is the FIX-982 change, and it is not a widening
 *
 * `drained` used to mean "every task reached a terminal status", which was the
 * same sentence as the one above while every worker ran inside the claiming
 * request. A board declaring `dispatch: { mode: "detached" }` breaks that
 * equivalence: the hand-off leaves the row `in_progress`, owned by a Workstream
 * that settles it from its own session, and the launching request has no more
 * work to do on it. Counting it kept that request parked in `idleWait` until
 * the child finished — the whole point of detaching, undone by the exit
 * question.
 *
 * So the classifier now takes `runsElsewhere` and both of its counting arms
 * honour it. It is supplied by the board from its own detached declarations,
 * and is `undefined` for every board that declares none — an inline board's
 * `in_progress` row still holds the drain open, unchanged and deliberately so.
 *
 * **The exclusion holds only while the row's lease does.** `runsElsewhere` says
 * where a row's work belongs; the lease says whether anyone is on it, and a
 * claimant that died before its child ever started leaves a row that is
 * detached by routing and abandoned in fact. So `countWaitable` requires both,
 * and a lapsed detached row goes back to holding the drain open until it is
 * reclaimed. That also keeps this classifier agreeing with the wake test either
 * side of the lapse: `hasClaimableTask` reads the same lease, so before the
 * lapse a handed-off row is invisible to both, and after it the wake test stirs
 * a worker into an exit check that no longer calls the board drained.
 *
 * The exit check maps a non-`continue` verdict straight onto its `reason`. The
 * wake test needs one thing more: a board can hold newly claimable work while
 * this classifier correctly reads `continue`, and a worker asleep through that
 * is the promptness defect. So the wake test is
 * `hasClaimableTask(c) || boardQuiescence(c, opts) !== "continue"` — the
 * claimable disjunct is deliberate and load-bearing, not redundant.
 */
import type { TaskCollectionRef } from "../tasks";
import {
  activeWorkerCount,
  hasClaimableTask,
  inFlightCount,
  type RunsElsewhere,
} from "./shared";

/** What the board's exit question currently answers. See the file header. */
export type BoardQuiescence = "drained" | "blocked" | "exit" | "continue";

export interface BoardQuiescenceOptions {
  onIdle: "wait" | "complete" | "complete-or-blocked";
  /** `onIdle: "wait"` only — the caller's own termination test. */
  shouldExit?: (collection: TaskCollectionRef) => boolean;
  /**
   * Rows whose work is *routed* to a Workstream rather than this drain
   * (FIX-982). Omitted by every board that declares nothing detached, which is
   * what keeps this classifier's answer for those boards bit-for-bit what it
   * was.
   *
   * Routing alone does not excuse a row from the count — the row's lease has to
   * still be held. See `countWaitable` in `shared.ts`.
   *
   * Passed to **both** callers by the board that built them, never defaulted
   * per call site — the two answering this question differently is the exact
   * drift this module was collapsed to remove.
   */
  runsElsewhere?: RunsElsewhere;
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
  // Drained dominates: every task reached a terminal status, or was handed to
  // a Workstream that this drain is not the one waiting on.
  if (inFlightCount(collection, options.runsElsewhere) === 0) return "drained";
  if (options.onIdle === "complete") return "continue";
  return activeWorkerCount(collection, options.runsElsewhere) === 0 &&
    !hasClaimableTask(collection)
    ? "blocked"
    : "continue";
}
