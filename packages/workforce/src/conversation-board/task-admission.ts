/**
 * The requests a task session runs for its task beside the `work` entry
 * (FIX-2077): a notice of a piece's ending (`onTaskSettled`), the check entry
 * and the turn a late steer is owed. While the task waits, each is admitted
 * for it through orchestration's `taskRequestAdmission`, and the task is
 * checked at its end (rule 6), as at the end of `work`. A worker's message
 * (`onMessageReceived`) is never one of them: it is conversation in the
 * session, never part of the task; while the task's turn runs, it is
 * answered after that turn.
 *
 * Workforce answers the two things orchestration can't:
 *
 * - **Which task.** The running row on the conversation ledger this session
 *   was opened for (its readonly `filingSessionId`) whose run link names this
 *   session: server-set state only.
 * - **What else holds it** ({@link conversationEndRules}). Its pieces, on the
 *   session's own board: one that is open, or whose ending this session hasn't
 *   acted on yet.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, ConcurrencyConfig } from "@flow-state-dev/core/types";
import { z } from "zod";
import { afterTaskCheck, taskRequestAdmission, type TaskEndRules } from "@flow-state-dev/orchestration/task-board";
import { filedWorkKeepsOpen, keepsFilerOpen, type Task, type TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { boardAboveOf } from "./board-above";
import { CHECK_TASK_ENTRY, PIECE_OF, STEER_TURN_ENTRY } from "./board-entries";
import { conversationLedgerAt, ownConversationLedger } from "./ledger";
import { anotherTurnWaitsOnItsPlan } from "./plan";

/** The running row this session works, on the board above it (`./board-above`), or none. */
async function ownTaskRow(ctx: BlockContext): Promise<{ ref: TaskCollectionRef; row: Task } | undefined> {
  const filing = boardAboveOf(ctx);
  if (filing === undefined) return undefined;
  const ref = await conversationLedgerAt(ctx, filing);
  const sessionId = ctx.session.identity.id;
  const row = ref?.list({ status: "in_progress" }).find((task) => task.run?.sessionId === sessionId);
  return ref === undefined || row === undefined ? undefined : { ref, row };
}

/** Whether this request's task row has `resultTo: "conversation"`. The row, never session state. */
export async function worksConversationResultTask(ctx: BlockContext): Promise<boolean> {
  return (await ownTaskRow(ctx))?.row.resultTo === "conversation";
}

/**
 * Whether a piece of `taskId` on `board` still holds it: one it filed
 * (`filedByTask`), or a row the board stamped as its piece (`PIECE_OF`) with
 * no `filedByTask`, as rows stored before it carried one are.
 */
export function piecesHold(board: TaskCollectionRef, taskId: string): boolean {
  if (filedWorkKeepsOpen(board, taskId)) return true;
  // No filter on metadata: the legacy rows are found by listing the board.
  return board.list().some((row) => row.filedByTask == null && row.metadata?.[PIECE_OF] === taskId && keepsFilerOpen(row));
}

/**
 * What else holds a task session's task open, beside its own request (rule
 * 6), and the entry that runs the turn a late steer is owed (FIX-2086 D2).
 */
export const conversationEndRules: TaskEndRules = {
  filedWorkKeepsOpen: async (ctx, task) => {
    const own = await ownConversationLedger(ctx);
    return own !== undefined && piecesHold(own, task.id);
  },
  steerTurn: { entry: STEER_TURN_ENTRY }
};

/**
 * The check entry (`CHECK_TASK_ENTRY`): admit the session's waiting task, so
 * the check at the request's end settles it when nothing holds it, then clear
 * the wake that ran it. On the notices' line, so it never runs beside a notice
 * for the same task.
 */
export function checkTaskEntry(concurrency: ConcurrencyConfig) {
  // Cleared after the check, never before, and only once the check left the
  // task settled or waiting on something that wakes it: a crash, or a write
  // that failed (the task still running, waiting on nothing), leaves the wake
  // to run the check again.
  const settleWake = handler({
    name: "conversation-check-task-settle-wake",
    inputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      await afterTaskCheck(ctx, async () => {
        const own = await ownTaskRow(ctx);
        if (own !== undefined && own.row.keptOpenBy == null) return;
        const wakes = ctx.requestHost?.wakes;
        const read = await wakes?.read(CHECK_TASK_ENTRY);
        if (wakes !== undefined && read !== undefined) await wakes.settle(CHECK_TASK_ENTRY, read, null);
      });
    }
  });
  return {
    inputSchema: z.object({}).passthrough(),
    block: sequencer({ name: "conversation-check-task", inputSchema: z.unknown() })
      .tap(admitOwnTask("conversation-check-task-admission", false))
      .tap(settleWake),
    concurrency
  };
}

/**
 * Admit the running request for this session's task while it waits: first in
 * the entry's sequencer, `.tap(admitOwnTask(...))`. The entry's flow declares
 * the conversation ledger (the session kit's resources).
 *
 * @param answerCounts Whether the entry's turn answer can be the task's result (a woken turn's can; the check entry, which runs no turn, can't).
 * @param options.unlessAnotherTurnWaits Admit nothing while another request in the session waits on a step of its own plan (a steer's turn, FIX-2113).
 */
export function admitOwnTask(name: string, answerCounts: boolean, options: { readonly unlessAnotherTurnWaits?: boolean } = {}) {
  return taskRequestAdmission({
    name,
    answerCounts,
    find: async (ctx) =>
      // With `unlessAnotherTurnWaits`, nothing while another request here
      // waits on a step of its own plan (FIX-2113): its turn isn't over.
      options.unlessAnotherTurnWaits === true && (await anotherTurnWaitsOnItsPlan(ctx)) ? undefined : ownTaskRow(ctx),
    endRules: conversationEndRules
  });
}
