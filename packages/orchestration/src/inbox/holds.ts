/**
 * The Inbox's holds: what a task row holds for the user, and whether the
 * Inbox can answer each. Inside the read; not published.
 */
import { isTerminalStatus, type TaskStatus } from "../tasks/schema/task-status";
import type { InboxHold, InboxRow, InboxSuspension } from "./types";

/** Why a hold in a session that names no owning flow can't be answered. */
export const NO_FLOW_UNANSWERABLE =
  "This ask can't be answered from the Inbox: its session was written before sessions recorded their owning flow, so there is no flow to answer it through.";

/** Why a row hold can't be answered yet: its answer path, the board's `updateTask`, lands with the row holds. */
export const ROW_HOLD_UNANSWERABLE = "Answering a task's question from the Inbox arrives with the row holds.";

/** An item's id for a task row: one per row, by its board and its task. */
export function taskItemId(board: string, taskId: string): string {
  return `task:${board}:${taskId}`;
}

/** Whether a row is still open: not completed, errored or cancelled. */
export function isOpenRow(row: InboxRow): boolean {
  return !isTerminalStatus(row.status as TaskStatus);
}

/** Why a hold with this source can't be answered, or `null` when it can. */
function unanswerableSource(source: InboxHold<unknown>["source"]): string | null {
  if (source.kind === "suspension") return source.flowId === null ? NO_FLOW_UNANSWERABLE : null;
  return ROW_HOLD_UNANSWERABLE;
}

/** A hold, its answerable flag set from its source. */
function withAnswerable<TDetail>(hold: Omit<InboxHold<TDetail>, "answerable" | "unanswerable">): InboxHold<TDetail> {
  const why = unanswerableSource(hold.source);
  return { ...hold, answerable: why === null, unanswerable: why };
}

/** A suspension hold for a stop the reader found, where its own session is. */
export function holdOfSuspension<TDetail>(s: InboxSuspension<TDetail>): InboxHold<TDetail> {
  return withAnswerable<TDetail>({
    id: s.suspensionId,
    source: { kind: "suspension", flowId: s.flowId, sessionId: s.sessionId, requestId: s.requestId, suspensionId: s.suspensionId },
    ask: { kind: s.kind, prompt: s.prompt, ...(s.title !== undefined ? { title: s.title } : {}) },
    openedAt: s.since,
    ...(s.detail !== undefined ? { detail: s.detail } : {}),
  });
}

/**
 * A row's open holds for the user. Until the row holds land, the one a row can
 * carry is a task run's stop, as FIX-2129 records it in `waitingFor`, on a
 * running row. Not `waitingOn`: a notice's or a steer's turn admitted while
 * the stop waits clears it and keeps `waitingFor` (`keepWaitingFor`), and the
 * stop still waits on the user.
 */
export function openUserHolds<TDetail>(
  row: InboxRow,
  flowOf: (sessionId: string) => string | null | undefined,
  foundFor: (suspensionId: string) => InboxSuspension<TDetail> | undefined = () => undefined,
): InboxHold<TDetail>[] {
  const stop = row.waitingFor;
  if (row.status !== "in_progress" || stop == null || row.run == null) return [];
  const found = foundFor(stop.suspensionId);
  // The run's flow: as its session names it, else as the reader found it where the stop is.
  const flowId = flowOf(row.run.sessionId) ?? found?.flowId ?? null;
  return [
    withAnswerable<TDetail>({
      id: stop.suspensionId,
      source: { kind: "suspension", flowId, sessionId: row.run.sessionId, requestId: stop.requestId, suspensionId: stop.suspensionId },
      ask: { kind: stop.kind, prompt: stop.prompt, ...(stop.title !== undefined ? { title: stop.title } : {}) },
      // When it was raised: the stop's own time, which a later turn on the row doesn't move; the row's only without one.
      openedAt: found?.since ?? row.updatedAt ?? 0,
      ...(stop.deadline !== undefined ? { due: stop.deadline } : {}),
      ...(found?.detail !== undefined ? { detail: found.detail } : {}),
    }),
  ];
}
