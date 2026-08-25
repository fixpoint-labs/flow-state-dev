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
 * Every refusal here is fatal and none degrades to a warning. A caller who
 * wanted one of these combinations has a coherent intent, and the honest answer
 * is to say what is in the way while they are still writing the board. The
 * alternative is worse than it sounds: each of these configurations *half*
 * works — one is a total no-op, one runs correctly until a task gains a
 * dependent, one grows a duplicate only on the second drain — so a warning gets
 * ignored and the board ships behaving almost right.
 *
 * The throws below carry their own diagnosis and their own fix; the comments do
 * not repeat them, and say only what the message cannot.
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

  if (backing !== "resource") {
    throw new Error(
      `[task-board] "${name}" sets \`onReview: "exit"\` on a ${backing}-backed collection — ` +
        `a parked task has to outlive the drain that released it so a later drain can ` +
        `pick it up once it is resumed. Pass a defineTaskCollection() to \`collection\`.`
    );
  }

  if (onIdle === "wait") {
    throw new Error(
      `[task-board] "${name}" sets \`onReview: "exit"\` with \`onIdle: "wait"\` — ` +
        `that mode never consults the in-flight counts park-exit modifies, so the option ` +
        `would do nothing at all. Your \`shouldExit\` predicate already owns termination ` +
        `here: return true from it when the only rows left are parked. Otherwise return ` +
        `to the default \`onIdle\` ("complete-or-blocked").`
    );
  }

  // Excusing the parked row's *dependents* too was the obvious alternative to
  // refusing, and was rejected: it needs a transitive dependency walk on the
  // hottest read the board has (§6 decision 3).
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

  // Precedented, not invented here: `goalSeekLoop` gates the same combination on
  // `maxIterations > 1 && board.hasIdlessInitialTasks`, for the other feature
  // that makes board re-entry the norm. Park-exit is that situation under
  // another name, which is why it reads the flag the board already exposes
  // rather than inspecting the seed itself.
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
