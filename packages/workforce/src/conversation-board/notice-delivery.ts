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
 * is gone. Only the conversation's `onTaskSettled` clears a delivered notice.
 */
import { dispatchThroughSeam } from "@flow-state-dev/core/types";
import type { BlockContext, DispatchOutcome, SessionTarget } from "@flow-state-dev/core/types";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { CONVERSATION_LEDGER_ID } from "./ledger";
import { owedNotices, type TaskNotice } from "./task-notice";

/**
 * The internal entry a task's notice arrives on in the conversation that
 * filed it. **Pinned** (FIX-1780): a goal check reads notices by it.
 */
export const TASK_SETTLED_ENTRY = "onTaskSettled";

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
        action: TASK_SETTLED_ENTRY,
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
