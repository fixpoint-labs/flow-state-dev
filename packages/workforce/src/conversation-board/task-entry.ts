/**
 * The `work` task entry a worker flow takes tasks through (FIX-1794 S6): the
 * task as one turn of the worker, behind the claim gate, and the notice its
 * ending owes, sent to the conversation that filed it.
 *
 * - **Where it takes tasks from.** Any conversation's board, read off the
 *   conversation ledger at the partition the hand-over names, at the running
 *   user's scope only. Every check a board's gate runs (row, attempt, identity,
 *   status, assignee, lease, run link) runs on the ledger the hand-over names.
 *   A task session takes tasks only from the conversation it was opened for.
 * - **The message** (FIX-1817). The task as filed is the turn's user item,
 *   so it is part of the session's history; on the attempt an answer to the
 *   worker's question re-queued, the answer is, labelled as one.
 * - **The ending.** The gate settles the row through the ledger, whose ending
 *   recorder marks the notice owed in that same write (orchestration's notice
 *   module).
 * - **The notice** (FIX-2078). The gate's ending is delivered by
 *   orchestration in that write's own pass: the filer's wake first, then the
 *   notice to the session that filed the task. Before FIX-2078, after the gate,
 *   on success or failure, each notice the
 *   session's task still owes (the task the hand-over named at the session's
 *   birth, and the follow-ups that run after it in the same session, one at
 *   a time) goes to the session that dispatched
 *   this request, its stamped sender (`{ from: true }`), on the flow the
 *   hand-over named at the session's birth (`filingFlow`), never an address
 *   from the row or the task. Delivery clears the marker in the conversation. A refusal (the
 *   conversation is gone) clears it here and says so in this session; the
 *   task's ending stands. A thrown send, or any other refusal, leaves it owed
 *   for the conversation's next touch of its board. A conversation whose
 *   worker was fired accepts the send and then refuses to run it: the notice
 *   stays owed, and this session never hears of that refusal.
 * - **Its pieces** (FIX-2077). A turn that files pieces on the task
 *   session's own board leaves its task running when it ends, with no lease
 *   (`waitingOn: "filed"`); the turn each piece's ending wakes runs for the
 *   task (`./task-admission`), and the request after which no piece holds it
 *   and no message is queued settles it, through the gate's one check. The
 *   entry holds the session's reply line while it runs, so a piece's notice
 *   waits for the turn to end.
 */
import { defineCapability, sequencer } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition, TaskDispatchInput } from "@flow-state-dev/core/types";
import { taskLedgers, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import {
  type TaskClaimTicket,
  type TaskCollectionRef,
  type TaskWorkerInput
} from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { FILING_FLOW_STATE_KEY, FILING_SESSION_STATE_KEY, TASK_ID_STATE_KEY } from "../workers/keys";
import { RUN_BOARD_ENTRY } from "./board-entries";
import { CONVERSATION_LEDGER_ID, conversationLedgerAt, conversationLedgerResources } from "./ledger";
import { sessionIdOfFiling } from "./filing-session";
import { conversationEndRules } from "./task-admission";
import { REPLY_CONCURRENCY } from "./task-settled";
import { markConversationTaskDoor } from "../worker-task-entry";
import { steersBrief, taskMessage } from "./task-message";


/**
 * What a task turn says (FIX-1817): the answer to the worker's question on
 * the attempt that answer re-queued, labelled as one, and the task as filed
 * on every other attempt, with every steer sent into it since (FIX-2086). A
 * retry after a failure is handed the task again, never an answer. Shares its
 * invariant with `packWorkerInput`'s `answer` (orchestration `worker-step.ts`,
 * `answer-envelope.test.ts`). The answer's attempt is handed the steers too:
 * a steer sent while the task waited on its question is taken when it
 * resumes, and never answers the question.
 */
function taskTurnMessage(task: TaskWorkerInput): string {
  if (task.answer === undefined) return taskMessage(task);
  const steers = steersBrief(task);
  const answer = `Answer to your question:\n\n${task.answer}`;
  return steers === undefined ? answer : `${answer}\n\n${steers}`;
}


/**
 * The partition a task session's tasks are on: the conversation it was opened
 * for, as its board's hand-over named it at birth (a readonly field). The
 * conversation ledger's partition is that same value.
 */
export function filingPartitionOf(ctx: BlockContext): string | undefined {
  const filing = (ctx.session.state as Record<string, unknown>)[FILING_SESSION_STATE_KEY];
  return typeof filing === "string" ? filing : undefined;
}

/**
 * The task a task session was opened for, as its board's hand-over named it
 * at birth: readonly, and refused at create on any other path, so no caller
 * sets it. The session is keyed by this task and its worker, and the gate
 * admits only the row whose run link names this session, so it is one task.
 */
export function sessionTaskOf(ctx: BlockContext): string | undefined {
  const taskId = (ctx.session.state as Record<string, unknown>)[TASK_ID_STATE_KEY];
  return typeof taskId === "string" ? taskId : undefined;
}

/**
 * The flow the session that filed a task session's task runs on, as its
 * board's hand-over named it at birth (a readonly field): where the task's
 * notice goes.
 */
function filingFlowOf(ctx: BlockContext): string | undefined {
  const flow = (ctx.session.state as Record<string, unknown>)[FILING_FLOW_STATE_KEY];
  return typeof flow === "string" ? flow : undefined;
}

/**
 * The claim the gate verified for the task a `block` entry runs: the ledger
 * the row was read from, and its partition (a conversation's
 * `filingSessionId`; absent on an unpartitioned list). Server-supplied, from
 * the ticket the gate minted off the verified row, never from the dispatch or
 * the task's input.
 */
export interface WorkerTaskClaim {
  readonly collectionId: string;
  readonly partition?: string;
  /** The row's identity nonce as of the claim, when the row carries one. */
  readonly incarnationId?: string;
}

/** What a `block` entry's block is handed: the task as the board packed it, and the claim it runs under. */
export type WorkerTaskBlockInput = TaskWorkerInput & { readonly claim: WorkerTaskClaim };

/** What a flow's `work` entry is built from: a `turn` or a `block`, exactly one. */
export type WorkerTaskEntryOptions = {
  /** Names the entry's blocks. */
  readonly name: string;
} & (
  | {
      /** The flow's turn for one message: `{ message }` in, the answer out. The task's answer is its result. */
      readonly turn: BlockDefinition<any, any>;
      readonly block?: never;
    }
  | {
      /**
       * A block that takes the task itself ({@link WorkerTaskBlockInput}), for
       * a flow whose work isn't one message in and one answer out, such as a
       * coding run. Its output is the task's result.
       */
      readonly block: BlockDefinition<any, any>;
      readonly turn?: never;
    }
);

/**
 * The ledger resolver a `work` entry's gate uses for a conversation's board,
 * and the one a harness manager takes for boards it resolves per claim: the
 * conversation ledger at `partition`, at the running user's scope, and only
 * for the conversation the running task session was opened for. `undefined`
 * for any other ledger, a missing partition, or another conversation's.
 *
 * @param ledgerId The ledger the claim names.
 * @param ctx The running block's context. Its flow must declare the
 *   conversation ledger (`workerTaskEntry` installs it).
 * @param partition The partition the claim names.
 */
export async function conversationLedgers(
  ledgerId: string,
  ctx: BlockContext,
  partition: string | undefined
): Promise<TaskCollectionRef | undefined> {
  if (ledgerId !== CONVERSATION_LEDGER_ID) return undefined;
  // A task session works only the conversation it was opened for.
  if (partition === undefined || filingPartitionOf(ctx) !== partition) return undefined;
  return conversationLedgerAt(ctx, partition);
}

/**
 * The claim the gate put on its state, as a `block` entry hands it on. The
 * entry's block runs in the gate's step and declares no state of its own, so
 * the nearest stateful sequencer is the gate.
 */
function verifiedClaimOf(ctx: BlockContext, entry: string): WorkerTaskClaim {
  const ticket = ctx.sequencer?.state?.currentClaim as TaskClaimTicket | undefined;
  if (ticket === undefined) {
    throw new Error(`"${entry}" runs only behind its claim gate, and found no claim the gate verified.`);
  }
  return {
    collectionId: ticket.collectionId,
    ...(ticket.partition === undefined ? {} : { partition: ticket.partition }),
    ...(ticket.incarnationId === undefined ? {} : { incarnationId: ticket.incarnationId })
  };
}

/**
 * The board of the conversation a task session was opened for, and how to
 * run that board in the conversation: its run entry, on the flow that filed
 * the task. All three come from the session's readonly fields the hand-over
 * wrote at its birth, never from a request. `undefined` outside a
 * conversation's task session.
 *
 * For a host's door over a worker's runs: the row the session works is on
 * this board, and `filingSession` is the conversation that filed it.
 *
 * @param ctx The running block's context, in the task session. Its flow must
 *   declare the conversation ledger (`workerTaskEntry` installs it).
 */
export async function filingConversationBoard(
  ctx: BlockContext
): Promise<{ tasks: TaskCollectionRef; runEntry: string; filingFlow: string; filingSession: string } | undefined> {
  const partition = filingPartitionOf(ctx);
  const filingFlow = filingFlowOf(ctx);
  if (partition === undefined || filingFlow === undefined) return undefined;
  const tasks = await conversationLedgerAt(ctx, partition);
  return tasks === undefined
    ? undefined
    : { tasks, runEntry: RUN_BOARD_ENTRY, filingFlow, filingSession: sessionIdOfFiling(partition) };
}

/**
 * Build a worker flow's `work` task entry: spread it as
 * `task: { actions: { work: workerTaskEntry({ ... }) } }`.
 */
export function workerTaskEntry(options: WorkerTaskEntryOptions) {
  const { name } = options;
  if (options.turn !== undefined && options.block !== undefined) {
    throw new Error(`workerTaskEntry "${name}": give \`turn\` or \`block\`, not both.`);
  }
  if (options.turn === undefined && options.block === undefined) {
    throw new Error(`workerTaskEntry "${name}": give \`turn\` or \`block\`, the block that does the task's work.`);
  }

  // Marked, so the delegate check knows this entry takes a conversation's tasks.
  const from = markConversationTaskDoor(taskLedgers({
    name: `${name}-tasks`,
    resolve: conversationLedgers,
    uses: [defineCapability({ name: `${name}-ledgers`, resources: { ...conversationLedgerResources } })],
    // The turn keeps the worker's skill state on the session, the same shape
    // for every task, and each task runs in a session of its own.
    allowSessionState: true,
    // Its pieces, and a message for this session not yet acted on, hold it open (FIX-2077).
    endRules: conversationEndRules
  }));

  // A `block` is handed the task and the claim the gate verified; a `turn`,
  // the task's message. A task that filed pieces stays running when the turn
  // ends, and the turn their endings wake decides it (FIX-2077): the gate's
  // check at the end of each request for it.
  const base = sequencer({ name, inputSchema: taskWorkerInputSchema });
  const block =
    options.block !== undefined
      ? base.step(
          (task: TaskWorkerInput, ctx): WorkerTaskBlockInput => ({ ...task, claim: verifiedClaimOf(ctx as never, name) }),
          options.block
        )
      : base.step((task: TaskWorkerInput) => ({ message: taskTurnMessage(task) }), options.turn!);

  /**
   * The turn's message as the session's user item, so the task as filed (or
   * the answer that re-queued it) is part of the session's history: a later
   * turn in the session is handed what it was asked. The entry is reached
   * through the board's claim gate, so its input is the dispatch envelope and
   * the task is its payload.
   */
  const userMessage = (dispatch: TaskDispatchInput) => taskTurnMessage(dispatch.payload as TaskWorkerInput);

  return { block, from, userMessage, concurrency: REPLY_CONCURRENCY };
}
