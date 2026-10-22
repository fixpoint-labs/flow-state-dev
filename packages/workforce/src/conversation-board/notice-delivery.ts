/**
 * Sending what a row owes (FIX-1794 S6): one loop for both of a notice's
 * senders, which differ only in where they send it.
 *
 * - The task session tells the conversation that filed the task: its stamped
 *   sender (`{ from: true }`), on the flow a filing conversation runs on.
 * - The board replays what its rows still owe into its own conversation
 *   (`{ id }`), when the task session's send was lost.
 *
 * A thrown send leaves the notice owed on the row for the board's next touch.
 * A refusal goes to the caller, which knows whether it means the conversation
 * is gone. Only the conversation's `onTaskSettled` (or, for a post row,
 * `onPostSettled`) clears a delivered notice.
 */
import { dispatchThroughSeam } from "@flow-state-dev/core/types";
import type { BlockContext, DispatchOutcome, SessionTarget } from "@flow-state-dev/core/types";
import { owedNotices, type Task, type TaskNotice } from "@flow-state-dev/orchestration/tasks";
import { isPostRow } from "../coordinator/delegated-post";
import { CONVERSATION_LEDGER_ID } from "./ledger";

// The two entries a notice arrives on, by name (`./board-entries`).
export { POST_SETTLED_ENTRY, TASK_SETTLED_ENTRY } from "./board-entries";
import { POST_SETTLED_ENTRY, TASK_SETTLED_ENTRY } from "./board-entries";

/** Where a notice goes: the conversation's session, and its flow when it isn't the sender's own. */
export interface NoticeAddress {
  readonly session: SessionTarget;
  readonly flowKind?: string;
  /** The sending block's name, for provenance. */
  readonly from: string;
}

/** A dispatch the host refused, with why. */
export type NoticeRefusal = Extract<DispatchOutcome, { ok: false }>;

/**
 * Send each notice `row` still owes to `address`, as a request of its own.
 *
 * @param onRefused Told each refusal; a refusal it ignores leaves the notice owed.
 * @returns How many sends the host accepted.
 */
export async function sendOwedNotices(
  ctx: BlockContext,
  row: Task,
  address: NoticeAddress,
  onRefused?: (notice: TaskNotice, refusal: NoticeRefusal) => Promise<void>
): Promise<number> {
  let sent = 0;
  for (const notice of owedNotices(row, CONVERSATION_LEDGER_ID)) {
    let outcome: DispatchOutcome;
    try {
      outcome = await dispatchThroughSeam(ctx, {
        type: "internal",
        action: isPostRow(row) ? POST_SETTLED_ENTRY : TASK_SETTLED_ENTRY,
        ...(address.flowKind !== undefined ? { flowKind: address.flowKind } : {}),
        session: address.session,
        payload: notice,
        from: address.from
      });
    } catch {
      // Not definitive: the marker stays, and the board's next touch sends it.
      continue;
    }
    if (outcome.ok) sent += 1;
    else await onRefused?.(notice, outcome);
  }
  return sent;
}

/**
 * Send a cancelled post row's ending to `address`. A cancel of a row nobody
 * waits on owes no notice, so without this its round closes only at its
 * deadline. A send that fails leaves that to the deadline.
 */
export async function sendPostCancelled(ctx: BlockContext, row: Task, address: NoticeAddress): Promise<void> {
  try {
    await dispatchThroughSeam(ctx, {
      type: "internal",
      action: POST_SETTLED_ENTRY,
      session: address.session,
      payload: { boardId: CONVERSATION_LEDGER_ID, taskId: row.id, attempt: row.attempts, ending: "cancelled" },
      from: address.from
    });
  } catch {
    // Its round closes at its deadline.
  }
}
