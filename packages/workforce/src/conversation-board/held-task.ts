/**
 * The conversation-board row the running request holds, found by the run link
 * the claim gate wrote on it. Read by splitting (which task a filed piece
 * belongs to) and by the project lookup (what project the task names).
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task, TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { FILING_SESSION_STATE_KEY, TASK_ID_STATE_KEY } from "../workers/keys";
import { conversationLedgerAt } from "./ledger";
import { currentWorkerClaim } from "@flow-state-dev/orchestration/task-board";

function stringAt(ctx: BlockContext, key: string): string | undefined {
  const value = ((ctx.session.state ?? {}) as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * The task on the board above that the running request holds: the row whose
 * run link names this request (the gate wrote it, fenced by the ticket it
 * minted, before the turn ran), or, in a request admitted for a waiting task
 * (a notice of its piece's ending, FIX-2077), the row whose claim it holds. A
 * task session runs a task and its follow-ups one at a time, so this is the
 * one running now.
 */
export async function heldTask(ctx: BlockContext): Promise<{ ref: TaskCollectionRef; row: Task; partition: string } | undefined> {
  const partition = stringAt(ctx, FILING_SESSION_STATE_KEY);
  if (partition === undefined || stringAt(ctx, TASK_ID_STATE_KEY) === undefined) return undefined;
  const requestId = (ctx as { request?: { identity?: { id?: string } } }).request?.identity?.id;
  if (requestId === undefined) return undefined;
  const ref = await conversationLedgerAt(ctx, partition);
  const claimed = currentWorkerClaim(ctx);
  const row = ref
    ?.list({ status: "in_progress" })
    .find((task) => task.run?.requestId === requestId || (claimed?.collectionId === ref.collectionId && claimed.taskId === task.id));
  return ref === undefined || row === undefined ? undefined : { ref, row, partition };
}

/**
 * The task a piece filed now in the running session is a piece of: the task
 * this request holds (its turn, or a turn a piece's ending woke, filed it),
 * else the session's own task. None outside a task session.
 */
export async function pieceOwnerOf(ctx: BlockContext): Promise<string | undefined> {
  const own = stringAt(ctx, TASK_ID_STATE_KEY);
  if (own === undefined) return undefined;
  return (await heldTask(ctx))?.row.id ?? own;
}
