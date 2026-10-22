/**
 * The conversation-board row the running request holds, found by the run link
 * the claim gate wrote on it. Read by splitting (which task a filed piece
 * belongs to) and by the project lookup (what project the task names).
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task, TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { TASK_ID_STATE_KEY } from "../workers/keys";
import { boardAboveOf } from "./board-above";
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
 * session runs one task at a time (a task session its task and follow-ups,
 * a delegate's ongoing session or a workstream's its routed tasks, FIX-2083), so this is the
 * one running now. None in a request that holds no task.
 */
export async function heldTask(ctx: BlockContext): Promise<{ ref: TaskCollectionRef; row: Task; partition: string } | undefined> {
  const partition = boardAboveOf(ctx);
  if (partition === undefined) return undefined;
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
 * else a task session's own task. In a delegate's ongoing session (FIX-2083),
 * only the routed task this request holds: a turn there that works no task
 * files plain tasks.
 */
export async function pieceOwnerOf(ctx: BlockContext): Promise<string | undefined> {
  return (await heldTask(ctx))?.row.id ?? stringAt(ctx, TASK_ID_STATE_KEY);
}
