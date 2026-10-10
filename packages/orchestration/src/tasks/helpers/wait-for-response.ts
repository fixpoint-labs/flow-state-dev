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
 * `addTask`'s `waitForResponse` option is the task tools' (`../../skills/
 * task-tools-capability.ts`): the schema it appears in and the check on who
 * may be assigned are theirs. This module is the mechanism under them, and the
 * notice entry that hears an asked row end calls {@link resumeOwedAsks}.
 */
import {
  AskEndedError,
  AskStoppedError,
  parkOnAsk,
  parseBlockInstanceId,
  recordedAskOutcome,
  requireRequestHost
} from "@flow-state-dev/core";
import type { AskOutcome, BlockContext } from "@flow-state-dev/core/types";
import { IllegalTaskTransitionError, isTerminalStatus } from "../schema/task-status";
import type { Task } from "../schema/task";
import type { TaskInit } from "../schema/task-init";
import type { TaskCollectionRef } from "../collection/types";
// The one task-turn test (BR-5a). Reached by path, not through the task-board
// barrel, which imports this module's neighbours.
import { isTaskTurn } from "../../task-board/task-turn";

/** How long an ask stays open when its filer sets no `timeoutMs`: five minutes. */
export const DEFAULT_ASK_TIMEOUT_MS = 5 * 60_000;

/** The shortest `timeoutMs` an ask takes: 30 seconds. */
export const MIN_ASK_TIMEOUT_MS = 30_000;

/** The longest `timeoutMs` an ask takes: an hour. */
export const MAX_ASK_TIMEOUT_MS = 60 * 60_000;

/** The gate an asked row's turn parks on, derived from the row. */
export function askGateId(collectionId: string, taskId: string): string {
  return `ask:${collectionId}:${taskId}`;
}

/**
 * Whether the running turn's host can hold an ask (FIX-1816 BR-5): durable
 * execution (the ask resume is wired) and a durability sweeper that bounds
 * every ask (`RequestHost.hasAskSweeper`). Read off the server's request
 * host, never from input.
 */
export function canHoldAsk(ctx: { readonly requestHost?: BlockContext["requestHost"] }): boolean {
  const host = ctx.requestHost;
  return host?.resumeAsk !== undefined && host.hasAskSweeper === true;
}

/** What {@link addTaskAndWait} returns. */
export type WaitForResponseResult =
  | { readonly ok: true; readonly taskId: string; readonly answer: unknown }
  | {
      readonly ok: false;
      /**
       * - `wait_already_pending`: this step already waits on another ask. Nothing
       *   was filed.
       * - `wait_unavailable`: this turn, host or board cannot hold an ask (a
       *   task turn, no durable execution, or a board that keeps no resume
       *   marker). Nothing was filed.
       * - `wait_timeout_out_of_range`: `timeoutMs` is outside 30 seconds to an
       *   hour. Nothing was filed; it is never clamped.
       * - `wait_timed_out`, `wait_task_failed`, `wait_task_cancelled`: the ask
       *   was filed and ended without an answer.
       */
      readonly error:
        | "wait_already_pending"
        | "wait_unavailable"
        | "wait_timeout_out_of_range"
        | "wait_timed_out"
        | "wait_task_failed"
        | "wait_task_cancelled"
        /** The person stopped the asking turn; the turn ends, so no model reads this. */
        | "wait_stopped";
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
function outcomeOf(
  task: Pick<Task, "status" | "output" | "error">
): Exclude<AskOutcome, { stopped: true }> {
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

/** How an ask is bounded. */
export interface AddTaskAndWaitOptions {
  /**
   * How long to wait, from filing: {@link MIN_ASK_TIMEOUT_MS} to
   * {@link MAX_ASK_TIMEOUT_MS}, inclusive. {@link DEFAULT_ASK_TIMEOUT_MS} when
   * unset. Outside the range the ask is refused before filing.
   */
  readonly timeoutMs?: number;
}

/**
 * File `init` on `collection` as an ask and wait for its answer.
 *
 * The caller has already run the board's own filing checks (who may be
 * assigned); this adds only what waiting needs. Must run as a block with a
 * stable call identity (a generator's tool), on a durable host, and never on
 * a task turn ({@link isTaskTurn}), so an ask is never asked from inside an
 * ask. Every refusal comes before anything is filed.
 */
export async function addTaskAndWait(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  init: Omit<TaskInit, "id" | "ask">,
  options: AddTaskAndWaitOptions = {}
): Promise<WaitForResponseResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_ASK_TIMEOUT_MS || timeoutMs > MAX_ASK_TIMEOUT_MS) {
    return {
      ok: false,
      error: "wait_timeout_out_of_range",
      message:
        `timeoutMs must be from ${MIN_ASK_TIMEOUT_MS} (30 seconds) to ${MAX_ASK_TIMEOUT_MS} (an hour); ` +
        `${timeoutMs} is outside it. Nothing was filed.`
    };
  }
  if (isTaskTurn(ctx)) {
    return {
      ok: false,
      error: "wait_unavailable",
      message:
        "This turn is itself working a task, so it can't wait for another. File the task without " +
        "waitForResponse instead. Nothing was filed."
    };
  }
  const call = toolCallOf(ctx);
  // A host that can't bound the ask (no durable execution, or no sweeper to
  // time it out) is refused, so no direct caller parks a turn forever.
  if (
    call === undefined ||
    ctx.runOnce === undefined ||
    ctx.suspend === undefined ||
    !canHoldAsk(ctx) ||
    collection.clearResumeOwed === undefined
  ) {
    return {
      ok: false,
      error: "wait_unavailable",
      message:
        "Waiting for a task's answer needs durable execution, a durability sweeper that times asks out, " +
        "and a board that keeps the ask. Nothing was filed."
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

  // One row per call. The row's ids are recorded first, in a step with no
  // side effect, keyed on the call's logical id (which the replay shares;
  // never on the attempt). Then the row is filed under that id unless it
  // already is, so a replay after a crash between the row's commit and
  // anything after it finds the first filing instead of making a second.
  // An ask parked before that step existed recorded its whole filing under
  // `fsd.ask.file`; its replay reads that instead (BP-030). Reading it records
  // `null` there for an ask that never had one, which nothing else reads.
  const legacy = await ctx.runOnce<{ taskId: string; gateId: string } | null>(
    `fsd.ask.file:${call.logicalId}`,
    async () => null
  );
  const planned =
    legacy ??
    (await ctx.runOnce(`fsd.ask.plan:${call.logicalId}`, async () => {
      // Unique across processes: a row that already holds this id is this
      // ask's own filing, never another's that happened to mint the same id.
      const taskId = `task_${crypto.randomUUID()}`;
      return { taskId, gateId: askGateId(collection.collectionId, taskId) };
    }));
  // The deadline is the filing's: counted from when the row is written, and
  // read back from the row on a replay, never from a plan a crash outlived.
  const existing = collection.get(planned.taskId);
  if (existing !== undefined && existing.ask?.gateId !== planned.gateId) {
    throw new Error(
      `Task "${planned.taskId}" already exists and isn't this ask's filing; it was not adopted. Nothing was filed.`
    );
  }
  let deadline = existing?.ask?.deadline;
  if (deadline === undefined) {
    deadline = Date.now() + timeoutMs;
    await collection.addTask({ ...init, id: planned.taskId, ask: { gateId: planned.gateId, deadline } });
  }
  const filed = { taskId: planned.taskId, gateId: planned.gateId, deadline };

  // Never fails the call: the answer always comes back. A clear that fails
  // leaves the marker, and the next touch clears it, the gate already resolved.
  const clearMarker = async (): Promise<void> => {
    try {
      await collection.clearResumeOwed!(filed.taskId);
    } catch (error) {
      console.warn(
        `[orchestration] ask "${filed.taskId}": its resume-owed marker was left for the next touch: ${(error as Error).message}`
      );
    }
  };
  const park = {
    gateId: filed.gateId,
    binding: { board: collection.collectionId, taskId: filed.taskId },
    deadline: filed.deadline,
    message: `Waiting for the answer to "${init.goal}"`
  };

  /**
   * The person stopped the turn while it waited (BR-16): end the asked row,
   * clear what it owes, and end this turn `aborted`, with no further model
   * call. Safe to run again on a re-drive after a crash (BR-16c): a row that
   * already ended is left as it is. The turn ends even when that cleanup
   * fails: a marker left set is cleared by the next touch. A row left open
   * stays open; nothing on the board records that its asker stopped waiting.
   */
  const endStopped = async (): Promise<WaitForResponseResult> => {
    try {
      await cancelIfOpen(collection, filed.taskId, "The asking turn was stopped.");
      await clearMarker();
    } finally {
      await ctx.session?.stopRequest?.(ctx.request.identity.id);
    }
    return {
      ok: false,
      error: "wait_stopped",
      taskId: filed.taskId,
      message: "The asking turn was stopped."
    };
  };

  // The row ended before the turn reached its park: answer now, no park. A
  // stop already recorded for this gate wins over that ending, so a re-drive
  // after a stop still ends the turn (BR-16c).
  // On a re-drive after a crash, the gate's recorded outcome is what ended
  // the ask, and it decides: a timeout stays a timeout unless the row ended on
  // its own (a late answer), and every other outcome is the one recorded.
  const row = collection.get(filed.taskId);
  if (row !== undefined && isTerminalStatus(row.status)) {
    const recorded = await recordedAskOutcome(ctx, park);
    if (recorded !== undefined && "stopped" in recorded) return endStopped();
    await clearMarker();
    if (recorded === undefined) return answerOf(filed.taskId, outcomeOf(row));
    if (!recorded.answered && recorded.error.code === "wait_timed_out") {
      return endedInTime(row, filed.deadline) ? answerOf(filed.taskId, outcomeOf(row)) : answerOf(filed.taskId, recorded);
    }
    return answerOf(filed.taskId, recorded);
  }

  try {
    const answer = await parkOnAsk(ctx, park);
    await clearMarker();
    return { ok: true, taskId: filed.taskId, answer };
  } catch (error) {
    if (error instanceof AskStoppedError) return endStopped();
    // Anything else, the park itself among it, is not ours to handle.
    if (!(error instanceof AskEndedError)) throw error;
    if (error.code === "wait_timed_out") {
      // The ask is over: end the row too, so its later ending is dropped.
      const cancelled = await cancelIfOpen(collection, filed.taskId, ASK_TIMED_OUT_REASON);
      // Unless it had already ended on its own: one that ended after this call
      // read it open and before the gate was written found no gate to resume,
      // and nothing may have touched the board since. Its answer stands; it is
      // late, never later than the deadline, but not lost.
      // A row cancelled (by anyone) is not such an ending: the gate recorded a
      // timeout, and a timeout it stays.
      const ended = cancelled ? undefined : collection.get(filed.taskId);
      if (ended !== undefined && endedInTime(ended, filed.deadline)) {
        await clearMarker();
        return answerOf(filed.taskId, outcomeOf(ended));
      }
    }
    await clearMarker();
    return { ok: false, error: error.code, taskId: filed.taskId, message: error.message };
  }
}

/**
 * Whether a timed-out ask's row ended on its own in time to answer instead:
 * completed or failed (a cancel, by anyone, leaves the timeout standing), at
 * or before the ask's deadline by the row's own ending time. A row with no
 * ending time leaves the timeout standing too.
 */
function endedInTime(row: Pick<Task, "status" | "completedAt">, deadline: number): boolean {
  if (row.status !== "completed" && row.status !== "errored") return false;
  return row.completedAt != null && row.completedAt <= deadline;
}

/** The reason an ask's own timeout cancels its row with. A record for people, never read back. */
const ASK_TIMED_OUT_REASON = "The ask timed out before the task finished.";

/**
 * Cancel the asked row unless it already ended. Idempotent: a replay after a
 * crash cancels again harmlessly, and an ending that won a race stands.
 *
 * @returns Whether this call's cancel ended the row; `false` when the row had
 *   already ended (or is gone), by its own ending or an earlier cancel.
 */
async function cancelIfOpen(collection: TaskCollectionRef, taskId: string, reason: string): Promise<boolean> {
  const row = collection.get(taskId);
  if (row === undefined || isTerminalStatus(row.status)) return false;
  try {
    // A cancel that lost a race to the row's own ending declines (or, on a
    // custom ref, throws): only one the backing recorded is this call's.
    const outcome = await collection.cancel(taskId, reason);
    // A ref written before cancels reported an outcome resolves to nothing:
    // read the row to learn whether the cancel took or the row had ended.
    if (outcome == null) return collection.get(taskId)?.status === "cancelled";
    return outcome.outcome === "recorded";
  } catch (error) {
    // The row ended between the read and the write: its ending stands.
    if (!(error instanceof IllegalTaskTransitionError)) throw error;
    return false;
  }
}

function answerOf(taskId: string, outcome: Exclude<AskOutcome, { stopped: true }>): WaitForResponseResult {
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
 * already resolved. It stays when the resume or the clear throws (never
 * rethrown, so one row can't stop a touch), when the gate cannot be found (the turn has not
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
    let result: Awaited<ReturnType<NonNullable<typeof host.resumeAsk>>>;
    try {
      result = await host.resumeAsk({ gateId: row.ask.gateId, outcome: outcomeOf(row) });
    } catch {
      // One row's failed resume stays owed for the next touch, and never
      // stops the rest of the touch: the other rows, or the notices a board
      // run sends after it.
      stillOwed.push(row.id);
      continue;
    }
    if (result.ok || result.refused === "already-resolved") {
      try {
        await collection.clearResumeOwed(row.id);
      } catch {
        // The marker stays: the next touch finds the gate resolved and clears it.
        stillOwed.push(row.id);
        continue;
      }
      if (result.ok) resumed.push(row.id);
    } else {
      stillOwed.push(row.id);
    }
  }
  return { resumed, stillOwed };
}
