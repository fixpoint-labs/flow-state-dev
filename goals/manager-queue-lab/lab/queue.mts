/**
 * The queue the manager sees — four columns derived at read time from rows
 * that already exist on its conversation's board.
 *
 * **Nothing below this line is written.** No status is added, no field is set,
 * no value is cached. A column is a grouping of rows the store already holds,
 * which is why this module is a pure function over a row list rather than a
 * block, a store or a resource: there is nowhere here for a second copy of the
 * board to accumulate.
 *
 * Two of the four columns are easy to get subtly wrong, and both are wrong in
 * the same direction — they read a status where the substrate reads a
 * predicate:
 *
 * - **Queued is not `pending`.** It is the substrate's own admission predicate,
 *   `isClaimable`, which also admits an `in_progress` row whose lease has run
 *   out — a row whose worker died.
 * - **A held row waits on you.** Filed, and not to start until a person
 *   releases it (FIX-2080): no claim admits it, and nothing but a release
 *   starts it.
 * - **Running is not `in_progress`.** It is `in_progress` *and* a live claim.
 *
 * ## The column set is checked, not assumed
 *
 * {@link queueView} returns `uncolumned` — every row that landed in no column
 * at all. It is deliberately not silently folded into one: a row in no column
 * is a bug in the view, and the contract gate grades it by name. One case
 * reaches it today and cannot arise in this lab: a `pending` row whose declared
 * dependencies are not yet complete is not claimable. This lab files no row
 * with `deps`.
 *
 * (Before the manager filed on its own conversation's board, this view also
 * reported which worker was busy, joined on the session a worker's drain ran
 * in. A conversation board has no drain: each task runs in a session of its
 * own, so that strip went with the drain.)
 */

import { hasOpenQuestion, isClaimable, leaseLapsed, type Task } from "@flow-state-dev/orchestration/tasks";

/** One row as a column carries it — what a reader of the queue needs and no more. */
export interface QueueRow {
  id: string;
  goal: string;
  /** The worker the row is filed for, when it names one. */
  assignee?: string;
  status: Task["status"];
  /** Why this row is waiting on a person — the reason already on the row. */
  reason?: string;
}

/** The whole view: four columns, and whatever fell outside them. */
export interface QueueView {
  /** Claimable now (`pending`, or `in_progress` with a lapsed lease), or recorded and waiting for its dispatch. */
  queued: QueueRow[];
  /** `in_progress` with a live claim. */
  running: QueueRow[];
  /** Running with an open hold (a question, or a stop for a person), or `held`, carrying the reason already on the row, when it has one. */
  waitingOnYou: QueueRow[];
  /** Terminal: `completed`, `errored`, `cancelled`. */
  done: QueueRow[];
  /** Rows that landed in no column. Non-empty is a bug in this view. */
  uncolumned: QueueRow[];
}

/** The statuses nothing moves out of. */
const TERMINAL: ReadonlySet<Task["status"]> = new Set(["completed", "errored", "cancelled"]);

/** The status that means a person is holding this up before it starts: a held row nobody released yet. */
const WAITING: ReadonlySet<Task["status"]> = new Set(["held"]);

/** Project one row down to what a column shows. */
function project(task: Task): QueueRow {
  return {
    id: task.id,
    goal: task.goal,
    ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
    status: task.status,
    // The reason the row already carries. `feedback` is where the substrate
    // records why a row stopped; `error` is what a failure wrote. Neither is
    // computed here, and neither is written back.
    ...(task.feedback !== undefined
      ? { reason: task.feedback }
      : task.error !== undefined
        ? { reason: String(task.error) }
        : {}),
  };
}

/**
 * True when this row is held by a worker that is still alive.
 *
 * `claimedBy` is the execution coordinate the claim stamped; a lapsed lease
 * means the holder is gone whether or not the field is still set. Both halves
 * are needed — the field alone survives a dead worker, and the lease alone says
 * nothing about a row nobody ever claimed.
 */
function liveClaim(task: Task, now: number): boolean {
  return task.status === "in_progress" && task.claimedBy != null && !leaseLapsed(task, now);
}

/**
 * Group rows into the queue the manager reads.
 *
 * @param rows Every row on the board, as the store holds them.
 * @param now  The clock the lease is measured against. A parameter rather than
 *   a captured clock, so a check can ask what the view said at a chosen moment.
 * @returns The four columns and anything uncolumned.
 */
export function queueView(rows: readonly Task[], now: number = Date.now()): QueueView {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const lookup = (id: string): Task | undefined => byId.get(id);

  const view: QueueView = {
    queued: [],
    running: [],
    waitingOnYou: [],
    done: [],
    uncolumned: [],
  };

  for (const row of rows) {
    // Order matters once: claimability is asked FIRST, because a lapsed-lease
    // row is `in_progress` and would otherwise be read as running by a check
    // on status alone — which is the reading this column exists to correct.
    if (isClaimable(row, lookup, now)) view.queued.push(project(row));
    // A running row waiting on a person is asked before the live claim: it
    // keeps its claim while nobody works it.
    else if (WAITING.has(row.status) || hasOpenQuestion(row)) view.waitingOnYou.push(project(row));
    else if (liveClaim(row, now)) view.running.push(project(row));
    else if (TERMINAL.has(row.status)) view.done.push(project(row));
    else view.uncolumned.push(project(row));
  }


  return view;
}

/** Every column name, in reading order — so a check can walk them rather than list them. */
export const QUEUE_COLUMNS = ["queued", "running", "waitingOnYou", "done"] as const;

export type QueueColumn = (typeof QUEUE_COLUMNS)[number];
