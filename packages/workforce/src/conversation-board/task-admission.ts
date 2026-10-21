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
 *   acted on yet. And a message for this session that the session hasn't
 *   acted on: a delivered row in the user's message log, not the process's
 *   admission line, so a restart doesn't lose it.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { taskRequestAdmission, type TaskEndRules } from "@flow-state-dev/orchestration/task-board";
import { filedWorkHolds, type Task, type TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { messageLogOf } from "../messages/message-log";
import { WORKER_MESSAGES_SEEN_STATE } from "../messages/worker-message-entry";
import { FILING_SESSION_STATE_KEY } from "../workers/keys";
import { conversationLedgerAt, ownConversationLedger } from "./ledger";

/** The running row this session works, on the ledger of the conversation it was opened for, or none. */
export async function ownTaskRow(ctx: BlockContext): Promise<{ ref: TaskCollectionRef; row: Task } | undefined> {
  const filing = ((ctx.session.state ?? {}) as Record<string, unknown>)[FILING_SESSION_STATE_KEY];
  if (typeof filing !== "string") return undefined;
  const ref = await conversationLedgerAt(ctx, filing);
  const sessionId = ctx.session.identity.id;
  const row = ref?.list({ status: "in_progress" }).find((task) => task.run?.sessionId === sessionId);
  return ref === undefined || row === undefined ? undefined : { ref, row };
}

/** Whether a message for this session is delivered and not yet acted on here. */
async function messageQueued(ctx: BlockContext): Promise<boolean> {
  let log;
  try {
    log = messageLogOf(ctx);
  } catch {
    // A flow without the message log queues no messages.
    return false;
  }
  const seen = new Set(((ctx.session.state ?? {}) as Record<string, unknown>)[WORKER_MESSAGES_SEEN_STATE] as string[] | undefined);
  const sessionId = ctx.session.identity.id;
  for (const ref of await log.list()) {
    const row = ref.state;
    if (row?.toSession === sessionId && row.status === "delivered" && !seen.has(row.id)) return true;
  }
  return false;
}

/** What else holds a task session's task open, beside its own request (rule 6). */
export const conversationEndRules: TaskEndRules = {
  filedWorkHolds: async (ctx, task) => {
    const own = await ownConversationLedger(ctx);
    return own !== undefined && filedWorkHolds(own, task.id);
  },
  workQueued: (ctx) => messageQueued(ctx)
};

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
