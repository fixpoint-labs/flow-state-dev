/**
 * The task-row view (FIX-2379): what a person sees of one task row, the one
 * status and *waiting on you* vocabulary every workforce app draws from.
 *
 * It reads holds the way the Inbox does (`openUserHolds`), and spend the way
 * a board's reader does (`taskSpendView`); it builds no Inbox item and no
 * second hold read. Browser-safe, like the rest of this entry.
 */
import { taskSpendView, type TaskSpendView } from "../tasks/spend";
import { taskSpendViewSchema } from "../tasks/schema/spend";
import { persistedTaskStatusSchema } from "../tasks/schema/task-status";
import type { Task } from "../tasks/schema/task";
import { openUserHolds } from "./holds";
import type { InboxHold, InboxRow } from "./types";

/**
 * What a person sees a task as.
 *
 * - `queued`: filed, waiting to start (`pending`, or a stored word this
 *   version doesn't know).
 * - `held`: filed, not to start until someone releases it.
 * - `running`: being worked, nothing waiting on the user.
 * - `waiting`: an open hold waits on the user, whatever the row's stored
 *   status, as long as it isn't terminal.
 * - `failed`, `done`, `cancelled`: its terminal statuses.
 */
export type TaskRowState = "queued" | "held" | "running" | "waiting" | "failed" | "done" | "cancelled";

/** A task row as the view reads it: an Inbox row plus what a board publishes beside it. A `Task` on its board fits. */
export type TaskViewRow = InboxRow & {
  readonly error?: string | null;
  readonly statusNote?: string | null;
  /** The stored ledger (a raw board row) or the view `listTasks` already folded it to. */
  readonly spend?: Task["spend"] | TaskSpendView | null;
  readonly createdAt?: number | null;
  readonly startedAt?: number | null;
  readonly completedAt?: number | null;
};

/** One task row, as a person sees it. */
export type TaskRowView<TDetail = unknown> = {
  readonly board: string;
  readonly id: string;
  /** Its title, else its goal, else its id. */
  readonly title: string;
  readonly goal: string | null;
  readonly assignee: string | null;
  /** The status as stored, read forward (a legacy `blocked` reads `held`). Kept even when it is a word {@link state} doesn't know. */
  readonly status: string;
  /** What a person sees it as. */
  readonly state: TaskRowState;
  /**
   * Its oldest open user hold: what it asks (`ask.kind`, `ask.prompt`), where
   * the answer goes, whether it can be answered here, and what the reader
   * found for it. `null` when nothing waits on the user. Set exactly when
   * {@link state} is `waiting`.
   */
  readonly hold: InboxHold<TDetail> | null;
  /** Every open user hold, oldest first. Empty on a terminal row. */
  readonly holds: readonly InboxHold<TDetail>[];
  readonly error: string | null;
  /** Its worker's last one-line progress note. */
  readonly statusNote: string | null;
  /** What its runs spent (`taskSpendView`), or `null` before it runs or when the stored spend can't be read. */
  readonly spend: TaskSpendView | null;
  /** The harness its runs last reported, or `null`. */
  readonly harness: string | null;
  /** The model its runs last called, or `null`. */
  readonly model: string | null;
  /** Epoch ms; `null` where the row has none. */
  readonly times: {
    readonly createdAt: number | null;
    readonly updatedAt: number | null;
    readonly startedAt: number | null;
    readonly completedAt: number | null;
  };
};

const TERMINAL_STATE = { completed: "done", errored: "failed", cancelled: "cancelled" } as const;

/** The stored status read forward, or the stored word when this version doesn't know it. */
function storedStatus(status: string): string {
  const parsed = persistedTaskStatusSchema.safeParse(status);
  return parsed.success ? parsed.data : status;
}

/**
 * A row's spend as a view. `listTasks` publishes it folded already, and that
 * is kept as it is (folding it again would read no requests and lose it); a
 * raw row's stored ledger is folded here. `null` when it is neither, since a
 * view never throws on a row.
 */
function spendOf(row: TaskViewRow, status: string): TaskSpendView | null {
  const folded = taskSpendViewSchema.safeParse(row.spend);
  if (folded.success) return folded.data;
  try {
    return taskSpendView({ spend: (row.spend ?? undefined) as Task["spend"], status: status as Task["status"] });
  } catch {
    return null;
  }
}

/**
 * A task row as a person sees it: one display state, what it waits on the
 * user for, its spend, its harness and its times.
 *
 * @param holds The row's holds from its Inbox item (`inboxItems`), when the
 *   caller has one: they also carry a stop found in the row's open run that
 *   the row hasn't recorded yet, and know where each answer goes. Without
 *   them the view reads the row's own record through the Inbox's hold read,
 *   so a row holding a question waits on you whether or not the caller did
 *   the Inbox read; those holds say they can't be answered from here.
 */
export function taskRowView<TDetail = unknown>(row: TaskViewRow, holds?: readonly InboxHold<TDetail>[]): TaskRowView<TDetail> {
  const status = storedStatus(row.status);
  const terminal = Object.hasOwn(TERMINAL_STATE, status);
  const open = terminal
    ? []
    : [...(holds ?? openUserHolds<TDetail>({ ...row, status }, () => null))].sort((a, b) => a.openedAt - b.openedAt);
  const first = open[0];
  const state: TaskRowState = terminal
    ? TERMINAL_STATE[status as keyof typeof TERMINAL_STATE]
    : first !== undefined
      ? "waiting"
      : status === "held"
        ? "held"
        : status === "in_progress"
          ? "running"
          : "queued";
  const spend = spendOf(row, status);
  return {
    board: row.board,
    id: row.id,
    title: row.title ?? row.goal ?? row.id,
    goal: row.goal ?? null,
    assignee: row.assignee ?? null,
    status,
    state,
    hold: first ?? null,
    holds: open,
    error: row.error ?? null,
    statusNote: row.statusNote ?? null,
    spend,
    harness: spend?.harness ?? null,
    model: spend?.model ?? null,
    times: {
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
      startedAt: row.startedAt ?? null,
      completedAt: row.completedAt ?? null,
    },
  };
}
