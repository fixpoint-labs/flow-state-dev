/**
 * Waiting on a dispatched task: start a task and wait for its answer in the
 * same turn (FIX-1816; `dispatchTask({ wait: true })` since FIX-1875).
 *
 * The turn files one row on its conversation's board, or readies one it
 * recorded earlier, marked as waited-on, and parks on a wait gate. When the
 * row ends, whoever ends it, the same write leaves a resume-owed marker on it
 * ({@link resumeOwedWaits} replays it), and the turn resumes with the row's
 * output as the call's answer, or with an error naming how it ended. Nothing
 * holds a request open while it waits.
 *
 * The functions:
 *
 * - {@link dispatchAndWait}, the waiting call: refuses a second wait in one
 *   step, then runs the two halves below. It is the one entry
 *   `dispatchTask({ wait })` calls, for a new row and a recorded one.
 * - {@link fileWaitedRow}, the first half: files a new row, or readies a
 *   recorded one, once per tool call (under `ctx.runOnce`, keyed on the call,
 *   never the attempt), marked waited-on in the same write.
 * - {@link parkOnFiledRow}, the second half: returns at once when the row has
 *   already ended, and otherwise parks. When the gate resumes it with a
 *   timeout, it cancels its row. It clears the marker itself once it has the
 *   outcome, so a resume whose marker clear was lost to a crash is still
 *   settled.
 * - {@link resumeOwedWaits}, the waker: a touch of the board resumes every
 *   turn its rows are owed, through `ctx.requestHost.resumeWait`. It stops at
 *   once when no row owes one. Never called inside the waiting turn.
 *
 * The `wait` field is the task tools' (`../../skills/task-tools-capability.ts`):
 * the schema it appears in and the check on who may be assigned are theirs.
 * This module is the mechanism under them, and the notice entry that hears a
 * waited-on row end calls {@link resumeOwedWaits}.
 */
import {
  WaitEndedError,
  WaitStoppedError,
  parkOnWait,
  parseBlockInstanceId,
  recordedWaitOutcome,
  requireRequestHost
} from "@flow-state-dev/core";
import type { WaitOutcome, BlockContext } from "@flow-state-dev/core/types";
import { IllegalTaskTransitionError, isTerminalStatus } from "../schema/task-status";
import type { Task } from "../schema/task";
import type { TaskInit } from "../schema/task-init";
import type { TaskCollectionRef, TaskWriteOutcome } from "../collection/types";
// The one task-turn test (BR-5a). Reached by path, not through the task-board
// barrel, which imports this module's neighbours.
import { isTaskTurn } from "../../task-board/task-turn";

/** How long a wait stays open when its caller sets no `timeoutMs`: five minutes. */
export const DEFAULT_WAIT_TIMEOUT_MS = 5 * 60_000;

/** The shortest `timeoutMs` a wait takes: 30 seconds. */
export const MIN_WAIT_TIMEOUT_MS = 30_000;

/** The longest `timeoutMs` a wait takes: an hour. */
export const MAX_WAIT_TIMEOUT_MS = 60 * 60_000;

/**
 * The stem of the gate a waited-on row's turn parks on: the board and the row.
 * A filing adds its own nonce after `#`, so the gate names one filing; read
 * a row's gate from `row.wait.gateId`, never by rebuilding it.
 */
export function waitGateId(collectionId: string, taskId: string): string {
  return `ask:${collectionId}:${taskId}`;
}

/**
 * Whether the running turn's host can hold a wait (FIX-1816 BR-5): durable
 * execution (the wait resume is wired) and a durability sweeper that bounds
 * every wait (`RequestHost.hasWaitSweeper`). Read off the server's request
 * host, never from input.
 */
export function canHoldWait(ctx: { readonly requestHost?: BlockContext["requestHost"] }): boolean {
  const host = ctx.requestHost;
  return host?.resumeWait !== undefined && host.hasWaitSweeper === true;
}

/** What {@link dispatchAndWait} returns. */
export type DispatchAndWaitResult =
  | { readonly ok: true; readonly taskId: string; readonly answer: unknown }
  | {
      readonly ok: false;
      /**
       * - `wait_already_pending`: this step already waits on another wait. Nothing
       *   was filed.
       * - `wait_unavailable`: this turn, host or board cannot hold a wait (a
       *   task turn, no durable execution, or a board that keeps no resume
       *   marker). Nothing was filed.
       * - `wait_timeout_out_of_range`: `timeoutMs` is outside 30 seconds to an
       *   hour. Nothing was filed; it is never clamped.
       * - `task_not_dispatchable`: the recorded row named can't be dispatched
       *   (claimed, running, ended, already dispatched or already waited on).
       *   Nothing was written.
       * - `wait_timed_out`, `wait_task_failed`, `wait_task_cancelled`: the wait
       *   was filed and ended without an answer.
       */
      readonly error:
        | "task_not_dispatchable"
        | "wait_already_pending"
        | "wait_unavailable"
        | "wait_timeout_out_of_range"
        | "wait_timed_out"
        | "wait_task_failed"
        | "wait_task_cancelled"
        /** The person stopped the waiting turn; the turn ends, so no model reads this. */
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
export function toolCallOf(ctx: BlockContext): { logicalId: string; stepKey: string } | undefined {
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

/** How an ended row answers the turn that filed it. */
function outcomeOf(
  task: Pick<Task, "status" | "output" | "error">
): Exclude<WaitOutcome, { stopped: true }> {
  switch (task.status) {
    case "completed":
      return { answered: true, answer: task.output };
    case "cancelled":
      return {
        answered: false,
        error: { code: "wait_task_cancelled", message: "The waited-on task was cancelled." }
      };
    default:
      return {
        answered: false,
        error: {
          code: "wait_task_failed",
          message: `The waited-on task failed: ${task.error ?? "no reason given"}`
        }
      };
  }
}

/** How a wait is bounded. */
export interface DispatchAndWaitOptions {
  /**
   * How long to wait, from filing: {@link MIN_WAIT_TIMEOUT_MS} to
   * {@link MAX_WAIT_TIMEOUT_MS}, inclusive. {@link DEFAULT_WAIT_TIMEOUT_MS} when
   * unset. Outside the range the wait is refused before filing.
   */
  readonly timeoutMs?: number;
}

/**
 * A row recorded earlier, to dispatch and wait on instead of filing a new
 * one (FIX-1875). `assignee`, when set, is written in the same write.
 */
export interface DispatchRef {
  readonly taskId: string;
  readonly assignee?: string;
}

/** What a dispatch waits on: a new row's init, or a recorded row by id. */
export type DispatchTarget = Omit<TaskInit, "wait"> | DispatchRef;

/** The row a waiting call filed or readied, and the gate it parks on. */
export interface FiledWait {
  readonly taskId: string;
  readonly gateId: string;
  readonly deadline: number;
}

/**
 * Dispatch `target` on `collection` and wait for its answer: a new row
 * (`init`), or a recorded one (`{ taskId }`), readied in the write that marks
 * it waited-on.
 *
 * The caller has already run the board's own filing checks (who may be
 * assigned); this adds only what waiting needs. Must run as a block with a
 * stable call identity (a generator's tool), on a durable host, and never on
 * a task turn ({@link isTaskTurn}), so a wait is never started from inside a
 * waited-on task. Every refusal comes before anything is written.
 */
export async function dispatchAndWait(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  target: DispatchTarget,
  options: DispatchAndWaitOptions = {}
): Promise<DispatchAndWaitResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_WAIT_TIMEOUT_MS || timeoutMs > MAX_WAIT_TIMEOUT_MS) {
    return {
      ok: false,
      error: "wait_timeout_out_of_range",
      message:
        `timeoutMs must be from ${MIN_WAIT_TIMEOUT_MS} (30 seconds) to ${MAX_WAIT_TIMEOUT_MS} (an hour); ` +
        `${timeoutMs} is outside it. Nothing was filed.`
    };
  }
  if (isTaskTurn(ctx)) {
    return {
      ok: false,
      error: "wait_unavailable",
      message:
        "This turn is itself working a task, so it can't wait for another inside the turn. To wait for it, " +
        "file it without `wait`, then end this turn: when that task ends, its ending wakes this task in a " +
        "new turn, with the result. Nothing was filed."
    };
  }
  const call = toolCallOf(ctx);
  // A host that can't bound the wait (no durable execution, or no sweeper to
  // time it out) is refused, so no direct caller parks a turn forever.
  if (
    call === undefined ||
    ctx.runOnce === undefined ||
    ctx.suspend === undefined ||
    !canHoldWait(ctx) ||
    collection.clearResumeOwed === undefined ||
    ("taskId" in target && collection.dispatch === undefined)
  ) {
    return {
      ok: false,
      error: "wait_unavailable",
      message:
        "Waiting for a task's answer needs durable execution, a durability sweeper that times waits out, " +
        "and a board that keeps the wait. Nothing was filed."
    };
  }

  // One wait per step. The first call to claim the step holds it, durably, so
  // a replay after the resume re-reads the same holder.
  const holder = await ctx.runOnce(`fsd.ask.step:${call.stepKey}`, async () => call.logicalId);
  if (holder !== call.logicalId) {
    return {
      ok: false,
      error: "wait_already_pending",
      message: "This step already waits on another task. Wait again on a later step."
    };
  }

  const filed = await fileWaitedRow(ctx, collection, target, call.logicalId, timeoutMs);
  if ("refused" in filed) {
    return { ok: false, error: "task_not_dispatchable", taskId: filed.taskId, message: filed.refused };
  }
  const goal = "taskId" in target ? (collection.get(filed.taskId)?.goal ?? filed.taskId) : target.goal;
  return parkOnFiledRow(ctx, collection, filed, goal);
}

/**
 * The first half of a wait: file the row, or ready the recorded one, marked
 * waited-on, once per call (FIX-1875 split it out of the wait).
 *
 * One row per call. The filing is recorded under `fsd.ask.file`, keyed on the
 * call's logical id (which the replay shares; never on the attempt), in the
 * shape every version reads back: `{ taskId, gateId, deadline }`. A wait filed
 * by earlier code finds its filing there and goes no further (BP-030), and a
 * process still on earlier code, mid-rollout, reads a filing it knows. Inside
 * it, the row's ids are recorded first, in a step with no side effect, then
 * the row is written under that id unless it already is, so a crash between
 * the row's commit and the filing's record replays into the same row. The
 * deadline is counted from the row's write, and read back from the row on that
 * replay, never from ids a crash outlived.
 *
 * A recorded row is readied by `TaskCollectionRef.dispatch`, which refuses one
 * that isn't recorded, pending and unwaited. The refusal is recorded with the
 * call too, so a replay answers as the first call did.
 */
export async function fileWaitedRow(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  target: DispatchTarget,
  logicalId: string,
  timeoutMs: number
): Promise<FiledWait | { readonly refused: string; readonly taskId: string }> {
  if (ctx.runOnce === undefined) throw new Error("fileWaitedRow needs ctx.runOnce, which only a durable host provides.");
  // The goal check's control (ask-survives-a-restart, no-run-once) patches
  // this line and the plan's below by their text: keep both spellings.
  const filed = await ctx.runOnce(`fsd.ask.file:${logicalId}`, async () => {
    const planned = await ctx.runOnce!(`fsd.ask.plan:${logicalId}`, async () => {
      // A recorded row keeps its id, and so does a caller's own id (a
      // follow-up's `<root>-f<n>`, whose one insert is what keeps a session
      // to one task); otherwise one is minted, unique across processes. The
      // gate carries a nonce of this plan's, so a row is adopted only when
      // this very call filed or readied it.
      const taskId = "taskId" in target ? target.taskId : (target.id ?? `task_${crypto.randomUUID()}`);
      return { taskId, gateId: `${waitGateId(collection.collectionId, taskId)}#${crypto.randomUUID()}` };
    });
    const existing = collection.get(planned.taskId);
    if (existing?.wait != null && existing.wait.gateId === planned.gateId) {
      return { taskId: planned.taskId, gateId: planned.gateId, deadline: existing.wait.deadline };
    }
    const deadline = Date.now() + timeoutMs;
    if ("taskId" in target) {
      const outcome = await collection.dispatch!(planned.taskId, {
        call: logicalId,
        ...(target.assignee !== undefined ? { assignee: target.assignee } : {}),
        wait: { gateId: planned.gateId, deadline }
      });
      if (outcome.outcome === "declined") {
        return { refused: notDispatchableMessage(planned.taskId, outcome), taskId: planned.taskId };
      }
      return { taskId: planned.taskId, gateId: planned.gateId, deadline };
    }
    if (existing !== undefined) {
      // Another call's row under this id (a caller's id already taken), or,
      // for a minted id, a corrupt memo or a programming error: thrown, never
      // adopted, as the one insert under that id would refuse it.
      throw new Error(
        `Task "${planned.taskId}" already exists and isn't this wait's filing; it was not adopted. Nothing was filed.`
      );
    }
    await collection.addTask({ ...target, id: planned.taskId, wait: { gateId: planned.gateId, deadline } });
    return { taskId: planned.taskId, gateId: planned.gateId, deadline };
  });
  return filed;
}

/**
 * Why a recorded row can't be dispatched, in words a model can act on
 * (FIX-1875 BR-10). Shared by the waiting and the non-waiting dispatch.
 */
export function notDispatchableMessage(
  taskId: string,
  declined: Extract<TaskWriteOutcome, { outcome: "declined" }>
): string {
  const why =
    declined.reason === "already-dispatched"
      ? `it is ${declined.status} and was already dispatched, so it starts, or started, without another call`
      : declined.reason === "terminal"
        ? `it is ${declined.status}, which is terminal`
        : declined.reason === "follow-up"
          ? "it is a follow-up, which runs with the worker of the task it follows, so it keeps its assignee"
          : declined.reason === "awaiting-answer"
            ? "it was just answered and picks up again with its worker, so it keeps its assignee"
            : `it is ${declined.status}; only a recorded task that hasn't started and isn't waited on can be dispatched`;
  return `task "${taskId}" can't be dispatched: ${why}. Nothing was written.`;
}

/**
 * The second half of a wait: park the turn on the row {@link fileWaitedRow}
 * filed, or answer at once when the row has already ended.
 */
export async function parkOnFiledRow(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  filed: FiledWait,
  goal: string
): Promise<DispatchAndWaitResult> {
  // Never fails the call: the answer always comes back. A clear that fails
  // leaves the marker, and the next touch clears it, the gate already resolved.
  const clearMarker = async (): Promise<void> => {
    try {
      await collection.clearResumeOwed!(filed.taskId);
    } catch (error) {
      console.warn(
        `[orchestration] wait "${filed.taskId}": its resume-owed marker was left for the next touch: ${(error as Error).message}`
      );
    }
  };
  const park = {
    gateId: filed.gateId,
    binding: { board: collection.collectionId, taskId: filed.taskId },
    deadline: filed.deadline,
    message: `Waiting for the answer to "${goal}"`
  };

  /**
   * The person stopped the turn while it waited (BR-16): end the waited-on row,
   * clear what it owes, and end this turn `aborted`, with no further model
   * call. Safe to run again on a re-drive after a crash (BR-16c): a row that
   * already ended is left as it is. The turn ends even when that cleanup
   * fails: a marker left set is cleared by the next touch, and a cancel that
   * failed is owed on the row, for the next touch to pay (FIX-1844).
   */
  const endStopped = async (): Promise<DispatchAndWaitResult> => {
    try {
      await cancelOrOwe(collection, filed.taskId, "The waiting turn was stopped.");
      await clearMarker();
    } finally {
      await ctx.session?.stopRequest?.(ctx.request.identity.id);
    }
    return {
      ok: false,
      error: "wait_stopped",
      taskId: filed.taskId,
      message: "The waiting turn was stopped."
    };
  };

  // The row ended before the turn reached its park: answer now, no park. A
  // stop already recorded for this gate wins over that ending, so a re-drive
  // after a stop still ends the turn (BR-16c).
  // On a re-drive after a crash, the gate's recorded outcome is what ended
  // the wait, and it decides: a timeout stays a timeout unless the row ended on
  // its own (a late answer), and every other outcome is the one recorded.
  const row = collection.get(filed.taskId);
  if (row !== undefined && isTerminalStatus(row.status)) {
    const recorded = await recordedWaitOutcome(ctx, park);
    if (recorded !== undefined && "stopped" in recorded) return endStopped();
    await clearMarker();
    if (recorded === undefined) return answerOf(filed.taskId, outcomeOf(row));
    if (!recorded.answered && recorded.error.code === "wait_timed_out") {
      return endedInTime(row, filed.deadline) ? answerOf(filed.taskId, outcomeOf(row)) : answerOf(filed.taskId, recorded);
    }
    return answerOf(filed.taskId, recorded);
  }

  try {
    const answer = await parkOnWait(ctx, park);
    await clearMarker();
    return { ok: true, taskId: filed.taskId, answer };
  } catch (error) {
    if (error instanceof WaitStoppedError) return endStopped();
    // Anything else, the park itself among it, is not ours to handle.
    if (!(error instanceof WaitEndedError)) throw error;
    if (error.code === "wait_timed_out") {
      // The wait is over: end the row too, so its later ending is dropped.
      const cancelled = await cancelOrOwe(collection, filed.taskId, WAIT_TIMED_OUT_REASON);
      // Unless it had already ended on its own: one that ended after this call
      // read it open and before the gate was written found no gate to resume,
      // and nothing may have touched the board since. Its answer stands; it is
      // late, never later than the deadline, but not lost.
      // By its own ending time: one that ended after the deadline (the wait's
      // own timeout cancel among them) leaves the timeout standing.
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
 * Whether a timed-out wait's row ended on its own in time to answer instead,
 * by the row's own ending time: completed or failed at or before the wait's
 * deadline, or cancelled strictly before it (by someone else; the wait's own
 * timeout cancel lands at or after the deadline). A row with no ending time
 * leaves the timeout standing.
 */
function endedInTime(row: Pick<Task, "status" | "completedAt">, deadline: number): boolean {
  if (row.completedAt == null) return false;
  if (row.status === "completed" || row.status === "errored") return row.completedAt <= deadline;
  // A cancel strictly before the deadline was someone else's: the wait's own
  // timeout cancel lands at or after it.
  if (row.status === "cancelled") return row.completedAt < deadline;
  return false;
}

/** The reason a wait's own timeout cancels its row with. A record for people, never read back. */
const WAIT_TIMED_OUT_REASON = "The wait timed out before the task finished.";

/**
 * {@link cancelIfOpen} for a wait that is over, which never fails the turn
 * (FIX-1844): a cancel that throws is recorded on the row as owed
 * (`Task.cancelOwed`), and the next touch of the board pays it
 * ({@link resumeOwedWaits}). A mark that throws too leaves the row open.
 *
 * @returns Whether this call's cancel ended the row; `false` when it threw.
 */
async function cancelOrOwe(collection: TaskCollectionRef, taskId: string, reason: string): Promise<boolean> {
  try {
    return await cancelIfOpen(collection, taskId, reason);
  } catch (error) {
    try {
      if (collection.markCancelOwed === undefined) throw new Error("this board can't record a cancel as owed");
      await collection.markCancelOwed(taskId);
      console.warn(
        `[orchestration] wait "${taskId}": its cancel failed and is owed, for the next touch: ${(error as Error).message}`
      );
    } catch (markError) {
      console.warn(
        `[orchestration] wait "${taskId}": its cancel failed, and so did recording it as owed; the row stays open: ` +
          `${(error as Error).message}; ${(markError as Error).message}`
      );
    }
    return false;
  }
}

/**
 * Cancel the waited-on row unless it already ended. Idempotent: a replay after a
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

function answerOf(taskId: string, outcome: Exclude<WaitOutcome, { stopped: true }>): DispatchAndWaitResult {
  if (outcome.answered) return { ok: true, taskId, answer: outcome.answer };
  return { ok: false, error: outcome.error.code, taskId, message: outcome.error.message };
}

/** What {@link resumeOwedWaits} did, per row. */
export type ResumeOwedReport = {
  /** Rows whose turn was resumed by this touch. */
  readonly resumed: readonly string[];
  /** Rows still owed: the turn could not be resumed yet, and the next touch retries. */
  readonly stillOwed: readonly string[];
};

/** The reason a touch cancels a row whose wait is over with. A record for people, never read back. */
const WAIT_OVER_REASON = "The wait was over (stopped or timed out) before the task finished.";

/**
 * Resume every turn this board's rows are owed (the board touch).
 *
 * First it pays every cancel owed (`Task.cancelOwed`, FIX-1844): a row whose
 * wait is over and whose own cancel failed is cancelled now. That ending owes
 * no resume. A cancel that throws again stays owed for the next touch.
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
export async function resumeOwedWaits(
  ctx: BlockContext,
  collection: TaskCollectionRef
): Promise<ResumeOwedReport> {
  for (const row of collection.list({ cancelOwed: true })) {
    // Re-checked here: this loop cancels, so a board that ignores the filter must not cancel every open row.
    if (row.cancelOwed !== true) continue;
    try {
      await cancelIfOpen(collection, row.id, WAIT_OVER_REASON);
    } catch (error) {
      console.warn(`[orchestration] wait "${row.id}": its owed cancel failed and stays owed: ${(error as Error).message}`);
    }
  }
  const owed = collection.list({ resumeOwed: true });
  if (owed.length === 0) return { resumed: [], stillOwed: [] };
  const host = requireRequestHost(ctx);
  const resumed: string[] = [];
  const stillOwed: string[] = [];
  for (const row of owed) {
    if (row.wait == null || host.resumeWait === undefined || collection.clearResumeOwed === undefined) {
      stillOwed.push(row.id);
      continue;
    }
    let result: Awaited<ReturnType<NonNullable<typeof host.resumeWait>>>;
    try {
      result = await host.resumeWait({ gateId: row.wait.gateId, outcome: outcomeOf(row) });
    } catch (error) {
      // One row's failed resume stays owed for the next touch, and never
      // stops the rest of the touch: the other rows, or the notices a board
      // run sends after it.
      console.warn(`[orchestration] wait "${row.id}": its resume failed and stays owed: ${(error as Error).message}`);
      stillOwed.push(row.id);
      continue;
    }
    if (result.ok || result.refused === "already-resolved") {
      try {
        await collection.clearResumeOwed(row.id);
      } catch (error) {
        // The marker stays: the next touch finds the gate resolved and clears it.
        console.warn(
          `[orchestration] wait "${row.id}": resumed, but its resume-owed marker was left for the next touch: ${(error as Error).message}`
        );
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
