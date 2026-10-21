/**
 * The filed half of a task's cascade on a conversation's board (FIX-2080 D2):
 * when a task fails, retries or is cancelled, the open tasks its session
 * filed are cancelled, so no filed task outlives the task that filed it.
 *
 * - **Which tasks.** A task's session files its pieces on its own board,
 *   each marked as a piece of the task (`PIECE_OF`). The first piece it files
 *   stamps the task's row on the board above with where that session is
 *   (`FILED_MARKER`: the session and its flow), server-written, so the ending
 *   knows where to send the cancel.
 * - **The debt.** The ledger's ending recorder writes `Task.cascadeOwed` in
 *   the ending's own write for a row that carries the marker
 *   ({@link filedCascade}`.owes`), so a crash between the ending and the
 *   cancel leaves it owed, not lost.
 * - **The payment.** In the task's own session (the claim gate's ending, a
 *   retry), its open pieces are cancelled on its board directly. Anywhere else
 *   (a cancel from the conversation), the cancel is sent into the task's
 *   session (`CANCEL_PIECES_ENTRY`). A send that is refused leaves the debt
 *   for the board's next touch past its due time.
 *
 * Each piece's cancel is itself an ending on the session's board, so a piece
 * that filed work of its own cascades in turn, down the chain.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { dispatchThroughSeam } from "@flow-state-dev/core/types";
import {
  endsFiledWork,
  isTerminalStatus,
  type DeclaredFiledCascade,
  type Task
} from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { FILING_SESSION_STATE_KEY, TASK_FLOW_STATE_KEY } from "../workers/keys";
import { CANCEL_PIECES_ENTRY, FILED_MARKER, PIECE_OF } from "./board-entries";
import { conversationLedgerAt, ownConversationLedger } from "./ledger";

const filedMarkerSchema = z.object({ session: z.string().min(1), flow: z.string().min(1) });

/** Where a task's session filed its pieces: that session, and the flow it runs on. */
export type FiledMarker = z.infer<typeof filedMarkerSchema>;

/** The row's filed marker, when it carries one that reads. */
export function filedMarkerOf(row: Pick<Task, "metadata"> | undefined): FiledMarker | undefined {
  const parsed = filedMarkerSchema.safeParse(row?.metadata?.[FILED_MARKER]);
  return parsed.success ? parsed.data : undefined;
}

function stringAt(ctx: BlockContext, key: string): string | undefined {
  const value = ((ctx.session.state ?? {}) as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Stamp `taskId`'s row on the board above with this session, before the
 * running task session files its first piece for it. A crash between the
 * stamp and the piece's add leaves a marker with nothing to cancel, which
 * costs a no-op; the reverse order could leave a piece no cascade reaches.
 */
export async function markFiled(ctx: BlockContext, taskId: string): Promise<void> {
  const partition = stringAt(ctx, FILING_SESSION_STATE_KEY);
  const flow = stringAt(ctx, TASK_FLOW_STATE_KEY);
  if (partition === undefined || flow === undefined) return;
  const above = await conversationLedgerAt(ctx, partition);
  const row = above?.get(taskId);
  if (above === undefined || row === undefined) return;
  const marker: FiledMarker = { session: ctx.session.identity.id, flow };
  const current = filedMarkerOf(row);
  if (current !== undefined && current.session === marker.session && current.flow === marker.flow) return;
  await above.patchMetadata(taskId, { [FILED_MARKER]: marker });
}

/** Why a cascade cancelled a piece, in the piece's row. */
function cancelReason(row: Task): string {
  const how = row.status === "pending" ? "is running again" : row.status === "cancelled" ? "was cancelled" : "failed";
  return `Its parent task "${row.id}" ${how}, so the work it filed was cancelled.`;
}

/**
 * The conversation ledger's filed-task payer: owed for a failure, a retry or
 * a cancel of a row whose session filed work, paid as the module header says.
 */
export const filedCascade: DeclaredFiledCascade = {
  owes: (row, ending) => endsFiledWork(ending) && filedMarkerOf(row) !== undefined,
  pay: async (ctx, row) => {
    const marker = filedMarkerOf(row);
    if (marker === undefined) return true;
    if (ctx.session?.identity?.id === marker.session) {
      const own = await ownConversationLedger(ctx);
      if (own === undefined) return true;
      for (const piece of own.list()) {
        if (piece.metadata?.[PIECE_OF] !== row.id || isTerminalStatus(piece.status)) continue;
        await own.cancel(piece.id, cancelReason(row));
      }
      return true;
    }
    try {
      await dispatchThroughSeam(ctx, {
        type: "internal",
        action: CANCEL_PIECES_ENTRY,
        flowKind: marker.flow,
        session: { id: marker.session },
        payload: { taskId: row.id },
        from: "task-cascade"
      });
      return true;
    } catch {
      // Owed still: the board's next touch past the due time sends it again.
      return false;
    }
  }
};
