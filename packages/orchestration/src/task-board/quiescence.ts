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
 * request. A board with a `dispatcher({ type: "task" })` seat breaks that
 * equivalence: the hand-off leaves the row `in_progress`, owned by a child session
 * that settles it from its own session, and the launching request has no more
 * work to do on it. Counting it kept that request parked in `idleWait` until
 * the child finished — the whole point of handing off, undone by the exit
 * question.
 *
 * So the classifier now takes `runsElsewhere` and both of its counting arms
 * honour it. It is supplied by the board from its own dispatcher seats,
 * and is `undefined` for every board that declares none — an inline board's
 * `in_progress` row still holds the drain open, unchanged and deliberately so.
 *
 * **The exclusion holds only while the row's lease does.** `runsElsewhere` says
 * where a row's work belongs; the lease says whether anyone is on it, and a
 * claimant that died before its child ever started leaves a row that is
 * handed off by routing and abandoned in fact. So `countWaitable` requires both,
 * and a lapsed handed-off row goes back to holding the drain open until it is
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
 *
 * ## `onReview: "exit"` is the second exclusion, and it threads the same way
 *
 * A board in park-exit mode (FIX-1234) excuses rows parked for a human from
 * both counting arms — see `countWaitable` in `shared.ts` for why that is a
 * predicate of its own rather than a widening of the routing one, and why it
 * carries no liveness conjunct. Like `runsElsewhere` it is supplied by the
 * board to *both* readers, never defaulted per call site.
 *
 * The board also has to report *why* it stopped, and the fact that rows were
 * excused as parked is knowable only here, at the decision. By the time the
 * completion item runs the pool has finished and it re-reads the collection —
 * a resume landing in that window turns the parked row back into a `pending`
 * one, and a reason inferred from the rows at that moment calls a successful
 * review exit a failure. So {@link classifyBoard} returns the excusal
 * alongside the verdict and the exit check carries it out; `boardQuiescence`
 * is the same classification with that half dropped, for the wake test, which
 * only ever asks whether the board is still going.
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
   * Rows whose work is *routed* to a child session rather than this drain
   * (FIX-982). Omitted by every board with no dispatcher seat, which is
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
  /**
   * Rows parked for a human, on a board that declared `onReview: "exit"`
   * (FIX-1234). Omitted — and therefore `false` — for every board on the
   * default, which is what keeps this classifier's answer for those boards
   * bit-for-bit what it was.
   *
   * Threaded to **both** callers by the board, exactly like `runsElsewhere`
   * and for the same reason.
   */
  excuseParked?: boolean;
}

/**
 * The board's state, and whether the park exclusion is why.
 *
 * `excusedParked` is true only when this classification is a *terminal* one
 * (the drain is stopping) and at least one row was dropped from the counts
 * because it is parked for a human. On a `continue` verdict it is false: the
 * drain did not stop, so nothing was excused causally.
 */
export interface BoardClassification {
  verdict: BoardQuiescence;
  excusedParked: boolean;
}

/**
 * Classify the board's current state, and report whether parked rows were
 * excused to reach it. Synchronous and read-only: a handful of count/list
 * reads over the collection's sync view, cheap enough to run on every
 * idle-wait fan-out event.
 *
 * The one implementation of the exit question. {@link boardQuiescence} is this
 * function with the causal half dropped.
 */
export function classifyBoard(
  collection: TaskCollectionRef,
  options: BoardQuiescenceOptions
): BoardClassification {
  if (options.onIdle === "wait") {
    // `"wait"` never consults the counts, so park-exit cannot reach it. That is
    // why the board refuses the combination at construction rather than
    // shipping an option that quietly does nothing here (`park-exit.ts`).
    return {
      verdict: options.shouldExit?.(collection) === true ? "exit" : "continue",
      excusedParked: false,
    };
  }
  const excuseParked = options.excuseParked === true;
  // Drained dominates: every task reached a terminal status, was handed to a
  // child session that this drain is not the one waiting on, or is parked for a
  // human this drain was told not to wait on.
  const inFlight = inFlightCount(collection, options.runsElsewhere, excuseParked);
  if (inFlight.waiting === 0) {
    return { verdict: "drained", excusedParked: inFlight.excusedParked };
  }
  if (options.onIdle === "complete") {
    return { verdict: "continue", excusedParked: false };
  }
  const active = activeWorkerCount(collection, options.runsElsewhere, excuseParked);
  if (active.waiting === 0 && !hasClaimableTask(collection)) {
    // The parked row's `pending` dependent is what kept `inFlight` non-zero;
    // excusing the parked row is still why the board is stopping rather than
    // spinning, so the excusal is carried from here too.
    return { verdict: "blocked", excusedParked: active.excusedParked };
  }
  return { verdict: "continue", excusedParked: false };
}

/**
 * The board's verdict alone — the wake test's half of {@link classifyBoard}.
 *
 * Kept as its own name because the idle-wait predicate asks only "is this board
 * still going", and giving it the causal half to ignore would invite a second
 * opinion about what that half means.
 */
export function boardQuiescence(
  collection: TaskCollectionRef,
  options: BoardQuiescenceOptions
): BoardQuiescence {
  return classifyBoard(collection, options).verdict;
}
