/**
 * The filed half of a task's cascade on a conversation's board (FIX-2080 D2):
 * when a task fails, retries or is cancelled, the open tasks its session
 * filed are cancelled, so no filed task outlives the task that filed it.
 *
 * - **Which tasks.** A task's session files its pieces on its own board (the
 *   ledger at that session's partition), each marked as a piece of the task
 *   (`PIECE_OF`). The first piece it files stamps the task's row on the board
 *   above with where those pieces are (`FILED_MARKER`: the session and its
 *   partition), server-written, so the ending knows where to cancel.
 * - **The debt.** Orchestration writes `Task.cascadeOwed` in the ending's own
 *   write for a row that carries the marker ({@link filedCascade}`.owes`), so
 *   a crash between the ending and the cancels leaves it owed, not lost.
 * - **The payment.** Whichever request wrote the ending cancels the open
 *   pieces on that board, directly: the ledger sits at the user's own scope,
 *   so the task's own session (the claim gate's ending, a retry) and the
 *   conversation that filed it (a cancel) reach it alike, within the ending's
 *   own pass. One that fails leaves the debt for the board's next touch past
 *   its due time.
 *
 * Each piece's cancel is itself an ending on the session's board, so a piece
 * that filed work of its own cascades in turn, down the chain.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  endsFiledWork,
  isTerminalStatus,
  type DeclaredFiledCascade,
  type Task
} from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { FILING_SESSION_STATE_KEY } from "../workers/keys";
import { FILED_MARKER, PIECE_OF } from "./board-entries";
import { filingSessionIdOf } from "./filing-session";
import { conversationLedgerAt } from "./ledger";

const filedMarkerSchema = z.object({ session: z.string().min(1), partition: z.string().min(1) });

/** Where a task's session filed its pieces: that session, and its board's partition. */
type FiledMarker = z.infer<typeof filedMarkerSchema>;

/** The row's filed marker, when it carries one that reads. */
function filedMarkerOf(row: Pick<Task, "metadata"> | undefined): FiledMarker | undefined {
  const parsed = filedMarkerSchema.safeParse(row?.metadata?.[FILED_MARKER]);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Stamp `taskId`'s row on the board above with this session, before the
 * running task session files its first piece for it. A crash between the
 * stamp and the piece's add leaves a marker with nothing to cancel, which
 * costs a no-op; the reverse order could leave a piece no cascade reaches.
 */
export async function markFiled(ctx: BlockContext, taskId: string): Promise<void> {
  const above = ((ctx.session.state ?? {}) as Record<string, unknown>)[FILING_SESSION_STATE_KEY];
  if (typeof above !== "string") return;
  const ref = await conversationLedgerAt(ctx, above);
  const row = ref?.get(taskId);
  if (ref === undefined || row === undefined) return;
  const marker: FiledMarker = { session: ctx.session.identity.id, partition: await filingSessionIdOf(ctx.session) };
  const current = filedMarkerOf(row);
  if (current !== undefined && current.session === marker.session && current.partition === marker.partition) return;
  await ref.patchMetadata(taskId, { [FILED_MARKER]: marker });
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
    const board = await conversationLedgerAt(ctx, marker.partition);
    if (board === undefined) return false;
    for (const piece of board.list()) {
      if (piece.metadata?.[PIECE_OF] !== row.id || isTerminalStatus(piece.status)) continue;
      await board.cancel(piece.id, cancelReason(row));
    }
    return true;
  }
};
