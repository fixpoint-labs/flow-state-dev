/**
 * The queue the coordinator sees — four columns and a per-seat idle strip,
 * derived at read time from rows that already exist.
 *
 * **Nothing below this line is written.** No status is added, no field is set,
 * no value is cached. A column is a grouping of rows the ledger already holds,
 * which is the whole content of BR-10 and of the epic's ER-11. That is why this
 * module is a pure function over a row list rather than a block, a store or a
 * resource: there is nowhere here for a second copy of the board to accumulate.
 *
 * Two of the four columns are easy to get subtly wrong, and both are wrong in
 * the same direction — they read a status where the substrate reads a
 * predicate:
 *
 * - **Queued is not `pending`.** It is the substrate's own admission predicate,
 *   `isClaimable`, which since lease-based recovery also admits an
 *   `in_progress` row whose lease has run out — a row whose worker died. The
 *   next drain is what takes such a row back, so the honest reading is that it
 *   is queued, not running.
 * - **Running is not `in_progress`.** It is `in_progress` *and* a live claim.
 *   The same lapsed-lease row is `in_progress` with nobody on it, and showing
 *   it as running would show work that is not happening.
 *
 * Seat idle falls out of the same fact rather than being stamped anywhere: a
 * seat is idle when no row holds a live claim in its name. Nobody writes idle,
 * so nobody can forget to clear it.
 *
 * ## The column set is checked, not assumed
 *
 * {@link queueView} returns `uncolumned` — every row that landed in no column
 * at all. It is deliberately not silently folded into one: a row in no column
 * is a bug in the view, and BR-10 grades it by name.
 *
 * One case reaches it today and cannot arise in this lab: a `pending` row whose
 * declared dependencies are not yet complete is not claimable, so it is neither
 * queued nor anything else. This lab files no row with `deps`, so the set is
 * exhaustive over what it produces. A consumer that files dependent rows needs
 * a fifth column before it copies this, and `uncolumned` is what tells it so.
 */

import { isClaimable, leaseLapsed, type Task } from "@flow-state-dev/orchestration/tasks";

/** One row as a column carries it — what a reader of the queue needs and no more. */
export interface QueueRow {
  id: string;
  goal: string;
  /** The board's routing key. **Not a seat**: which seat it reaches is wiring. */
  assignee?: string;
  status: Task["status"];
  /** Why this row is waiting on a person — the reason already on the row. */
  reason?: string;
}

/**
 * A hired seat, as the view has to address it.
 *
 * The session is needed and the id alone is not: a claim records *where* it
 * ran (`claimedBy.sessionId`), never which seat asked, so the only exact join
 * between a row and a seat is the session that seat drains in. Matching the
 * seat id against the claim as a string would pass here and rot the moment a
 * deployment names sessions anything else.
 */
export interface HiredSeat {
  /** The hired seat's instance id. */
  id: string;
  /** The session this seat's drain runs in. */
  sessionId: string;
}

/** What one seat is doing, derived from the board and never stamped on the seat. */
export interface SeatState {
  /** The hired seat's instance id. */
  seat: string;
  /** True when no row holds a live claim in this seat's session. */
  idle: boolean;
  /** The rows this seat is holding right now, by id. */
  holding: string[];
}

/** The whole view: four columns, the seats, and whatever fell outside both. */
export interface QueueView {
  /** Claimable now — `pending`, or `in_progress` with a lapsed lease. */
  queued: QueueRow[];
  /** `in_progress` with a live claim. */
  running: QueueRow[];
  /** `parked` or `blocked`, carrying the reason already on the row. */
  waitingOnYou: QueueRow[];
  /** Terminal: `completed`, `errored`, `cancelled`. */
  done: QueueRow[];
  /** One entry per hired seat, in the order the seats were given. */
  seats: SeatState[];
  /** Rows that landed in no column. Non-empty is a bug in this view. */
  uncolumned: QueueRow[];
}

/** The statuses nothing moves out of. */
const TERMINAL: ReadonlySet<Task["status"]> = new Set(["completed", "errored", "cancelled"]);

/** The statuses that mean a person is holding this up. */
const WAITING: ReadonlySet<Task["status"]> = new Set(["parked", "blocked"]);

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
 * Group rows and seats into the queue a coordinator reads.
 *
 * @param rows  Every row on the board, as the ledger holds them.
 * @param seats The hired seats to report idleness for, each with the session
 *   its drain runs in.
 * @param now   The clock the lease is measured against. A parameter rather than
 *   a captured clock, so a check can ask what the view said at a chosen moment.
 * @returns The four columns, the per-seat strip, and anything uncolumned.
 */
export function queueView(
  rows: readonly Task[],
  seats: readonly HiredSeat[],
  now: number = Date.now(),
): QueueView {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const lookup = (id: string): Task | undefined => byId.get(id);

  const view: QueueView = {
    queued: [],
    running: [],
    waitingOnYou: [],
    done: [],
    seats: [],
    uncolumned: [],
  };

  for (const row of rows) {
    // Order matters once: claimability is asked FIRST, because a lapsed-lease
    // row is `in_progress` and would otherwise be read as running by a check
    // on status alone — which is the reading this column exists to correct.
    if (isClaimable(row, lookup, now)) view.queued.push(project(row));
    else if (liveClaim(row, now)) view.running.push(project(row));
    else if (WAITING.has(row.status)) view.waitingOnYou.push(project(row));
    else if (TERMINAL.has(row.status)) view.done.push(project(row));
    else view.uncolumned.push(project(row));
  }

  for (const seat of seats) {
    // Joined on the session the claim recorded, which is the only exact link
    // between a row and the seat holding it. Idle is the ABSENCE of a live
    // claim, never a stamp — so there is no flag to forget to clear.
    const holding = rows
      .filter((row) => liveClaim(row, now) && row.claimedBy?.sessionId === seat.sessionId)
      .map((row) => row.id);
    view.seats.push({ seat: seat.id, idle: holding.length === 0, holding });
  }

  return view;
}

/** Every column name, in reading order — so a check can walk them rather than list them. */
export const QUEUE_COLUMNS = ["queued", "running", "waitingOnYou", "done"] as const;

export type QueueColumn = (typeof QUEUE_COLUMNS)[number];
