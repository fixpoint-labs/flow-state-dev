/**
 * Ask: file a task and wait for its answer in the same turn (FIX-1816).
 *
 * `addTask({ waitForResponse: true })` is a hand-off that waits. The turn files
 * one row on its conversation's board, marked as asked, and parks on an ask
 * gate. When the row ends, whoever ends it, the same write leaves a
 * resume-owed marker on it ({@link resumeOwedAsks} replays it), and the turn
 * resumes with the row's output as the call's answer, or with an error naming
 * how it ended. Nothing holds a request open while it waits.
 *
 * Two functions:
 *
 * - {@link addTaskAndWait}, the asking call: refuses a second wait in one step,
 *   files once per tool call (under `ctx.runOnce`, keyed on the call, never the
 *   attempt), returns at once when the row has already ended, and otherwise
 *   parks. When the gate resumes it with a timeout, it cancels its row. It
 *   clears the marker itself once it has the outcome, so a resume whose
 *   marker clear was lost to a crash is still settled.
 * - {@link resumeOwedAsks}, the waker: a touch of the board resumes every
 *   turn its rows are owed, through `ctx.requestHost.resumeAsk`. It stops at
 *   once when no row owes one. Never called inside the asking turn.
 *
 * Package-internal until FIX-1816 P3 wires it into `addTask` and the
 * child-finished notice; nothing re-exports it yet.
 *
 * `addTask`'s option, the schema it appears in and the check on who may ask
 * are the task tools' (FIX-1816 P3); this module is the mechanism under them.
 */
import { AskEndedError, parkOnAsk, parseBlockInstanceId, requireRequestHost } from "@flow-state-dev/core";
import type { AskOutcome, BlockContext } from "@flow-state-dev/core/types";
import { isTerminalStatus } from "../schema/task-status";
import type { Task } from "../schema/task";
import type { TaskInit } from "../schema/task-init";
import type { TaskCollectionRef } from "../collection/types";
import { generateId } from "../generate-id";

/** How long an ask may stay open before it times out: ten minutes, fixed. */
export const ASK_DEADLINE_MS = 10 * 60_000;

/** The gate an asked row's turn parks on, derived from the row. */
export function askGateId(collectionId: string, taskId: string): string {
  return `ask:${collectionId}:${taskId}`;
}

/** What {@link addTaskAndWait} returns. */
export type WaitForResponseResult =
  | { readonly ok: true; readonly taskId: string; readonly answer: unknown }
  | {
      readonly ok: false;
      /**
       * - `wait_already_pending`: this step already waits on another ask. Nothing
       *   was filed.
       * - `wait_unavailable`: this host or board cannot hold an ask (no durable
       *   execution, or a board that keeps no resume marker). Nothing was filed.
       * - `wait_timed_out`, `wait_task_failed`, `wait_task_cancelled`: the ask
       *   was filed and ended without an answer.
       */
      readonly error:
        | "wait_already_pending"
        | "wait_unavailable"
        | "wait_timed_out"
        | "wait_task_failed"
        | "wait_task_cancelled";
      readonly taskId?: string;
      readonly message?: string;
    };

/**
 * The tool call this block runs as: its logical id, and the step it belongs to.
 *
 * The logical id is the runtime's `ctx.idempotencyKey` (`${requestId}:${blockPath}`,
 * the same on every attempt and on the replay after a resume) when the context
 * carries it. A generator's tool call does not today (only `executeBlock`
 * stamps the key), so there it is derived from the block identity, to the same
 * value. The step key is derived from the block path.
 */
function toolCallOf(ctx: BlockContext): { logicalId: string; stepKey: string } | undefined {
  const instanceId = ctx._blockIdentity?.blockInstanceId;
  if (instanceId === undefined) return undefined;
  const parsed = parseBlockInstanceId(instanceId);
  if (parsed === undefined) return undefined;
  const logicalId = ctx.idempotencyKey ?? `${parsed.requestId}:${parsed.path}`;
  // A generator's tool runs at `<generator>/tool[<name>][<step>%3A<call>]`.
  // Calls in one step share the generator and the step number. Anything else
  // (a tool called outside a generator's loop) is its own step.
  const match = /^(.*)\/tool\[[^\]]*\]\[(\d+)%3A[^\]]*\]$/.exec(parsed.path);
  const stepKey = match === null ? logicalId : `${parsed.requestId}:${match[1]}:${match[2]}`;
  return { logicalId, stepKey };
}

/** How an ended row answers the turn that asked. */
function outcomeOf(task: Pick<Task, "status" | "output" | "error">): AskOutcome {
  switch (task.status) {
    case "completed":
      return { answered: true, answer: task.output };
    case "cancelled":
      return {
        answered: false,
        error: { code: "wait_task_cancelled", message: "The asked task was cancelled." }
      };
    default:
      return {
        answered: false,
        error: {
          code: "wait_task_failed",
          message: `The asked task failed: ${task.error ?? "no reason given"}`
        }
      };
  }
}

/**
 * File `init` on `collection` as an ask and wait for its answer.
 *
 * The caller has already run the board's own filing checks (who may be
 * assigned); this adds only what waiting needs. Must run as a block with a
 * stable call identity (a generator's tool), on a durable host.
 */
export async function addTaskAndWait(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  init: Omit<TaskInit, "id" | "ask">
): Promise<WaitForResponseResult> {
  const call = toolCallOf(ctx);
  const host = ctx.requestHost;
  if (
    call === undefined ||
    ctx.runOnce === undefined ||
    ctx.suspend === undefined ||
    host?.resumeAsk === undefined ||
    collection.clearResumeOwed === undefined
  ) {
    return {
      ok: false,
      error: "wait_unavailable",
      message: "Waiting for a task's answer needs durable execution and a board that keeps one."
    };
  }

  // One ask per step. The first call to claim the step holds it, durably, so a
  // replay after the resume re-reads the same holder.
  const holder = await ctx.runOnce(`fsd.ask.step:${call.stepKey}`, async () => call.logicalId);
  if (holder !== call.logicalId) {
    return {
      ok: false,
      error: "wait_already_pending",
      message: "This step already waits on another task. Ask again on a later step."
    };
  }

  // One row per call: the replay after the resume reaches this line again and
  // reads the first filing back. Keyed on the call's logical id, which the
  // replay shares; never on the attempt.
  const filed = await ctx.runOnce(`fsd.ask.file:${call.logicalId}`, async () => {
    const taskId = generateId("task");
    const gateId = askGateId(collection.collectionId, taskId);
    const deadline = Date.now() + ASK_DEADLINE_MS;
    await collection.addTask({ ...init, id: taskId, ask: { gateId, deadline } });
    return { taskId, gateId, deadline };
  });

  const clearMarker = (): Promise<unknown> => collection.clearResumeOwed!(filed.taskId);

  // The row ended before the turn reached its park: answer now, no park.
  const row = collection.get(filed.taskId);
  if (row !== undefined && isTerminalStatus(row.status)) {
    await clearMarker();
    return answerOf(filed.taskId, outcomeOf(row));
  }

  try {
    const answer = await parkOnAsk(ctx, {
      gateId: filed.gateId,
      binding: { board: collection.collectionId, taskId: filed.taskId },
      deadline: filed.deadline,
      message: `Waiting for the answer to "${init.goal}"`
    });
    await clearMarker();
    return { ok: true, taskId: filed.taskId, answer };
  } catch (error) {
    // Anything else, the park itself among it, is not ours to handle.
    if (!(error instanceof AskEndedError)) throw error;
    if (error.code === "wait_timed_out") {
      // The ask is over: end the row too, so its later ending is dropped.
      await collection.cancel(filed.taskId, "The ask timed out before the task finished.");
    }
    await clearMarker();
    return { ok: false, error: error.code, taskId: filed.taskId, message: error.message };
  }
}

function answerOf(taskId: string, outcome: AskOutcome): WaitForResponseResult {
  if (outcome.answered) return { ok: true, taskId, answer: outcome.answer };
  return { ok: false, error: outcome.error.code, taskId, message: outcome.error.message };
}

/** What {@link resumeOwedAsks} did, per row. */
export type ResumeOwedReport = {
  /** Rows whose turn was resumed by this touch. */
  readonly resumed: readonly string[];
  /** Rows still owed: the turn could not be resumed yet, and the next touch retries. */
  readonly stillOwed: readonly string[];
};

/**
 * Resume every turn this board's rows are owed (the board touch).
 *
 * Reads the owed rows with one filtered `list` over the board's loaded rows,
 * and stops at once when there are none. For each owed row it resumes the turn with the row's ending, through
 * the request host, which only reaches this conversation's own gates. The
 * marker clears when the resume is accepted, or refused because the gate was
 * already resolved. It stays when the gate cannot be found (the turn has not
 * parked yet, and clears it itself on reaching the ended row) or another
 * resume holds the turn (`busy`); the next touch tries again.
 */
export async function resumeOwedAsks(
  ctx: BlockContext,
  collection: TaskCollectionRef
): Promise<ResumeOwedReport> {
  const owed = collection.list({ resumeOwed: true });
  if (owed.length === 0) return { resumed: [], stillOwed: [] };
  const host = requireRequestHost(ctx);
  const resumed: string[] = [];
  const stillOwed: string[] = [];
  for (const row of owed) {
    if (row.ask == null || host.resumeAsk === undefined || collection.clearResumeOwed === undefined) {
      stillOwed.push(row.id);
      continue;
    }
    const result = await host.resumeAsk({ gateId: row.ask.gateId, outcome: outcomeOf(row) });
    if (result.ok || result.refused === "already-resolved") {
      await collection.clearResumeOwed(row.id);
      if (result.ok) resumed.push(row.id);
    } else {
      stillOwed.push(row.id);
    }
  }
  return { resumed, stillOwed };
}
