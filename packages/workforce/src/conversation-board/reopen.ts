/**
 * A person's message on a finished task picks it up again (FIX-1764).
 *
 * The task, the board, and where it runs are the session's own fields
 * (BP-031). A drain that fails leaves the row pending: the conversation's
 * next touch of its board starts it.
 */
import { handler, router } from "@flow-state-dev/core";
import { dispatchThroughSeam, type BlockContext, type BlockDefinition } from "@flow-state-dev/core/types";
import { isTerminalStatus, type Task, type TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { RUN_BOARD_ENTRY } from "./board-entries";
import { sessionIdOfFiling } from "./filing-session";
import { conversationLedgerAt, conversationLedgerResources } from "./ledger";
import { filingFlowOf, filingPartitionOf, sessionTaskOf } from "./task-entry";

/** A task session's finished task, with the board it is on and where that board runs. */
interface FinishedTask {
  readonly ledger: TaskCollectionRef;
  readonly row: Task;
  readonly filingSession: string;
  readonly filingFlow: string;
}

/**
 * The task this session works, when it and every follow-up of it have
 * finished: the latest of them. `undefined` outside a conversation's task
 * session, or while one of them is still open.
 */
async function finishedTaskOf(ctx: BlockContext): Promise<FinishedTask | undefined> {
  const taskId = sessionTaskOf(ctx);
  const partition = filingPartitionOf(ctx);
  const filingFlow = filingFlowOf(ctx);
  if (taskId === undefined || partition === undefined || filingFlow === undefined) return undefined;
  const ledger = await conversationLedgerAt(ctx, partition);
  if (ledger === undefined) return undefined;
  const rows = ledger.list().filter((task) => (task.followUpOf ?? task.id) === taskId) as Task[];
  if (rows.length === 0 || rows.some((task) => !isTerminalStatus(task.status))) return undefined;
  const row = rows.reduce((latest, task) => (task.createdAt > latest.createdAt ? task : latest));
  return { ledger, row, filingSession: sessionIdOfFiling(partition), filingFlow };
}

/** What a reopening line answers: the task it put back on its board. */
const reopenedSchema = z.object({ reopened: z.string() });

/**
 * Put the finished task back on its board and run the board in the
 * conversation that filed it. Declared beside the turn, so the line is in the
 * session before either runs.
 */
const reopenFinishedTask = handler({
  name: "worker-reopen-finished-task",
  inputSchema: z.unknown(),
  outputSchema: reopenedSchema,
  resources: { ...conversationLedgerResources },
  execute: async (_input, ctx) => {
    const finished = await finishedTaskOf(ctx as never);
    if (finished === undefined) {
      // Chosen as finished a moment ago; reopened since by another line, which
      // started the attempt that will read this one too.
      return { reopened: sessionTaskOf(ctx as never) ?? "" };
    }
    const { ledger, row, filingSession, filingFlow } = finished;
    await ledger.reopen(row.id);
    try {
      await dispatchThroughSeam(ctx as never, {
        type: "internal",
        action: RUN_BOARD_ENTRY,
        flowKind: filingFlow,
        session: { id: filingSession },
        payload: {},
        from: "worker-reopen-finished-task"
      });
    } catch {
      // The row stays pending and assigned: the conversation's next touch of its board starts it.
    }
    return { reopened: row.id };
  }
});

/**
 * A worker's reply to a person, which reopens the session's task when that
 * task has finished, and is `turn` otherwise.
 *
 * @param turn The worker's turn for one message: what the door ran before.
 */
export function replyOrReopen(turn: BlockDefinition<any, any>): BlockDefinition<any, any> {
  return router({
    name: "worker-reply-or-reopen",
    inputSchema: turn.inputSchema,
    routes: [turn, reopenFinishedTask],
    resources: { ...conversationLedgerResources },
    execute: async (_input: unknown, ctx: BlockContext) =>
      (await finishedTaskOf(ctx)) === undefined ? turn : reopenFinishedTask
  } as never) as BlockDefinition<any, any>;
}
