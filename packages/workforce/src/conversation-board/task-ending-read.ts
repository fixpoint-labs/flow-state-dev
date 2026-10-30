/**
 * A task's ending as the filer's model reads it (FIX-2345): a `getTask` call
 * and its result for that task, never a user turn.
 *
 * A turn a notice wakes (`./task-settled`), and a user's turn answering again
 * about what finished while it ran (`./take-finished`), each hear an ending
 * that is a teammate's result, not the user's words. Handed over as the
 * message, the model read it as something the user pasted, and read
 * orchestration's `noticeText`, whose output summary is cut at 500
 * characters. Here the ending is the read `getTask` returns for the row
 * (orchestration's `readTaskView`): the whole row, its output cut only past
 * `getTask`'s own limit and flagged when it is.
 *
 * - **{@link noteTaskEndingRead}** keeps the read in request state, before
 *   the turn runs.
 * - **{@link withTaskEndingReads}** is the built-in turn's `user` slot: the
 *   first model call of the request to read it takes the reads, as one
 *   assistant message calling `getTask` once per task and a tool result per
 *   call, before the message. A turn woken by the ending, whose message is the
 *   ending's line, reads the reads in its place. Taken once per generator
 *   call (by its idempotency key, so a retry of the same call reads them
 *   again), so a later answer in the request doesn't repeat them.
 *
 * Resolved for the model call and never stored as items: the visible line
 * under the delegate's name stays the short `noticeText` line, and a later
 * turn reads that line, or calls `getTask` itself. A turn of an app's own
 * that is no generator reading this slot gets the line as its message, as
 * before.
 */
import {
  buildAssistantToolCallMessage,
  buildToolResultMessage,
  toolResultOutputForModel
} from "@flow-state-dev/core/models";
import type { BlockContext, LLMMessage } from "@flow-state-dev/core/types";
import { readTaskView } from "@flow-state-dev/orchestration";
import type { Task, TaskCollectionRef, TaskNotice } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";

/** The tool the read is shown as a call of: the filer's own task read. */
const GET_TASK_TOOL = "getTask";

/** Request state: the endings this request's turn reads as `getTask` results, in the order they were heard. */
const TASK_ENDING_READS_STATE = "taskEndingReads";

const taskEndingReadSchema = z.object({
  callId: z.string(),
  taskId: z.string(),
  result: z.unknown(),
  /** The message this read stands in for: the ending's line, on a turn the ending woke. */
  standsFor: z.string().optional(),
  /** The model call that took it, by its idempotency key. */
  takenBy: z.string().optional()
});

type TaskEndingRead = z.infer<typeof taskEndingReadSchema>;

/** The request state the reads are kept in, for the `requestStateSchema` of a block that notes one. */
export const taskEndingReadsStateSchema = z.object({
  [TASK_ENDING_READS_STATE]: z.array(taskEndingReadSchema).optional()
});

function readsOf(ctx: BlockContext): TaskEndingRead[] {
  return ((ctx.request.state as Record<string, unknown> | undefined)?.[TASK_ENDING_READS_STATE] as TaskEndingRead[] | undefined) ?? [];
}

/**
 * Keep `notice`'s ending of `row` as the `getTask` read the running request's
 * turn is handed: `getTask`'s result for the row, read in full from `ref`,
 * with the dependents its ending cancelled. `standsFor` is the message the
 * read takes the place of, on a turn the ending woke.
 */
export async function noteTaskEndingRead(
  ctx: BlockContext,
  ref: TaskCollectionRef,
  row: Task,
  notice: TaskNotice,
  standsFor?: string
): Promise<void> {
  const cancelled = notice.cancelled ?? [];
  const read: TaskEndingRead = {
    // One call per ending: the attempt and the ending tell two of one task apart.
    callId: `task-ending-${notice.taskId}-${notice.attempt}-${notice.ending}`,
    taskId: notice.taskId,
    result: { ok: true, task: readTaskView(row, ref.list()), ...(cancelled.length > 0 ? { cancelled } : {}) },
    ...(standsFor !== undefined ? { standsFor } : {})
  };
  const kept = readsOf(ctx).filter((seen) => seen.callId !== read.callId);
  await ctx.request.patchState({ [TASK_ENDING_READS_STATE]: [...kept, read] } as never);
}

/**
 * The built-in turn's `user` slot: `message`, after the task endings this
 * request noted for its turn, as `getTask` calls and their results. Without
 * the message when the reads stand in for it. `message` alone when nothing
 * was noted, or a model call before this one took the reads.
 */
export async function withTaskEndingReads(message: string, ctx: BlockContext): Promise<string | LLMMessage[]> {
  const reads = readsOf(ctx);
  if (reads.length === 0) return message;
  const caller = ctx.idempotencyKey ?? "taken";
  const mine = reads.filter((read) => read.takenBy === undefined || read.takenBy === caller);
  if (mine.length === 0) return message;
  if (mine.some((read) => read.takenBy === undefined)) {
    await ctx.request.patchState({
      [TASK_ENDING_READS_STATE]: reads.map((read) => (read.takenBy === undefined ? { ...read, takenBy: caller } : read))
    } as never);
  }
  const calls = mine.map((read) => ({ toolCallId: read.callId, toolName: GET_TASK_TOOL, input: { id: read.taskId } }));
  const messages: LLMMessage[] = [
    buildAssistantToolCallMessage(calls),
    ...mine.map((read, i) => buildToolResultMessage(calls[i]!, toolResultOutputForModel(read.result)))
  ];
  const standsIn = mine.some((read) => read.standsFor === message);
  return standsIn || message.length === 0 ? messages : [...messages, { role: "user", content: message }];
}
