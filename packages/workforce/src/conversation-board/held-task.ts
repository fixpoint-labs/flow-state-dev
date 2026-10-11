/**
 * The conversation-board row the running request holds, found by the run link
 * the claim gate wrote on it. Read by splitting (which task a filed piece
 * belongs to) and by the project lookup (what project the task names).
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task, TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { FILING_SESSION_STATE_KEY, TASK_ID_STATE_KEY } from "../workers/keys";
import { conversationLedgerAt } from "./ledger";

function stringAt(ctx: BlockContext, key: string): string | undefined {
  const value = ((ctx.session.state ?? {}) as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * The task on the board above that the running request holds: the row whose
 * run link names this request (the gate wrote it, fenced by the ticket it
 * minted, before the turn ran). A task session runs a task and its
 * follow-ups one at a time, so this is the one running now.
 */
export async function heldTask(ctx: BlockContext): Promise<{ ref: TaskCollectionRef; row: Task; partition: string } | undefined> {
  const partition = stringAt(ctx, FILING_SESSION_STATE_KEY);
  if (partition === undefined || stringAt(ctx, TASK_ID_STATE_KEY) === undefined) return undefined;
  const requestId = (ctx as { request?: { identity?: { id?: string } } }).request?.identity?.id;
  if (requestId === undefined) return undefined;
  const ref = await conversationLedgerAt(ctx, partition);
  const row = ref?.list().find((task) => task.run?.requestId === requestId && task.status === "in_progress");
  return ref === undefined || row === undefined ? undefined : { ref, row, partition };
}

