/**
 * The requests a task session runs for its task beside the `work` entry
 * (FIX-2077): a notice of a piece's ending (`onTaskSettled`) and a worker's
 * message (`onWorkerMessage`). While the task waits, each is admitted for it
 * through orchestration's `taskRequestAdmission`, and the task is checked at
 * its end (rule 6), as at the end of `work`.
 *
 * Workforce answers the two things orchestration can't:
 *
 * - **Which task.** The running row on the conversation ledger this session
 *   was opened for (its readonly `filingSessionId`) whose run link names this
 *   session: server-set state only.
 * - **What else holds it** ({@link conversationEndRules}). Its pieces, on the
 *   session's own board: one that is open, or whose ending this session hasn't
 *   acted on yet. And a message for this session, sent during the task's
 *   current attempt, that the session hasn't acted on: a delivered row in the
 *   user's message log, not the process's admission line, so a restart
 *   doesn't lose it. A message that never runs doesn't hold the task forever:
 *   a task waiting on one keeps its lease (orchestration's rule), so the lapse
 *   takes it back.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, ConcurrencyConfig } from "@flow-state-dev/core/types";
import { z } from "zod";
import { afterTaskCheck, taskRequestAdmission, type TaskEndRules } from "@flow-state-dev/orchestration/task-board";
import { filedWorkHolds, holdsItsFiler, type Task, type TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { messageLogOf } from "../messages/message-log";
import { WORKER_MESSAGES_SEEN_STATE } from "../messages/keys";
import { FILING_SESSION_STATE_KEY } from "../workers/keys";
import { CHECK_TASK_ENTRY, PIECE_OF } from "./board-entries";
import { conversationLedgerAt, ownConversationLedger } from "./ledger";

/** The running row this session works, on the ledger of the conversation it was opened for, or none. */
async function ownTaskRow(ctx: BlockContext): Promise<{ ref: TaskCollectionRef; row: Task } | undefined> {
  const filing = ((ctx.session.state ?? {}) as Record<string, unknown>)[FILING_SESSION_STATE_KEY];
  if (typeof filing !== "string") return undefined;
  const ref = await conversationLedgerAt(ctx, filing);
  const sessionId = ctx.session.identity.id;
  const row = ref?.list({ status: "in_progress" }).find((task) => task.run?.sessionId === sessionId);
  return ref === undefined || row === undefined ? undefined : { ref, row };
}

/**
 * Whether a message for this session, sent during `task`'s current attempt, is
 * delivered and not yet acted on here. One sent before the attempt started
 * belongs to an attempt that is over. A run link with no start time (written
 * before it carried one) counts them all.
 *
 * The log is listed whole: it is keyed by message id, with no index by the
 * session a message is for to filter on (BP-033's gap here).
 */
async function messageQueued(ctx: BlockContext, task: Task): Promise<boolean> {
  let log;
  try {
    log = messageLogOf(ctx);
  } catch {
    // A flow without the message log queues no messages.
    return false;
  }
  const seen = new Set(((ctx.session.state ?? {}) as Record<string, unknown>)[WORKER_MESSAGES_SEEN_STATE] as string[] | undefined);
  const sessionId = ctx.session.identity.id;
  const since = task.run?.startedAt ?? Number.NEGATIVE_INFINITY;
  for (const ref of await log.list()) {
    const row = ref.state;
    if (row?.toSession === sessionId && row.status === "delivered" && row.at >= since && !seen.has(row.id)) return true;
  }
  return false;
}

/**
 * Whether a piece of `taskId` on `board` still holds it: one it filed
 * (`filedByTask`), or a row the board stamped as its piece (`PIECE_OF`) with
 * no `filedByTask`, as rows stored before it carried one are.
 */
export function piecesHold(board: TaskCollectionRef, taskId: string): boolean {
  if (filedWorkHolds(board, taskId)) return true;
  // No filter on metadata: the legacy rows are found by listing the board.
  return board.list().some((row) => row.filedByTask == null && row.metadata?.[PIECE_OF] === taskId && holdsItsFiler(row));
}

/** What else holds a task session's task open, beside its own request (rule 6). */
export const conversationEndRules: TaskEndRules = {
  filedWorkHolds: async (ctx, task) => {
    const own = await ownConversationLedger(ctx);
    return own !== undefined && piecesHold(own, task.id);
  },
  workQueued: messageQueued
};

/**
 * The check entry (`CHECK_TASK_ENTRY`): admit the session's waiting task, so
 * the check at the request's end settles it when nothing holds it, then clear
 * the wake that ran it. On the notices' line, so it never runs beside a notice
 * or a message for the same task.
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
        if (own !== undefined && own.row.waitingOn == null) return;
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
 * the conversation ledger and the message log (the session kit's resources).
 *
 * @param answerCounts Whether the entry's turn answer can be the task's result (a woken turn's can, a message's can't).
 */
export function admitOwnTask(name: string, answerCounts: boolean) {
  return taskRequestAdmission({
    name,
    answerCounts,
    find: ownTaskRow,
    endRules: conversationEndRules
  });
}
