/**
 * The `work` task entry a worker flow takes tasks through (FIX-1794 S6): the
 * task as one turn of the worker, behind the claim gate, and the notice its
 * ending owes, sent to the conversation that filed it.
 *
 * - **Where it takes tasks from.** Any conversation's board, read off the
 *   conversation ledger at the partition the hand-over names, at the running
 *   user's scope only; and, on a kind that takes them, the mailbox task lists
 *   it names. Every check a board's gate runs (row, attempt, identity,
 *   status, assignee, lease, run link) runs on the ledger the hand-over names.
 *   A task session takes tasks only from the conversation it was opened for.
 * - **The ending.** The gate settles the row through the ledger, whose ending
 *   recorder marks the notice owed in that same write (orchestration's notice
 *   module).
 * - **The notice.** After the gate, on success or failure, each notice the
 *   session's task still owes (the task the hand-over named at the session's
 *   birth; a task session is one task) goes to the conversation that
 *   dispatched this request, its
 *   stamped sender (`{ from: true }`), never an address from the row or the
 *   task. Delivery clears the marker in the conversation. A refusal (the
 *   conversation is gone) clears it here and says so in this session; the
 *   task's ending stands. A thrown send, or any other refusal, leaves it owed
 *   for the conversation's next touch of its board. A conversation whose
 *   worker was fired accepts the send and then refuses to run it: the notice
 *   stays owed, and this session never hears of that refusal.
 */
import { defineCapability, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition, DispatchRefusal } from "@flow-state-dev/core/types";
import { taskLedgers, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { clearNotice, type TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { mailboxBoardLedger, resolveMailboxBoard } from "../mailbox/mailbox-board";
import { FILING_SESSION_STATE_KEY, TASK_ID_STATE_KEY } from "../workers/keys";
import { CONVERSATION_LEDGER_ID, conversationLedgerAt, conversationLedgerResources } from "./ledger";
import { sendOwedNotices } from "./notice-delivery";

/**
 * A task as a worker reads it: the title when there is one, the goal, the
 * task's context, and its structured input as JSON when it carries any.
 */
export function taskMessage(task: TaskWorkerInput): string {
  const lines = [task.title === undefined ? task.goal : `${task.title}\n\n${task.goal}`];
  if (task.context !== undefined && task.context.trim().length > 0) lines.push(`Context:\n${task.context}`);
  if (hasInput(task.input)) lines.push(`Input:\n${JSON.stringify(task.input, null, 2)}`);
  return lines.join("\n\n");
}

/** True for a task input worth showing: present, and not an empty object. */
function hasInput(input: unknown): boolean {
  if (input === undefined || input === null) return false;
  if (typeof input === "object" && !Array.isArray(input)) return Object.keys(input).length > 0;
  return true;
}

/**
 * The partition a task session's tasks are on: the conversation it was opened
 * for, as its board's hand-over named it at birth (a readonly field). The
 * conversation ledger's partition is that same value.
 */
function filingPartitionOf(ctx: BlockContext): string | undefined {
  const filing = (ctx.session.state as Record<string, unknown>)[FILING_SESSION_STATE_KEY];
  return typeof filing === "string" ? filing : undefined;
}

/**
 * The task a task session was opened for, as its board's hand-over named it
 * at birth: readonly, and refused at create on any other path, so no caller
 * sets it. The session is keyed by this task and its worker, and the gate
 * admits only the row whose run link names this session, so it is one task.
 */
function sessionTaskOf(ctx: BlockContext): string | undefined {
  const taskId = (ctx.session.state as Record<string, unknown>)[TASK_ID_STATE_KEY];
  return typeof taskId === "string" ? taskId : undefined;
}

/**
 * The refusals that say the conversation that filed a task can't be told,
 * now or later: its session is gone, or no longer this user's. Every other
 * refusal leaves the notice owed.
 */
const CONVERSATION_GONE: ReadonlySet<DispatchRefusal> = new Set(["session-not-found", "session-not-addressable"]);

/** What a flow's `work` entry is built from. */
export interface WorkerTaskEntryOptions {
  /** Names the entry's blocks. */
  readonly name: string;
  /** The flow's turn for one message: `{ message }` in, the answer out. The task's answer is its result. */
  readonly turn: BlockDefinition<any, any>;
  /**
   * The flow a filing conversation runs on, where a task's notice goes. A
   * conversation's board is kept by the coordinator's conversations.
   */
  readonly noticeFlow: string;
  /** Mailbox task lists the entry also takes tasks from, by minted id. */
  readonly mailboxLists?: readonly string[];
}

/**
 * Build a worker flow's `work` task entry: spread it as
 * `task: { actions: { work: workerTaskEntry({ ... }) } }`.
 */
export function workerTaskEntry(options: WorkerTaskEntryOptions) {
  const { name } = options;
  const lists = new Set(options.mailboxLists ?? []);
  const resources = {
    ...conversationLedgerResources,
    ...Object.fromEntries([...lists].map((id) => [id, mailboxBoardLedger(id)]))
  };

  const from = taskLedgers({
    name: `${name}-tasks`,
    resolve: async (ledgerId, ctx, partition) => {
      if (ledgerId === CONVERSATION_LEDGER_ID) {
        // A task session works only the conversation it was opened for.
        if (partition === undefined || filingPartitionOf(ctx) !== partition) return undefined;
        return conversationLedgerAt(ctx, partition);
      }
      return lists.has(ledgerId) && partition === undefined ? resolveMailboxBoard(ctx, ledgerId) : undefined;
    },
    uses: [defineCapability({ name: `${name}-ledgers`, resources })],
    // The turn keeps the worker's skill state on the session, the same shape
    // for every task, and each task runs in a session of its own.
    allowSessionState: true
  });

  const block = sequencer({ name, inputSchema: taskWorkerInputSchema }).step(
    (task: TaskWorkerInput) => ({ message: taskMessage(task) }),
    options.turn
  );

  /** Send what the session's task owes, to the conversation that filed it. */
  const tell = handler({
    name: `${name}-tell`,
    inputSchema: z.unknown(),
    outputSchema: z.object({ sent: z.number() }),
    resources: { ...conversationLedgerResources },
    execute: async (_input, ctx) => ({ sent: await tellFiler(ctx as never) })
  });

  const tellFiler = async (ctx: BlockContext): Promise<number> => {
    const taskId = sessionTaskOf(ctx);
    const partition = filingPartitionOf(ctx);
    // A task off a mailbox list owes no notice: its ledger records none, and
    // its session names no conversation.
    if (taskId === undefined || partition === undefined) return 0;
    const ref = await conversationLedgerAt(ctx, partition);
    const row = ref?.get(taskId);
    if (ref === undefined || row === undefined) return 0;
    const address = { session: { from: true }, flowKind: options.noticeFlow, from: `${name}-tell` } as const;
    return sendOwedNotices(ctx, row, address, async (notice, refusal) => {
      // Any other refusal (the host turned it away, the store was down) may
      // pass: the marker stays for the conversation's next touch.
      if (!CONVERSATION_GONE.has(refusal.refused)) return;
      // The conversation can't be told (it was deleted): the notice is
      // dropped and said here. The task's ending stands.
      await ref.patchMetadata(row.id, clearNotice(notice));
      ctx.emit.message(
        `The conversation that filed task "${row.title ?? row.goal}" couldn't be told it ${notice.ending}: ${refusal.detail}`
      );
    });
  };

  return { block, from, onCompleted: tell, onErrored: tell };
}
