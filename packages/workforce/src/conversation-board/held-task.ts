/**
 * The conversation-board row the running request holds, found by the run link
 * the claim gate wrote on it. Read by splitting (which task a filed piece
 * belongs to) and by the project lookup (what project the task names).
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task, TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { TASK_ID_STATE_KEY } from "../workers/keys";
import { boardAboveOf } from "./board-above";
import { FILED_PROJECT } from "./board-entries";
import { filingProjectOf } from "./filing-session";
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
export async function claimedTask(ctx: BlockContext): Promise<{ ref: TaskCollectionRef; row: Task; partition: string } | undefined> {
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
 * this request holds (its turn, or a turn a piece's ending woke, filed it);
 * else the row whose run link names this request, whatever its status, so a
 * run that goes on after its task was cancelled (one the cancel resumed from
 * a wait for a user, FIX-2129) files under that task and is refused; else a
 * task session's own task. The run link comes first because the session's
 * state can name another row: a follow-up runs in its root's session, which
 * names the root, and a delegate's ongoing session (FIX-2083) names none. A
 * turn there that works no task files plain tasks.
 */
export async function pieceOwnerOf(ctx: BlockContext): Promise<string | undefined> {
  return (await claimedTask(ctx))?.row.id ?? (await linkedTaskOf(ctx)) ?? stringAt(ctx, TASK_ID_STATE_KEY);
}

/** The row on the board above whose run link names the running request, in any status. */
async function linkedTaskOf(ctx: BlockContext): Promise<string | undefined> {
  const partition = boardAboveOf(ctx);
  const requestId = (ctx as { request?: { identity?: { id?: string } } }).request?.identity?.id;
  if (partition === undefined || requestId === undefined) return undefined;
  const ref = await conversationLedgerAt(ctx, partition);
  return ref?.list().find((task) => task.run?.requestId === requestId)?.id;
}

/**
 * The project a task's row was stamped with when it was filed (FIX-2161), in
 * `projectRef` form: `undefined` for a row filed with no project, and for a
 * row filed before rows carried the stamp (see {@link isStamped}).
 */
export function filedProjectOf(row: Pick<Task, "metadata"> | undefined): string | undefined {
  const stamp = row?.metadata?.[FILED_PROJECT];
  return typeof stamp === "string" ? stamp : undefined;
}

/** Whether a task's row carries the project stamp, even an empty one: one filed before rows carried it doesn't (BP-030). */
export function isStamped(row: Pick<Task, "metadata"> | undefined): boolean {
  return row?.metadata != null && Object.hasOwn(row.metadata, FILED_PROJECT);
}

/**
 * The project a task filed now in the running session is stamped with: the
 * session's own (`filingProjectOf`), else, in a delegate's ongoing session,
 * which has none of its own, the stamp on the task this request holds, so a
 * piece filed there carries its project on. `null` for none.
 */
export async function filingProjectStampOf(ctx: BlockContext): Promise<string | null> {
  return filingProjectOf(ctx.session.state) ?? filedProjectOf((await claimedTask(ctx))?.row) ?? null;
}
