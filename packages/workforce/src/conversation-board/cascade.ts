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
 *
 * The ledger hands in its own lookup ({@link LedgerAt}) rather than this
 * module importing it, since the ledger declares the payer.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  endsFiledWork,
  isTerminalStatus,
  parentCancelledRefusal,
  readCommittedTask,
  type DeclaredFiledCascade,
  cascadeEndedAt,
  type Task,
  type TaskCollectionRef
} from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { boardAboveOf } from "./board-above";
import { FILED_MARKER, PIECE_OF } from "./board-entries";
import { filingSessionIdOf } from "./filing-session";

/** The conversation ledger at a partition, as the running user's scope holds it. */
type LedgerAt = (ctx: BlockContext, partition: string) => Promise<TaskCollectionRef | undefined>;

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
export async function stampFiledMarker(ctx: BlockContext, taskId: string, ledgerAt: LedgerAt): Promise<void> {
  const above = boardAboveOf(ctx);
  if (above === undefined) return;
  const ref = await ledgerAt(ctx, above);
  const row = ref?.get(taskId);
  if (ref === undefined || row === undefined) return;
  const marker: FiledMarker = { session: ctx.session.identity.id, partition: await filingSessionIdOf(ctx.session) };
  const current = filedMarkerOf(row);
  if (current !== undefined && current.session === marker.session && current.partition === marker.partition) return;
  await ref.patchMetadata(taskId, { [FILED_MARKER]: marker });
}

/**
 * Refuse a piece of `taskId` before it is added, when the task is already
 * cancelled (FIX-2129): a cancelled task's block runs on to its end, and a
 * piece it files then would outlive it, since the cascade cancels only what
 * was filed up to the cancel. Read against the committed row on the board
 * above, not this process's copy of it, so no claimable piece of a cancelled
 * task is ever written.
 *
 * @throws {TaskFilingRefusedError} `parent_cancelled`.
 */
export async function refuseIfParentCancelled(ctx: BlockContext, taskId: string, ledgerAt: LedgerAt): Promise<void> {
  const above = boardAboveOf(ctx);
  if (above === undefined) return;
  const ref = await ledgerAt(ctx, above);
  if (ref === undefined) return;
  const parent = await readCommittedTask(ref, taskId);
  if (parent?.status === "cancelled") throw parentCancelledRefusal(taskId);
}

/**
 * Once a piece of `taskId` is added on `board`, cancel it if the task has
 * already failed for good or been cancelled. The task's ending and the
 * piece's add are separate writes: an ending that lands between the marker's
 * stamp and the add finds nothing to cancel, so the add checks after itself.
 * A task cancelled before the filing is refused first
 * ({@link refuseIfParentCancelled}); this catches one cancelled meanwhile.
 *
 * @returns Whether the piece was cancelled.
 */
export async function cancelIfParentEnded(
  ctx: BlockContext,
  taskId: string,
  board: TaskCollectionRef,
  pieceId: string,
  ledgerAt: LedgerAt
): Promise<boolean> {
  const above = boardAboveOf(ctx);
  if (above === undefined) return false;
  const parent = (await ledgerAt(ctx, above))?.get(taskId);
  if (parent === undefined || (parent.status !== "errored" && parent.status !== "cancelled")) return false;
  const outcome = await board.cancel(pieceId, cancelReason(parent));
  return outcome.outcome === "recorded";
}

/** Why a cascade cancelled a piece, in the piece's row. */
function cancelReason(row: Task): string {
  const how = row.status === "pending" ? "is running again" : row.status === "cancelled" ? "was cancelled" : "failed";
  return `Its parent task "${row.id}" ${how}, so the work it filed was cancelled.`;
}

/**
 * The conversation ledger's filed-task payer: owed for a failure, a retry or
 * a cancel of a row whose session filed work, paid as the module header says.
 *
 * @param ledgerAt The ledger's own lookup, to reach the board the pieces are on.
 */
export function filedCascadeOver(ledgerAt: LedgerAt): DeclaredFiledCascade {
  return {
    owes: (row, ending) => endsFiledWork(ending) && filedMarkerOf(row) !== undefined,
    pay: async (ctx, row) => {
      const marker = filedMarkerOf(row);
      if (marker === undefined || row.cascadeOwed == null) return true;
      const board = await ledgerAt(ctx, marker.partition);
      if (board === undefined) return false;
      // Only the work filed by the ending this debt is for: a late payment
      // finds the next attempt's pieces under the same parent too. The piece's
      // `createdAt` and the debt's `endedAt` come from two boards' clocks,
      // possibly in two processes, so skew can misplace a piece across the
      // line. That takes a crash and skew both, so it isn't handled; if it
      // ever matters, the parent's `attempt` at filing is the skew-free key.
      const endedAt = cascadeEndedAt(row.cascadeOwed);
      for (const piece of board.list()) {
        if (piece.metadata?.[PIECE_OF] !== row.id || isTerminalStatus(piece.status) || piece.createdAt > endedAt) continue;
        await board.cancel(piece.id, cancelReason(row));
      }
      return true;
    }
  };
}
