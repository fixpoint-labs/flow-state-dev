/**
 * The Inbox's holds: what a task row holds for the user, and whether the
 * Inbox can answer each. Inside the read; not published.
 */
import { isTerminalStatus, type TaskStatus } from "../tasks/schema/task-status";
import { openHolds } from "../tasks/collection/holds";
import type { Task } from "../tasks/schema/task";
import type { InboxHold, InboxRow, InboxSuspension } from "./types";

/** Why a hold in a session that names no owning flow can't be answered. */
export const NO_FLOW_UNANSWERABLE =
  "This ask can't be answered from the Inbox: its session was written before sessions recorded their owning flow, so there is no flow to answer it through.";

/** Why a row hold whose board the reader can't place can't be answered. */
export const NO_BOARD_UNANSWERABLE =
  "This question can't be answered from the Inbox: the reader couldn't name the board's session and flow it is answered through.";

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
  return source.flowId === null || source.sessionId === null || source.action === null ? NO_BOARD_UNANSWERABLE : null;
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
 * A row's open holds for the user (`actor: "user"`), by the one predicate the
 * board reads (`openHolds`): its questions and confirms, answered through the
 * board, and its run's stop for a person, answered through the engine in the
 * session its run link names.
 */
export function openUserHolds<TDetail>(
  row: InboxRow,
  flowOf: (sessionId: string) => string | null | undefined,
  foundFor: (suspensionId: string) => InboxSuspension<TDetail> | undefined = () => undefined,
): InboxHold<TDetail>[] {
  const open = openHolds({ status: row.status, holds: row.holds ?? undefined, steers: row.steers ?? undefined } as Pick<Task, "status" | "holds" | "steers">);
  const holds: InboxHold<TDetail>[] = [];
  for (const hold of open) {
    if (hold.actor !== "user") continue;
    const title = hold.ask.title !== undefined ? { title: hold.ask.title } : {};
    const due = hold.due !== undefined ? { due: hold.due } : {};
    if (hold.source.kind === "row") {
      const holder = row.holder ?? null;
      holds.push(
        withAnswerable<TDetail>({
          id: hold.id,
          source: {
            kind: "row",
            flowId: holder === null ? null : (flowOf(holder.sessionId) ?? null),
            sessionId: holder?.sessionId ?? null,
            action: holder?.action ?? null,
            taskId: row.id,
          },
          ask: { kind: hold.ask.kind, prompt: hold.ask.prompt, ...title },
          openedAt: hold.openedAt,
          ...due,
        }),
      );
      continue;
    }
    // A task run's stop: its answer goes to the run's session, where it is parked.
    if (row.run == null) continue;
    const found = foundFor(hold.source.suspensionId);
    const flowId = flowOf(row.run.sessionId) ?? found?.flowId ?? null;
    holds.push(
      withAnswerable<TDetail>({
        id: hold.source.suspensionId,
        source: {
          kind: "suspension",
          flowId,
          sessionId: row.run.sessionId,
          requestId: hold.source.requestId,
          suspensionId: hold.source.suspensionId,
        },
        ask: { kind: hold.ask.kind, prompt: hold.ask.prompt, ...title },
        openedAt: found?.since ?? hold.openedAt,
        ...due,
        ...(found?.detail !== undefined ? { detail: found.detail } : {}),
      }),
    );
  }
  return holds;
}
