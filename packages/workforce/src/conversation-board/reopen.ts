/**
 * A person's message on a finished task picks it up again (FIX-1764).
 *
 * A worker's door (`run` on the agent flow) answers a person's line with a
 * turn. In a conversation's task session whose task has finished, the line
 * reopens the task instead: the row goes back on the conversation's board
 * (orchestration's `reopen`, which only a finished row takes) and the board
 * runs, so the task reads in progress again and its next attempt runs here,
 * in its own session, where the line already is. That attempt's turn is the
 * worker's answer, and the conversation that filed the task hears how it
 * ends, as for any attempt.
 *
 * - **Which task.** The session's task, or the latest of its follow-ups: they
 *   run here one at a time (FIX-1817). While any of them is not finished, the
 *   line is a turn, as it always was.
 * - **Server state only (BP-031).** The task, the board and where it runs are
 *   read off the session's own fields, written once by the hand-over; nothing
 *   in the person's input picks a row.
 * - **A start that is lost** leaves the row pending and assigned, which is its
 *   start debt: the conversation's next touch of its board starts it.
 */
import { handler, router } from "@flow-state-dev/core";
import { dispatchThroughSeam, type BlockContext, type BlockDefinition } from "@flow-state-dev/core/types";
import { isTerminalStatus, type Task, type TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { FILING_FLOW_STATE_KEY, FILING_SESSION_STATE_KEY, TASK_ID_STATE_KEY } from "../workers/keys";
import { RUN_BOARD_ENTRY } from "./board-entries";
import { sessionIdOfFiling } from "./filing-session";
import { conversationLedgerAt, conversationLedgerResources } from "./ledger";

/** A readonly string field the hand-over wrote on the session at its birth. */
function sessionField(ctx: BlockContext, key: string): string | undefined {
  const value = (ctx.session.state as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

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
  const taskId = sessionField(ctx, TASK_ID_STATE_KEY);
  const partition = sessionField(ctx, FILING_SESSION_STATE_KEY);
  const filingFlow = sessionField(ctx, FILING_FLOW_STATE_KEY);
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
      return { reopened: sessionField(ctx as never, TASK_ID_STATE_KEY) ?? "" };
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
