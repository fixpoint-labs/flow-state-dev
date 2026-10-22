/**
 * Waiting on a task (FIX-1816; one wait since FIX-2082): a request waits on a
 * task already filed, until it ends or its deadline passes, whichever is first.
 *
 * Two ways in share this one function: `getTask({ id, wait: true })`, and a
 * plan board's drain waiting on a row it handed to another session. Both:
 *
 * 1. **Pass the same checks**, each before anything is written, each naming
 *    the rule: the host can hold a wait (durable execution, wakes, a sweeper);
 *    the deadline is within the host's bounds; this session filed the task
 *    (its server-written filer, never input, BP-031); its result doesn't go
 *    to the conversation; one wait per model step; and the chain of waits it
 *    joins stays within `MAX_WAIT_DEPTH`, counted by the engine from both ends.
 *    A task already ended is returned at once.
 * 2. **Take the row's wait slot** in one conditional write (`markWait`): a
 *    second request waiting on the same task is refused.
 * 3. **Park** on the one wait gate (`parkOnWait`), whose deadline the engine
 *    keeps as a wake. Nothing holds a request open while it waits, and a
 *    request working a task keeps its claim (FIX-2077's `waitingOn`).
 * 4. **Resume once**, with the ending the claim gate wrote (the filing
 *    session's pass resumes it, `payOwedResumes`), or at the deadline with the
 *    task still running. The deadline cancels nothing: the slot lapses, in one
 *    conditional write that loses to an ending already written, and an ending
 *    that lands while this request still runs is held for it, so its next read
 *    of the task delivers it. If it ends without that read, the ending goes to
 *    the filer's `onTaskSettled`, once (`releaseWait`, at the request's end).
 *
 * A person stopping a waiting request ends it and cancels the task it waited
 * on, as before. A request whose own task is cancelled while it waits ends at
 * its resume with no further model call.
 *
 * The functions:
 *
 * - {@link waitOnTask}, the wait.
 * - {@link waitRefusal}, its checks alone: a drain runs them before it hands
 *   a row over, so a wait it can't make refuses the row with nothing started.
 * - {@link deliverHeldEnding}, a read of a task that delivers an ending held
 *   for the reading request: every `getTask` calls it.
 * - {@link payOwedResumes}, the waker: the filer's pass resumes every request
 *   its rows are owed, through `ctx.requestHost.resumeWait`. Never called
 *   inside the waiting request.
 * - {@link replayLegacyDispatchWait}, the replay of a `dispatchTask({ wait })`
 *   call a request parked on before FIX-2082 (BP-030).
 */
import {
  MAX_WAIT_DEPTH,
  parkOnWait,
  parseBlockInstanceId,
  recordedWaitOutcome,
  requireRequestHost
} from "@flow-state-dev/core";
import { onRequestEnded } from "@flow-state-dev/core/types";
import type { BlockContext, WaitOutcome, WaitRow } from "@flow-state-dev/core/types";
import { IllegalTaskTransitionError, isTerminalStatus } from "../schema/task-status";
import type { Task } from "../schema/task";
import type { TaskCollectionRef } from "../collection/types";
import type { TaskClaimTicket } from "../claim-ticket";
import { resolveResourceCollection } from "../collection/resolve-resource-collection";
import { getOrCreateTaskCollection } from "../collection/get-or-create";
import { holdsAnEnding } from "../notice/task-notice";
// The running request's own task, as the claim and the gate know it. Reached by
// path, not through the task-board barrel, which imports this module.
import { currentWorkerClaim } from "../../task-board/flow-policy-wiring";
import { admittedTaskOf } from "../../task-board/task-request";
import { TASK_SESSION_TASK_KEY } from "../../task-board/task-turn";

/**
 * The stem of the gate a waiting request parks on: the board and the row. A
 * wait adds its own nonce after `#`, so the gate names one wait; read a row's
 * gate from `row.wait.gateId`, never by rebuilding it.
 */
export function waitGateId(collectionId: string, taskId: string): string {
  return `ask:${collectionId}:${taskId}`;
}

/**
 * Whether the running request's host can hold a wait (FIX-1816 BR-5, FIX-2082
 * D1): durable execution (the resume is wired), a durability sweeper that
 * resumes a wait at its deadline (`RequestHost.hasWaitSweeper`), and wakes
 * (`RequestHost.waits`, present only where they are kept). Read off the
 * server's request host, never from input.
 */
export function canHoldWait(ctx: { readonly requestHost?: BlockContext["requestHost"] }): boolean {
  const host = ctx.requestHost;
  return host?.resumeWait !== undefined && host.hasWaitSweeper === true && host.waits !== undefined;
}

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

/** Why a wait was refused, before anything was written. A model reads the message. */
export type TaskWaitRefusal =
  /** The host can't hold a wait: no durable execution, no wakes, or no sweeper. */
  | "wait_unavailable"
  /** The deadline is outside the host's bounds. It is never clamped. */
  | "wait_deadline_out_of_range"
  /** This session didn't file the task, or the row names no filer (filed before FIX-2078). */
  | "wait_not_filer"
  /** The task's result goes to the conversation, which hears it when it ends. */
  | "wait_on_conversation_result"
  /** This model step already waits on something. */
  | "wait_already_pending"
  /** Another request already waits on this task. */
  | "wait_taken"
  /** The chain of waits this one would join holds `MAX_WAIT_DEPTH` already. */
  | "wait_too_deep";

/** What {@link waitOnTask} came to. */
export type TaskWaitResult =
  /**
   * The task once it ended (`ended: true`), or as it stands at the deadline
   * (`ended: false`, still running). The caller returns it as `getTask` would.
   */
  | { readonly ok: true; readonly task: Task; readonly ended: boolean }
  | { readonly ok: false; readonly error: TaskWaitRefusal; readonly message: string }
  /**
   * The request is over: a person stopped it while it waited, or its own task
   * was cancelled. It ends with no further model call; nothing reads this.
   */
  | { readonly ok: false; readonly error: "wait_ended_the_request"; readonly message: string };

/** How one wait is made. */
export interface WaitOnTaskOptions {
  /** How long to wait, in ms from the call. The host's default when unset. */
  readonly deadlineMs?: number;
  /**
   * What this wait is recorded under with the request (`runOnce`): the same on
   * every replay of the call that waits. A tool call's logical id for
   * `getTask`; the row, its attempt and the round for a drain.
   */
  readonly key: string;
  /**
   * The model step this wait belongs to, for a model's tool call: one wait per
   * step. Omitted for a drain, which is no model step.
   */
  readonly step?: string;
  /**
   * At the deadline, take the slot again and go on waiting, rather than return
   * the task as it stands: a drain never moves past a running row (FIX-2082
   * D2). Each round is a check-in at the host's default deadline.
   */
  readonly waitAgain?: boolean;
  /** Shown wherever the parked request is listed. */
  readonly message?: string;
  /**
   * The waiting request is the board's own drain, waiting on a row it handed
   * to another session (FIX-2082 D2): it waits on any row it handed over, so
   * there is no filer check, and the request's own row is the task it works,
   * never the row its drain claimed.
   */
  readonly ownBoard?: true;
}

/** What the checks found, for the wait that passed them. */
type Checked = {
  readonly row: Task;
  readonly deadlineMs: number;
  readonly binding: WaitRow;
  readonly own: WaitRow | undefined;
};

/**
 * Run a wait's checks (see the module header) without waiting: the refusal,
 * or `undefined` when the wait may be made. The depth is recorded under
 * `options.key`, so the wait made after reads the same count. Writes nothing
 * else.
 */
export async function waitRefusal(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  taskId: string,
  options: WaitOnTaskOptions
): Promise<TaskWaitResult | undefined> {
  const checked = await check(ctx, collection, taskId, options);
  return "ok" in checked ? checked : undefined;
}

/**
 * Wait on `taskId` on `collection` until it ends or the deadline passes (see
 * the module header). Every refusal comes before anything is written. Must run
 * as a block with a stable identity on a durable host.
 */
export async function waitOnTask(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  taskId: string,
  options: WaitOnTaskOptions
): Promise<TaskWaitResult> {
  const checked = await check(ctx, collection, taskId, options);
  if ("ok" in checked) return checked;
  return waitChecked(ctx, collection, taskId, options, checked);
}

async function check(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  taskId: string,
  options: WaitOnTaskOptions
): Promise<TaskWaitResult | Checked> {
  // What the task says first: the most specific refusal names the rule.
  const row = collection.get(taskId);
  if (row === undefined) throw new Error(`[tasks] task "${taskId}" not found`);
  const filer = collection.filerOf?.(row) ?? row.filer?.sessionId;
  if (options.ownBoard !== true && (filer === undefined || filer !== ctx.session.identity.id)) {
    return refused(
      "wait_not_filer",
      `task "${taskId}" wasn't filed by this session, so this session can't wait on it: only the session that ` +
        "filed a task hears its ending. Nothing was written."
    );
  }
  if (row.resultTo === "conversation") {
    return refused(
      "wait_on_conversation_result",
      `task "${taskId}"'s result goes to the conversation, so no request waits on it: the conversation hears it ` +
        "when it ends. Nothing was written."
    );
  }

  const waits = ctx.requestHost?.waits;
  if (
    waits === undefined ||
    !canHoldWait(ctx) ||
    ctx.runOnce === undefined ||
    ctx.suspend === undefined ||
    collection.markWait === undefined ||
    collection.lapseWait === undefined ||
    collection.releaseWait === undefined ||
    collection.clearResumeOwed === undefined
  ) {
    return refused(
      "wait_unavailable",
      "waiting on a task needs durable execution, a store that keeps wakes, a durability sweeper that resumes waits " +
        "at their deadline, and a board that keeps the wait. Nothing was written."
    );
  }
  const { minMs, maxMs, defaultMs } = waits.deadlines;
  const deadlineMs = options.deadlineMs ?? defaultMs;
  if (!Number.isFinite(deadlineMs) || deadlineMs < minMs || deadlineMs > maxMs) {
    return refused(
      "wait_deadline_out_of_range",
      `deadline must be from ${minMs} to ${maxMs} ms; ${deadlineMs} is outside it. Nothing was written.`
    );
  }

  // One wait per model step. The first call to claim the step holds it,
  // durably, so a replay after the resume re-reads the same holder.
  if (options.step !== undefined) {
    const holder = await ctx.runOnce(`fsd.wait.step:${options.step}`, async () => options.key);
    if (holder !== options.key) {
      return refused("wait_already_pending", "this step already waits on something. Wait again on a later step.");
    }
  }

  const binding = { board: collection.collectionId, taskId };
  const own = ownRowOf(ctx, options.ownBoard === true);
  // Decided once and recorded, so the replay after the resume decides as the
  // first call did: the chain it counts has changed by then.
  const depth = await ctx.runOnce(`fsd.wait.depth:${options.key}`, () =>
    waits.depth({ binding, ...(own !== undefined ? { own } : {}) })
  );
  if (depth > MAX_WAIT_DEPTH) {
    return refused(
      "wait_too_deep",
      `waits nest at most ${MAX_WAIT_DEPTH} deep, and this one would make ${depth} in its chain (the waits on ` +
        "this request's own task above it, and the waits under the task it would wait on). Nothing was written."
    );
  }
  return { row, deadlineMs, binding, own };
}

/** The wait itself, once its checks passed. */
async function waitChecked(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  taskId: string,
  options: WaitOnTaskOptions,
  { row, deadlineMs, binding, own }: Checked
): Promise<TaskWaitResult> {
  const drain = options.ownBoard === true;
  for (let round = 0; ; round += 1) {
    const roundKey = round === 0 ? options.key : `${options.key}#${round}`;
    // The gate carries a nonce of this wait's own, so a resume names this
    // wait and no other, and its deadline is counted from the first call.
    const planned = await ctx.runOnce!(`fsd.wait.plan:${roundKey}`, async () => ({
      gateId: `${waitGateId(collection.collectionId, taskId)}#${crypto.randomUUID()}`,
      deadline: Date.now() + deadlineMs
    }));
    const park = {
      gateId: planned.gateId,
      binding,
      ...(own !== undefined ? { own } : {}),
      deadline: planned.deadline,
      message: options.message ?? `Waiting on "${row.title ?? row.goal}"`
    };
    const requestId = ctx.request.identity.id;
    const marked = await collection.markWait!(taskId, { gateId: planned.gateId, deadline: planned.deadline, requestId });
    if (marked.outcome === "declined" && marked.reason !== "terminal") {
      return refused(
        "wait_taken",
        `another request already waits on task "${taskId}": a task has one waiter at a time. Nothing was written.`
      );
    }
    if (marked.outcome === "declined") {
      // Ended before this request parked. A stop already recorded for this
      // gate still wins (a replay after a stop ends the request).
      const recorded = await recordedWaitOutcome(ctx, park);
      if (recorded !== undefined && "stopped" in recorded) return endStopped(ctx, collection, taskId);
      // The replay after a resume reaches here once the row has ended: the
      // request's own task may have ended first (a cancel that cascaded to it).
      if (await ownTaskEnded(ctx, drain)) return endQuietly(ctx, collection, taskId, "its own task ended while it waited");
      return ended(ctx, collection, taskId);
    }

    const outcome: WaitOutcome = await parkOnWait(ctx, park);
    if ("stopped" in outcome) return endStopped(ctx, collection, taskId);
    if (await ownTaskEnded(ctx, drain)) return endQuietly(ctx, collection, taskId, "its own task ended while it waited");
    // The ending, an error naming one, or (on a gate parked before FIX-2082,
    // replayed) the old timeout: read the row, whichever it was.
    if (!("deadline" in outcome) && !isLegacyTimeout(outcome)) return ended(ctx, collection, taskId);

    // The deadline. The slot lapses, unless the ending already won.
    const lapsed = await collection.lapseWait!(taskId, planned.gateId, requestId);
    if (lapsed.outcome === "declined") return ended(ctx, collection, taskId);
    if (options.waitAgain === true) continue;
    releaseAtRequestEnd(ctx, collection, taskId);
    return { ok: true, task: collection.get(taskId) ?? row, ended: false };
  }
}

function refused(error: TaskWaitRefusal, message: string): TaskWaitResult {
  return { ok: false, error, message };
}

function isLegacyTimeout(outcome: WaitOutcome): boolean {
  return "error" in outcome && outcome.error.code === "wait_timed_out";
}

/**
 * The row the running request works, when it works one: the claim an inline
 * worker or the gate holds, the task it was admitted for, or the task its
 * session was opened for. Server-set, never input: the engine's depth count
 * reads it to find what waits on this request's own work.
 */
function ownRowOf(ctx: BlockContext, drain = false): WaitRow | undefined {
  // A drain's claim is the row it waits on, not the work its request does.
  const claim = drain ? undefined : currentWorkerClaim(ctx);
  if (claim !== undefined) return { board: claim.collectionId, taskId: claim.taskId };
  const admitted = admittedTaskOf(ctx);
  if (admitted !== undefined) return { board: admitted.ref.collectionId, taskId: admitted.taskId };
  const sessionTask = (ctx.session?.state as Record<string, unknown> | undefined)?.[TASK_SESSION_TASK_KEY];
  return typeof sessionTask === "string" ? { board: "", taskId: sessionTask } : undefined;
}

/**
 * Whether the task the running request works has ended: a cancel while it
 * waited. Read as committed, not as this request first read it: the cancel
 * was another request's write. The task is the one the request was admitted
 * for in this process, or, on the request resumed after its park (whose
 * admission was its first run's), the claim its gate left on the state. A
 * drain's claim is the row it waits on, not its own task, so a drain reads
 * only the task it was admitted for.
 */
async function ownTaskEnded(ctx: BlockContext, drain: boolean): Promise<boolean> {
  const admitted = admittedTaskOf(ctx);
  if (admitted !== undefined) {
    await admitted.ref.refresh?.(admitted.taskId);
    const row = admitted.ref.get(admitted.taskId);
    return row !== undefined && isTerminalStatus(row.status);
  }
  if (drain) return false;
  const ticket = (ctx.sequencer?.state as { currentClaim?: TaskClaimTicket } | undefined)?.currentClaim ?? currentWorkerClaim(ctx);
  if (ticket === undefined) return false;
  const collection = claimBoardOf(ctx, ticket.collectionId);
  if (collection === undefined) return false;
  const ref = await getOrCreateTaskCollection({
    ctx,
    backing: "resource",
    collectionId: ticket.collectionId,
    collection,
    ...(ticket.partition !== undefined ? { partition: ticket.partition } : {})
  });
  await ref.refresh?.(ticket.taskId);
  const row = ref.get(ticket.taskId);
  return row !== undefined && isTerminalStatus(row.status);
}

/**
 * The claim's board, when this flow declares it. The resource registry throws
 * on a key it doesn't hold, and a claim on a board this request can't read
 * has no ending for it to act on.
 */
function claimBoardOf(ctx: BlockContext, collectionId: string) {
  try {
    return resolveResourceCollection(ctx, collectionId);
  } catch {
    return undefined;
  }
}

/** The waited-on row ended: clear what it owes the resume, and return it. */
async function ended(ctx: BlockContext, collection: TaskCollectionRef, taskId: string): Promise<TaskWaitResult> {
  await clearMarker(collection, taskId);
  const task = collection.get(taskId)!;
  await deliverHeldEnding(ctx, collection, task);
  return { ok: true, task: collection.get(taskId) ?? task, ended: true };
}

/**
 * Clear the row's resume-owed marker. Never fails the call: a clear that fails
 * leaves the marker, and the next touch clears it, the gate already resolved.
 */
async function clearMarker(collection: TaskCollectionRef, taskId: string): Promise<void> {
  try {
    await collection.clearResumeOwed!(taskId);
  } catch (error) {
    console.warn(
      `[orchestration] wait "${taskId}": its resume-owed marker was left for the next touch: ${(error as Error).message}`
    );
  }
}

/**
 * A person stopped the request while it waited (BR-16): end the waited-on
 * row, clear what it owes, and end this request `aborted`, with no further
 * model call. Safe to run again on a re-drive after a crash (BR-16c): a row
 * that already ended is left as it is. The request ends even when that
 * cleanup fails: a marker left set is cleared by the next touch, and a cancel
 * that failed is owed on the row, for the next touch to pay (FIX-1844).
 */
async function endStopped(ctx: BlockContext, collection: TaskCollectionRef, taskId: string): Promise<TaskWaitResult> {
  try {
    await cancelOrOwe(collection, taskId, "The waiting request was stopped.");
    await clearMarker(collection, taskId);
  } finally {
    await ctx.session?.stopRequest?.(ctx.request.identity.id);
  }
  return { ok: false, error: "wait_ended_the_request", message: "The waiting request was stopped." };
}

/**
 * The request's own task was cancelled while it waited (FIX-2082): the wait is
 * over and so is the request. It ends `aborted` with no further model call;
 * the claim gate refuses whatever it would have written, and its return is
 * never recorded. The waited-on task is the cancel's to cascade, not this.
 */
async function endQuietly(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  taskId: string,
  why: string
): Promise<TaskWaitResult> {
  await clearMarker(collection, taskId);
  await ctx.session?.stopRequest?.(ctx.request.identity.id);
  return { ok: false, error: "wait_ended_the_request", message: `The waiting request ended: ${why}.` };
}

/** The tasks each running request lapsed a wait on, released at its end. */
const lapsedByRequest = new Map<string, Map<string, TaskCollectionRef>>();

/**
 * Release this request's lapsed slot on `taskId` when the request ends (on
 * any end, a suspension included: a request parked on something else is not
 * running to read the row). An ending held for it and never read then goes to
 * the filer's notice, once.
 */
function releaseAtRequestEnd(ctx: BlockContext, collection: TaskCollectionRef, taskId: string): void {
  const requestId = ctx.request.identity.id;
  let tasks = lapsedByRequest.get(requestId);
  if (tasks === undefined) {
    tasks = new Map();
    lapsedByRequest.set(requestId, tasks);
    const owned = tasks;
    const registered = onRequestEnded(ctx, async () => {
      if (lapsedByRequest.get(requestId) === owned) lapsedByRequest.delete(requestId);
      for (const [id, ref] of owned) {
        try {
          await ref.releaseWait?.(id, { requestId, read: false });
        } catch (error) {
          console.warn(
            `[orchestration] wait "${id}": its lapsed slot was not released at the request's end: ${(error as Error).message}`
          );
        }
      }
    });
    if (!registered) lapsedByRequest.delete(requestId);
  }
  tasks.set(taskId, collection);
}

/**
 * A read of `task` by the running request delivers an ending held for it
 * (FIX-2082): the request's wait on the task lapsed at its deadline, the task
 * ended while the request still ran, and this read is that request's. The held
 * notice is dropped and the slot released, so the filer's `onTaskSettled` is
 * never told. A no-op for any other read.
 */
export async function deliverHeldEnding(ctx: BlockContext, collection: TaskCollectionRef, task: Task): Promise<void> {
  const requestId = ctx.request?.identity?.id;
  if (requestId === undefined || task.wait?.lapsed !== true || task.wait.requestId !== requestId) return;
  if (!isTerminalStatus(task.status) && !holdsAnEnding(task)) return;
  await collection.releaseWait?.(task.id, { requestId, read: true });
  lapsedByRequest.get(requestId)?.delete(task.id);
}

/**
 * {@link cancelIfOpen} for a wait that is over, which never fails the request
 * (FIX-1844): a cancel that throws is recorded on the row as owed
 * (`Task.cancelOwed`), and the next touch of the board pays it
 * ({@link payOwedResumes}, in the pass). A mark that throws too leaves the row open.
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

/** How an ended row resumes the request parked on it. */
function outcomeOf(task: Pick<Task, "status" | "output" | "error">): Exclude<WaitOutcome, { stopped: true }> {
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

/** What {@link payOwedResumes} did, per row. */
export type ResumeOwedReport = {
  /** Rows whose waiting request was resumed by this touch. */
  readonly resumed: readonly string[];
  /** Rows still owed: the request could not be resumed yet, and the next touch retries. */
  readonly stillOwed: readonly string[];
};

/** The reason a touch cancels a row whose wait was stopped with. A record for people, never read back. */
const WAIT_OVER_REASON = "The waiting request was stopped before the task finished.";

/**
 * Resume every request this board's rows are owed (the board touch).
 *
 * First it pays every cancel owed (`Task.cancelOwed`, FIX-1844): a row whose
 * waiting request was stopped and whose cancel failed is cancelled now. That
 * ending owes no resume. A cancel that throws again stays owed for the next
 * touch.
 *
 * Reads the owed rows with one filtered `list` over the board's loaded rows,
 * and stops at once when there are none. For each owed row it resumes the
 * request with the row's ending, through the request host, which only reaches
 * this session's own gates. The marker clears when the resume is accepted, or
 * refused because the gate was already resolved. It stays when the resume or
 * the clear throws (never rethrown, so one row can't stop a touch), when the
 * gate cannot be found (the request has not parked yet, and clears it itself
 * on reaching the ended row) or another resume holds the request (`busy`); the
 * next touch tries again.
 */
export async function payOwedResumes(ctx: BlockContext, collection: TaskCollectionRef): Promise<ResumeOwedReport> {
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

/**
 * The replay of a `dispatchTask({ wait: true })` call a request parked on
 * before FIX-2082 (BP-030), or `undefined` when this call recorded no such
 * filing (a new call, which the caller refuses).
 *
 * The filing it recorded (`fsd.ask.file`, keyed on the call) names the gate it
 * parked on and its deadline. The request parks on that gate again, which
 * gives back the outcome recorded there, and answers in the shape that call
 * answered: `answer` for a completion, an error naming any other ending. Its
 * timeout cancels nothing: the slot lapses, as any wait's does at its deadline.
 */
export async function replayLegacyDispatchWait(
  ctx: BlockContext,
  collection: TaskCollectionRef
): Promise<
  | { readonly ok: true; readonly taskId: string; readonly answer: unknown }
  | { readonly ok: false; readonly error: string; readonly taskId: string }
  | undefined
> {
  const call = toolCallOf(ctx);
  if (call === undefined || ctx.runOnce === undefined || ctx.suspend === undefined) return undefined;
  // A new call records nothing here, and is refused by its caller; a replay
  // reads the filing the call made before the upgrade.
  const filed = await ctx.runOnce<{ taskId: string; gateId: string; deadline: number } | null>(
    `fsd.ask.file:${call.logicalId}`,
    async () => null
  );
  if (filed === null) return undefined;
  const outcome = await parkOnWait(ctx, {
    gateId: filed.gateId,
    binding: { board: collection.collectionId, taskId: filed.taskId },
    deadline: filed.deadline
  });
  if ("stopped" in outcome) {
    await endStopped(ctx, collection, filed.taskId);
    return { ok: false, error: "wait_stopped", taskId: filed.taskId };
  }
  await clearMarker(collection, filed.taskId);
  if (outcome.answered) return { ok: true, taskId: filed.taskId, answer: outcome.answer };
  if ("deadline" in outcome || isLegacyTimeout(outcome)) {
    const lapsed = await collection.lapseWait?.(filed.taskId, filed.gateId, ctx.request.identity.id);
    const row = collection.get(filed.taskId);
    if (lapsed?.outcome === "declined" && row !== undefined && row.status === "completed") {
      return { ok: true, taskId: filed.taskId, answer: row.output };
    }
    if (lapsed?.outcome !== "declined") releaseAtRequestEnd(ctx, collection, filed.taskId);
    return { ok: false, error: "wait_timed_out: the task was still running at the wait's deadline; it runs on", taskId: filed.taskId };
  }
  return { ok: false, error: `${outcome.error.code}: ${outcome.error.message}`, taskId: filed.taskId };
}
