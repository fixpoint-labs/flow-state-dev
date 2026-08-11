/**
 * Shared helpers for the Task Board pattern.
 *
 * Centralizes dispatcher resolution, ready-task filtering, and the
 * "any-work-still-in-flight" predicate. These read-only checks are
 * non-atomic — used for selection previews and termination decisions
 * where a stale snapshot is acceptable. CAS-correct operations go
 * through `collection.claim` on the substrate.
 */
import {
  fifoDispatcher,
  isClaimable,
  leaseLapsed,
  priorityDispatcher,
  topologicalDispatcher,
  type Task,
  type TaskCollectionRef,
  type TaskDispatcher,
  type TaskStatus,
} from "../tasks";

/**
 * Accepted shapes for the Task Board's `dispatcher` config: either a
 * `TaskDispatcher` instance, or a string naming one of the substrate's
 * standard dispatchers.
 */
export type TaskBoardDispatcherInput =
  | TaskDispatcher
  | "fifo"
  | "topological"
  | "priority";

/** Resolve a `TaskBoardDispatcherInput` to a concrete dispatcher. */
export function resolveDispatcher(
  input: TaskBoardDispatcherInput
): TaskDispatcher {
  if (typeof input !== "string") return input;
  switch (input) {
    case "fifo":
      return fifoDispatcher;
    case "topological":
      return topologicalDispatcher;
    case "priority":
      return priorityDispatcher;
    default: {
      const _exhaustive: never = input;
      throw new Error(
        `[task-board] unknown dispatcher name "${String(_exhaustive)}"`
      );
    }
  }
}

/**
 * True when a `pending` task's deps are all `completed`. Mirrors the
 * substrate's default eligibility but reads through the collection's
 * `get` so dep status reflects the latest committed view.
 */
export function depsSatisfied(
  task: Task,
  collection: TaskCollectionRef
): boolean {
  if (task.deps === undefined || task.deps.length === 0) return true;
  for (const depId of task.deps) {
    const dep = collection.get(depId);
    if (dep === undefined || dep.status !== "completed") return false;
  }
  return true;
}

/**
 * Would this row's work be *routed* to a Workstream rather than run in the
 * drain that is asking (FIX-982)?
 *
 * A board that declares a worker `dispatch: { mode: "detached" }` hands its
 * claimed rows to a Workstream, which settles them from its own session. The
 * launching request must not wait on those — waiting on them is precisely the
 * thing detachment exists to stop.
 *
 * Supplied by the board, which derives it from its own detached declarations,
 * so a board with nothing detached passes nothing and every count below is the
 * `count()` it always was.
 *
 * **A routing question, not a liveness one.** It answers *where this row's work
 * belongs*, which is durable and knowable from declarations. Whether anybody is
 * actually on the row right now is the lease's answer, and {@link countWaitable}
 * asks it separately — see the "and only while the lease is live" section there
 * for why the two cannot be collapsed.
 */
export type RunsElsewhere = (task: Task) => boolean;

/**
 * Is this row **handed off** — routed to a Workstream, and still held by one?
 *
 * The conjunction is the whole definition and neither half stands alone:
 * routing says the work belongs elsewhere, the live lease says somebody is
 * still on it. A row that is detached by routing and abandoned in fact is not
 * handed off; it is recoverable, and every caller here has to treat it that way.
 *
 * Exported because two different questions read it and must not answer it
 * differently. {@link countWaitable} asks "is this row mine to wait on"; the
 * board's completion meta asks "did this board finish, or hand its remaining
 * work over" — and a board that answered those with two spellings would report
 * a drain it correctly exited as a failure, or a genuinely stuck board as a
 * clean hand-off. One predicate, one answer (FIX-1074).
 *
 * `runsElsewhere` absent means the board declares nothing detached, so nothing
 * is ever handed off and every caller keeps its pre-detachment behaviour
 * bit-for-bit.
 */
export function isHandedOff(
  task: Task,
  now: number,
  runsElsewhere: RunsElsewhere | undefined
): boolean {
  if (runsElsewhere === undefined) return false;
  return (
    task.status === "in_progress" && runsElsewhere(task) && !leaseLapsed(task, now)
  );
}

/**
 * Count rows in `statuses`, minus the `in_progress` ones `runsElsewhere`
 * places outside this drain.
 *
 * **Reads through `list` rather than `count` because `TaskFilter` has no
 * predicate slot** — it matches on status, assignee and labels only, and
 * "…and not running elsewhere" is expressible as none of the three. A detached
 * coordinate is usually an assignee and would *almost* fit `filter.assignee`,
 * but the uniform and floor cases do not (a floor worker is defined by the
 * assignees it is NOT), so the predicate has to see the row. One pass either
 * way; both callers below already ran one.
 *
 * **Only `in_progress` is subject to the exclusion**, and the other two
 * statuses are deliberate omissions rather than oversights:
 *
 * - a `pending` detached row is work this drain has yet to claim and dispatch,
 *   so excluding it would let the drain exit *before* spawning anything — the
 *   feature inverted into a board that silently runs nothing;
 * - an `awaiting_review` row is parked for an external actor whichever way it
 *   was dispatched. That wait predates detachment and is not what the hand-off
 *   changed, so it keeps holding the drain open. A detached board that parks
 *   for review therefore still blocks its launching request; closing that is a
 *   separate question about who owns a parked row, not this one.
 *
 * ## …and only while the lease is live
 *
 * `runsElsewhere` says where a row's work *belongs*. It cannot say whether
 * anyone is on it, because it reads declarations and an assignee — facts that
 * are just as true of a row nobody is running. A claimant that dies between
 * `claim()` and the child's first breath leaves exactly that: `in_progress`,
 * detached assignee, no worker anywhere. So does a child that was accepted and
 * then died. Both become recoverable when the deadline passes, and excluding
 * them on routing alone hides them from the drain at the moment they become so.
 *
 * **Where that bites is the worker loop's own ordering.** `claimTask` runs
 * before `checkBoard`, so a drain that *starts* on a lapsed row reclaims it on
 * its first iteration whatever this says. The reachable case is a worker
 * already in flight: it parks in `idleWait`, the row's deadline passes, the
 * wake test fires because `hasClaimableTask` now sees it — and the very next
 * step is `checkBoard`, which without the conjunct below reports `drained` and
 * ends the loop before it can circle back to `claimTask`. The board is declared
 * drained with a claimed row on it that nothing will settle, and the two halves
 * of the exit question have contradicted each other, which is the drift this
 * module was collapsed to prevent.
 *
 * **No persisted "the hand-off was accepted" mark distinguishes those states**,
 * which is why this is a lease check and not a new field. Whichever side of the
 * spawn such a mark were written on, a crash lands in the gap: write it first
 * and it is present for a hand-off that never happened; write it after and a
 * crash between acceptance and the write leaves it absent for one that did. A
 * mark moves the window; it does not close it — and it says nothing at all
 * about a child that started and then died.
 *
 * The lease answers because it is the one fact here that *expires*. It is
 * renewed from inside the child for as long as the child lives, so a live lease
 * means a live worker somewhere and a lapsed one means the row is recoverable —
 * the same reading `hasClaimableTask` and the substrate's own `claim` already
 * take (FIX-1005).
 *
 * **The clock comes from the collection** for the reason `hasClaimableTask`
 * names: the deadline was stamped against that clock by the claim write.
 */
function countWaitable(
  collection: TaskCollectionRef,
  statuses: TaskStatus[],
  runsElsewhere?: RunsElsewhere
): number {
  if (runsElsewhere === undefined) return collection.count({ status: statuses });
  const rows = collection.list({ status: statuses });
  const now = collection.now();
  let waiting = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (isHandedOff(row, now, runsElsewhere)) continue;
    waiting += 1;
  }
  return waiting;
}

/**
 * Count tasks the loop must wait on. `pending`, `in_progress`, and
 * `awaiting_review` are all in-flight — `awaiting_review` per FIX-443
 * §10.1, the others by definition. Terminal statuses don't count.
 *
 * `runsElsewhere` (FIX-982) drops the rows a Workstream is running. See
 * {@link countWaitable} for which statuses it reaches and why.
 */
export function inFlightCount(
  collection: TaskCollectionRef,
  runsElsewhere?: RunsElsewhere
): number {
  return countWaitable(
    collection,
    ["pending", "in_progress", "awaiting_review"],
    runsElsewhere
  );
}

/**
 * Count the rows an active worker is holding — `in_progress` or
 * `awaiting_review`. The `complete-or-blocked` arm reads this to ask whether
 * anything is still producing state changes *in this drain*.
 *
 * Split out of `boardQuiescence`'s inline `count` so it takes the same
 * `runsElsewhere` exclusion `inFlightCount` does. Without that the two arms
 * would disagree about the same handed-off row — one calling the board drained,
 * the other still seeing an active worker — which is the drift the quiescence
 * module exists to prevent.
 */
export function activeWorkerCount(
  collection: TaskCollectionRef,
  runsElsewhere?: RunsElsewhere
): number {
  return countWaitable(
    collection,
    ["in_progress", "awaiting_review"],
    runsElsewhere
  );
}

/**
 * Read-only probe: does the collection currently hold at least one task the
 * claim path would look at? Used by the worker idle-wait predicate to decide
 * whether a sleeping worker should wake up and re-attempt `claim`. Non-atomic
 * by design — a sibling worker may win the race; the predicate's job is only
 * to gate the wake-up, not to guarantee dispatch.
 *
 * Reads the substrate's **shared** `isClaimable` (FIX-1005) rather than a
 * second hand-written copy of it, which is what keeps this from drifting away
 * from what `claim` will actually take. That matters in both directions: a
 * probe narrower than `claim` leaves a board asleep on work it could recover,
 * and a probe wider than `claim` wakes a worker for work it will not take.
 *
 * The list query widens with it — `in_progress` rows are candidates now,
 * because one whose lease has lapsed has no live worker on it.
 *
 * **The clock comes from the collection**, not from `Date.now`. The lease this
 * probe judges was stamped by the claim write against the collection's clock,
 * so reading any other one answers a different question than the claim will —
 * a live task can read as abandoned, or an abandoned one as live. Invisible in
 * production, where every clock is the wall clock, and therefore exactly the
 * kind of divergence only a test would ever surface.
 */
export function hasClaimableTask(collection: TaskCollectionRef): boolean {
  const candidates = collection.list({ status: ["pending", "in_progress"] });
  const lookup = (id: string): Task | undefined => collection.get(id);
  const now = collection.now();
  for (let i = 0; i < candidates.length; i += 1) {
    if (isClaimable(candidates[i], lookup, now)) return true;
  }
  return false;
}

/** Sleep for `ms` milliseconds. Used for idle-poll backoff in the worker loop. */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
