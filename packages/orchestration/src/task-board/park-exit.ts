/**
 * Park-exit: the board mode that says "a task parked for review is not mine to
 * wait on" (FIX-1234).
 *
 * A worker that parks a task for a human leaves the row `awaiting_review`, and
 * that status has always held the drain open. Nobody waits on a human for the
 * length of a request on purpose, so what actually happened was worse than a
 * wait: the drain ran out its iteration budget — silently — and returned with
 * the parked row abandoned where it sat.
 *
 * This mode excuses parked rows from the board's waitable count, so the drain
 * finishes and returns while the row stays parked and durable. A later
 * `resumeFromReview` re-queues it for whatever drains the board next.
 *
 * **Off by default, and a detached board has to ask for it too.** Turning it on
 * moves *when* an existing caller's request resolves, so it is never inferred
 * from anything the board already declares.
 *
 * ## What lives here
 *
 * The option type and the construction-time refusals — the same split
 * `./detached.ts` uses, and for the same reason: what a declaration *means* and
 * which declarations cannot work are decided once, away from the drain that
 * composes them. The exclusion itself is a status test inside `shared.ts`'s
 * waitable count, where the board's one exit question already lives.
 */
import type { TaskBoardBacking } from "./index";

/**
 * What the board does when the only work left is parked for review.
 *
 * - `"hold"` — keep the drain open until the row leaves `awaiting_review`.
 *   The default, and what every board does today.
 * - `"exit"` — excuse parked rows from the drain's waitable count: the drain
 *   returns, reports `terminationReason: "parked-for-review"`, and leaves the
 *   row parked for a later drain to pick up once it is resumed.
 *
 * Kept separate from `onIdle` deliberately. Folding the two would turn a
 * coherent-but-unsupported combination (`onIdle: "complete"` with park-exit)
 * into a configuration that cannot be spelled at all — and the whole point of
 * the refusals below is that such a combination is told to the caller, loudly,
 * rather than silently absent.
 */
export type TaskBoardOnReview = "hold" | "exit";

/**
 * Refuse the board configurations park-exit cannot serve — at construction, by
 * name, with the fix.
 *
 * All three are fatal and none degrades to a warning. A caller who wanted one
 * of these combinations has a coherent intent, and the honest answer is to say
 * what is in the way while they are still writing the board — not to hand back
 * one that half-works and fails in production on a dependency graph nobody
 * tested.
 *
 * Shape and register follow `assertDetachedBoardSupported`: name the board,
 * name what it declared, name what to change.
 */
export function assertParkExitSupported(options: {
  name: string;
  onReview: TaskBoardOnReview;
  backing: TaskBoardBacking;
  onIdle: "wait" | "complete" | "complete-or-blocked";
  hasIdlessInitialTasks: boolean;
}): void {
  const { name, onReview, backing, onIdle, hasIdlessInitialTasks } = options;
  if (onReview !== "exit") return;

  // The mode's promise is that the parked row survives the drain that released
  // it, for a *later* drain to claim once a human resumes it. On any backing
  // whose lifetime is the request (or shorter), that later drain has nothing to
  // come back to: the exit would simply drop the task on the floor, which is
  // the abandonment this mode exists to stop, arrived at deliberately.
  if (backing !== "resource") {
    throw new Error(
      `[task-board] "${name}" sets \`onReview: "exit"\` on a ${backing}-backed collection — ` +
        `a parked task has to outlive the drain that released it so a later drain can ` +
        `pick it up once it is resumed. Pass a defineTaskCollection() to \`collection\`.`
    );
  }

  // `"wait"` never reaches the counts the option modifies: `boardQuiescence`
  // answers that mode from `shouldExit` alone. The option would be a total
  // no-op — the failure mode that survives every test, because nothing about it
  // looks wrong.
  if (onIdle === "wait") {
    throw new Error(
      `[task-board] "${name}" sets \`onReview: "exit"\` with \`onIdle: "wait"\` — ` +
        `that mode never consults the in-flight counts park-exit modifies, so the option ` +
        `would do nothing at all. Your \`shouldExit\` predicate already owns termination ` +
        `here: return true from it when the only rows left are parked. Otherwise return ` +
        `to the default \`onIdle\` ("complete-or-blocked").`
    );
  }

  // `"complete"` is the dangerous one, because it *works* — right up until the
  // parked task has a dependent. That mode exits only on a fully drained board,
  // so a `pending` row waiting on the parked one keeps the drain open however
  // the parked row itself is counted. The result is an option that works on a
  // leaf and stops working the moment the dep graph grows, which is worse than
  // a total no-op: it survives testing.
  //
  // Excusing the dependents too was rejected — it needs a transitive dependency
  // walk on the hottest read the board has (§6 decision 3).
  if (onIdle === "complete") {
    throw new Error(
      `[task-board] "${name}" sets \`onReview: "exit"\` with \`onIdle: "complete"\` — ` +
        `that mode exits only on a fully drained board, so a \`pending\` task that depends ` +
        `on the parked one still holds the drain open. Park-exit would work while the ` +
        `parked task is a leaf and silently stop working the day it gains a dependent. ` +
        `Return to the default \`onIdle\` ("complete-or-blocked"), which exits \`blocked\` ` +
        `once the parked row is excused and nothing else can be claimed.`
    );
  }

  // Park-exit makes "a later drain re-runs this board" the normal path, and the
  // drain chain taps the seed step *before* the worker pool — so the next drain
  // re-seeds. `createSeedCollection`'s replay dedupe is keyed on a seed entry's
  // id and skips entries that have none, so an id-less entry is added again on
  // every pass and the resumed board grows a duplicate task the next drain may
  // run or park all over again.
  //
  // Precedented, not invented here: `goalSeekLoop` gates the same combination
  // on `maxIterations > 1 && board.hasIdlessInitialTasks`, for the other feature
  // that makes board re-entry the norm. Park-exit is that situation under
  // another name.
  if (hasIdlessInitialTasks) {
    throw new Error(
      `[task-board] "${name}" sets \`onReview: "exit"\` on a board whose \`initialTasks\` ` +
        `carry no stable id — park-exit makes a later drain the normal path, and the seed ` +
        `step re-runs ahead of the worker pool on every drain. An id-less entry is added ` +
        `again each pass, so the resumed board grows a duplicate task. Give each ` +
        `initialTask an explicit \`id\`.`
    );
  }
}
