/**
 * `@flow-state-dev/orchestration/inbox/check` — the check that an Inbox list
 * is the list it should be (FIX-2133). For tests and goals in this repository:
 * the subpath is in the workspace's exports only, never published.
 *
 * The truth is read apart from the list, or the check proves nothing: a
 * session's suspended requests with their items (not the item log a reader
 * lists from), and the board's rows from `listTasks`, read field by field
 * here rather than through the list's own helpers.
 */
import type { SessionRequestSummary } from "@flow-state-dev/client";
import { isUserSuspension } from "@flow-state-dev/core/types";
import { isTerminalStatus, type TaskStatus } from "../tasks/schema/task-status";
import { taskItemId } from "./holds";
import type { InboxItem, InboxRow } from "./types";

export { taskItemId };

/** A suspension for the user, as a session's request listing records it. */
export type SuspensionTruth = {
  readonly suspensionId: string;
  readonly sessionId: string;
  readonly requestId: string;
  /** Whether its request is a task's run (source `task`): its stop lists from that task's row. */
  readonly taskRun: boolean;
};

/** A task row's open user holds, as the board's own task listing records them. */
export type RowTruth = {
  readonly board: string;
  readonly taskId: string;
  /** The suspension ids of its open suspension holds. */
  readonly suspensionHolds: readonly string[];
  /** The ids of its open questions and confirms. */
  readonly rowHolds: readonly string[];
};

/** What should be in the Inbox, read apart from the list. */
export type InboxTruth = {
  readonly suspensions: readonly SuspensionTruth[];
  readonly rows: readonly RowTruth[];
  /**
   * The holds (their suspension or hold ids) answered or cancelled before this
   * read: each must be in no later list, and no later truth. A hold, not an
   * item: a task's item id stays the same when the task waits on the user again.
   */
  readonly closed?: readonly string[];
};

/** What {@link reconcileInbox} found. Green when every list is empty. */
export type InboxReconciliation = {
  readonly green: boolean;
  /** In the truth, not in the list. */
  readonly missing: string[];
  /** Items listed more than once, and holds shown under more than one item. */
  readonly duplicate: string[];
  /** In the list, not in the truth. */
  readonly orphan: string[];
  /**
   * A task run's stop and its row's hold disagree: a stop with no hold or
   * more than one, a hold whose stop is no longer live, or a listed item
   * showing other holds than its row's.
   */
  readonly drift: string[];
  /** Holds the user can't answer, each with its item and why. */
  readonly unanswerable: Array<{ id: string; hold: string; why: string }>;
  /** Closed holds that are back, in the list or in the truth. */
  readonly reopened: string[];
};

/**
 * The suspensions for the user still pending in one session's suspended
 * requests: each `suspension` item `isUserSuspension` accepts with no
 * `suspension_resume` for it in the same request. Read from the request
 * listing with its items (`client.sessions.requests(id, { status:
 * "suspended", includeItems: true })`).
 */
export function suspensionTruthOf(sessionId: string, requests: readonly SessionRequestSummary[]): SuspensionTruth[] {
  const out: SuspensionTruth[] = [];
  for (const request of requests) {
    if (request.status !== "suspended") continue;
    const items = (request.items ?? []) as Array<{ type?: string; suspensionId?: string; reason?: string }>;
    const resumed = new Set(items.filter((i) => i.type === "suspension_resume").map((i) => i.suspensionId));
    for (const item of items) {
      if (item.type !== "suspension" || typeof item.suspensionId !== "string" || resumed.has(item.suspensionId)) continue;
      if (typeof item.reason !== "string" || !isUserSuspension({ reason: item.reason })) continue;
      out.push({ suspensionId: item.suspensionId, sessionId, requestId: request.id, taskRun: request.source === "task" });
    }
  }
  return out;
}

/**
 * A board's rows as truth, read straight from what `listTasks` returns, field
 * by field: an open row holds the user on each `actor: "user"` hold in its
 * `holds`, a suspension's while it is there, a question's or a confirm's while
 * no steer names it. Not the list's helpers, nor the board's predicate, so a
 * fault in either shows.
 */
export function rowTruthOf(rows: readonly InboxRow[]): RowTruth[] {
  return rows.flatMap((row) => {
    if (isTerminalStatus(row.status as TaskStatus)) return [];
    const answered = new Set((row.steers ?? []).flatMap((steer) => (steer.answers === undefined ? [] : [steer.answers])));
    const suspensionHolds: string[] = [];
    const rowHolds: string[] = [];
    // Open holds re-derived here on purpose, not through `openRowHolds`: the
    // truth stays independent of the predicate it checks.
    for (const hold of row.holds ?? []) {
      if (hold.actor !== "user") continue;
      if (hold.source.kind === "suspension") suspensionHolds.push(hold.source.suspensionId);
      else if (!answered.has(hold.id)) rowHolds.push(hold.id);
    }
    if (suspensionHolds.length === 0 && rowHolds.length === 0) return [];
    return [{ board: row.board, taskId: row.id, suspensionHolds, rowHolds }];
  });
}

/** Check `items` against `truth`. Pure: reads nothing. */
export function reconcileInbox(items: readonly InboxItem<unknown>[], truth: InboxTruth): InboxReconciliation {
  const want = new Set([
    ...truth.rows.map((r) => taskItemId(r.board, r.taskId)),
    ...truth.suspensions.filter((s) => !s.taskRun).map((s) => s.suspensionId),
  ]);
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  const listed = new Set(counts.keys());

  const missing = [...want].filter((id) => !listed.has(id));
  // A duplicate is an item listed twice, or one stop shown under two items whose ids differ.
  const holdCounts = new Map<string, number>();
  for (const item of items) for (const hold of new Set(item.holds.map((h) => h.id))) holdCounts.set(hold, (holdCounts.get(hold) ?? 0) + 1);
  const duplicate = [
    ...new Set([...[...counts].filter(([, n]) => n > 1).map(([id]) => id), ...[...holdCounts].filter(([, n]) => n > 1).map(([id]) => id)]),
  ];
  const orphan = [...listed].filter((id) => !want.has(id));

  const drift: string[] = [];
  const live = new Set(truth.suspensions.map((s) => s.suspensionId));
  for (const stop of truth.suspensions.filter((s) => s.taskRun)) {
    const holders = truth.rows.filter((r) => r.suspensionHolds.includes(stop.suspensionId));
    if (holders.length !== 1) drift.push(`stop ${stop.suspensionId}: ${holders.length} open holds`);
  }
  for (const row of truth.rows) {
    for (const id of row.suspensionHolds) if (!live.has(id)) drift.push(`hold ${id} on ${row.board}:${row.taskId}: no live stop`);
  }
  // A listed task item shows the holds its row holds now: a stale list offers a stop that ended, or a question answered.
  const heldBy = new Map(truth.rows.map((r) => [taskItemId(r.board, r.taskId), [...r.suspensionHolds, ...r.rowHolds].sort()]));
  for (const item of items) {
    if (item.task === null) continue;
    const held = heldBy.get(item.id) ?? [];
    const shown = item.holds.map((h) => h.id).sort();
    if (shown.join(",") !== held.join(",")) drift.push(`item ${item.id} shows ${shown.join(", ") || "none"}, its row holds ${held.join(", ") || "none"}`);
  }

  const unanswerable = items.flatMap((item) => item.holds.flatMap((hold) => (hold.unanswerable === null ? [] : [{ id: item.id, hold: hold.id, why: hold.unanswerable }])));
  // Closure is the hold's: listed again, or held again in the reads made apart from the list.
  const closed = new Set(truth.closed ?? []);
  const holdsSeen = new Set([
    ...items.flatMap((item) => item.holds.map((h) => h.id)),
    ...truth.rows.flatMap((r) => [...r.suspensionHolds, ...r.rowHolds]),
    ...truth.suspensions.map((s) => s.suspensionId),
  ]);
  const reopened = [...holdsSeen].filter((id) => closed.has(id));

  return {
    green: [missing, duplicate, orphan, drift, unanswerable, reopened].every((list) => list.length === 0),
    missing,
    duplicate,
    orphan,
    drift,
    unanswerable,
    reopened,
  };
}
