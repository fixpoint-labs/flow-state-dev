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
 *    to the conversation; it isn't a step a plan's drain handed over and
 *    waits on (the mark the drain's own wait writes on the slot, which
 *    stays while the slot is lapsed); one wait per model step; and the chain of waits it
 *    joins stays within `MAX_WAIT_DEPTH`: the waits above this request and
 *    any already below the task it waits on, counted by the engine. A wait
 *    that waits again at its deadline counts again before each new park,
 *    except a drain on a row it handed over, whose wait already exists.
 *    A task already ended is returned at once, and the notice its ending
 *    owes the filer is dropped: this answer delivered it (FIX-2112). Unless
 *    `onTaskSettled` has already taken that notice (FIX-2123): then the notice
 *    is the delivery, and the answer says the ending arrives as one.
 * 2. **Take the row's wait slot** in one conditional write (`markWait`): a
 *    second request waiting on the same task is refused.
 * 3. **Park** on the one wait gate (`parkOnWait`), whose deadline the engine
 *    keeps as a wake. Nothing holds a request open while it waits, and a
 *    request working a task keeps its claim (FIX-2077's `keptOpenBy`).
 * 4. **Resume once**, with the ending the claim gate wrote (the filing
 *    session's pass resumes it, `payOwedResumes`), or at the deadline with the
 *    task still running. The deadline cancels nothing: the slot lapses, in one
 *    conditional write that loses to an ending already written, and an ending
 *    that lands while this request still runs is held for it, so its next
 *    read of the task delivers it. Once it parks (on a person or another
 *    wait) or ends without that read, the ending goes to the filer's
 *    `onTaskSettled`, once (`releaseWait`): at a park, by the filer's pass,
 *    which the park owes a wake (FIX-2170); at its end, in this process; and,
 *    whatever became of the process, by the filer's next pass, which the
 *    lapse owes a wake (`releaseEndedWaits`). A wait on the task after the
 *    resume then answers that its ending arrives as a notice while that
 *    notice is being delivered, and with the task once it has been (FIX-2181).
 *
 * A person stopping a waiting request ends it and cancels the task it waited
 * on, as before. A request whose own task is cancelled while it waits ends at
 * its resume with no further model call.
 *
 * The functions:
 *
 * - {@link waitOnTask}, the wait.
 * - {@link checkWait}, its checks alone: a drain runs them before it hands
 *   a row over, so a wait it can't make refuses the row with nothing started,
 *   then hands what passed to {@link waitOnTask}, which doesn't check again.
 * - {@link deliverHeldEnding}, a read of a task that delivers an ending held
 *   for the reading request: every `getTask` calls it.
 * - {@link payOwedResumes}, the waker: the filer's pass resumes every request
 *   its rows are owed, through `ctx.requestHost.resumeWait`. Never called
 *   inside the waiting request.
 */
import { owesUserResume, payOwedUserResume } from "./user-stop";
import {
  canHoldWait,
  logicalBlockIdOf,
  MAX_WAIT_DEPTH,
  parkOnWait,
  parseBlockInstanceId,
  recordedWaitOutcome,
  requireRequestHost
} from "@flow-state-dev/core";
import { onRequestEnded } from "@flow-state-dev/core/types";
import type { BlockContext, WaitGateBinding, WaitOutcome, WaitRow } from "@flow-state-dev/core/types";
import { IllegalTaskTransitionError, isTerminalStatus } from "../schema/task-status";
import type { Task } from "../schema/task";
import type { TaskCollectionRef } from "../collection/types";
import type { TaskClaimTicket } from "../claim-ticket";
import { resolveResourceCollection } from "../collection/resolve-resource-collection";
import { getOrCreateTaskCollection } from "../collection/get-or-create";
import { deliveredByWait, holdsAnEnding, LAPSED_SLOT_CHECK_CAP_MS, LAPSED_SLOT_CHECK_MS, noticeTakenByAnother } from "../notice/task-notice";
// The running request's own task, as the claim and the gate know it. Reached by
// path, not through the task-board barrel, which imports this module.
import { currentWorkerClaim } from "../../task-board/flow-policy-wiring";
import { hasEnded, requestStates } from "./request-states";
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

/** Whether the running request's host can hold a wait: core's check, re-exported where the board's wait lives. */
export { canHoldWait };

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
  const parsed = instanceId === undefined ? undefined : parseBlockInstanceId(instanceId);
  const logicalId = logicalBlockIdOf(ctx);
  // No identity that parses: not a tool call this can key, and the caller refuses the wait.
  if (parsed === undefined || logicalId === undefined) return undefined;
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
  /** A plan's drain handed this task over and waits on it, holding its slot or lapsed at a deadline. */
  | "wait_on_plan_step"
  /** The chain of waits this one would join holds `MAX_WAIT_DEPTH` already. */
  | "wait_too_deep";

/** What {@link waitOnTask} came to. */
export type TaskWaitResult =
  /**
   * The task once it ended (`ended: true`), or as it stands at the deadline
   * (`ended: false`, still running). The caller returns it as `getTask` would,
   * except with `arrivesAsNotice` (FIX-2123): the filer's `onTaskSettled`
   * had already taken the ending's notice, which is the filer's one hearing of
   * it, so the caller answers {@link arrivesAsNoticeAnswer} instead.
   */
  | {
      readonly ok: true;
      readonly task: Task;
      readonly ended: boolean;
      readonly arrivesAsNotice?: true;
      /** This answer is the filer's one hearing of the ending, in place of its notice (FIX-2138). */
      readonly delivered?: true;
    }
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
   * D2). Each round is a check-in at the host's default deadline, and counts
   * the chain again before it parks, unless `ownBoard` is set.
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

/** A wait that passed its checks ({@link checkWait}): hand it to {@link waitOnTask} to make it. */
export interface CheckedWait {
  readonly taskId: string;
  readonly key: string;
  readonly row: Task;
  readonly deadlineMs: number;
  readonly binding: WaitRow;
  readonly own: WaitRow | undefined;
}

/**
 * Run a wait's checks (see the module header) without waiting: the refusal,
 * or the wait that passed them. The depth and the request's own row are
 * recorded under `options.key`, so a replay decides the same way. Writes
 * nothing else.
 */
export async function checkWait(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  taskId: string,
  options: WaitOnTaskOptions
): Promise<Extract<TaskWaitResult, { ok: false }> | CheckedWait> {
  return check(ctx, collection, taskId, options);
}

/**
 * Wait on `taskId` on `collection` until it ends or the deadline passes (see
 * the module header). Every refusal comes before anything is written. Must run
 * as a block with a stable identity on a durable host.
 *
 * @param checked What {@link checkWait} returned for this same task and key,
 *   when the caller checked first: the checks don't run again.
 */
export async function waitOnTask(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  taskId: string,
  options: WaitOnTaskOptions,
  checked?: CheckedWait
): Promise<TaskWaitResult> {
  if (checked !== undefined && (checked.taskId !== taskId || checked.key !== options.key)) {
    throw new Error(`[tasks] the checked wait is on task "${checked.taskId}" under "${checked.key}", not this one`);
  }
  // A run after a park: the slots this request lapsed before it are released at its end again.
  rearmLapsed(ctx);
  const passed = checked ?? (await check(ctx, collection, taskId, options));
  if ("ok" in passed) return passed;
  return waitChecked(ctx, collection, taskId, options, passed);
}

async function check(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  taskId: string,
  options: WaitOnTaskOptions
): Promise<Extract<TaskWaitResult, { ok: false }> | CheckedWait> {
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
  // A step a plan's drain handed over and waits on. Read off the slot, which
  // keeps the mark while it is lapsed: a wait that took it then would leave
  // the drain nothing to wait with, and fail the plan.
  if (options.ownBoard !== true && row.wait?.drain === true && !isTerminalStatus(row.status)) {
    return refused(
      "wait_on_plan_step",
      `task "${taskId}" is a step of a plan, and the plan's own run waits on it: a task has one waiter at a ` +
        "time. Don't wait on the step; wait on the plan instead, which goes on once this step ends. Nothing was written."
    );
  }

  const unavailable =
    "waiting on a task needs durable execution, a store that keeps wakes, a durability sweeper that resumes waits " +
    "at their deadline, and a board that keeps the wait. Durable execution is on by default wherever stores " +
    "persist (`durable: false` turns it off), and the sweeper runs only in a process that serves a router " +
    "(`fsdev dev`, `fsdev serve`, a self-hosted server), not in `fsdev run`. Nothing was written.";
  if (
    collection.markWait === undefined ||
    collection.lapseWait === undefined ||
    collection.releaseWait === undefined ||
    collection.clearResumeOwed === undefined
  ) {
    return refused("wait_unavailable", unavailable);
  }
  const binding = { board: collection.collectionId, taskId };
  // Read once and recorded: a request resumed after its park may no longer
  // hold what it was admitted with in this process.
  const own =
    ctx.runOnce === undefined
      ? undefined
      : ((await ctx.runOnce(`fsd.wait.own:${options.key}`, async () => ownWaitRowFromContext(ctx, options.ownBoard === true) ?? null)) ??
        undefined);
  const waitable = await checkWaitable(ctx, {
    key: options.key,
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.step === undefined ? {} : { step: options.step }),
    binding,
    ...(own === undefined ? {} : { own }),
    unavailable
  });
  if (!waitable.ok) return waitable;
  const { deadlineMs } = waitable;
  return { taskId, key: options.key, row, deadlineMs, binding, own };
}

/** Why a wait was refused by the checks every wait makes ({@link checkWaitable}). */
export type WaitableRefusal = Extract<TaskWaitRefusal, "wait_unavailable" | "wait_deadline_out_of_range" | "wait_too_deep" | "wait_already_pending">;

/** What {@link checkWaitable} checks a wait against. */
export interface WaitableOptions {
  /** What the wait is recorded under with the request: its depth is decided once under it. */
  readonly key: string;
  /** How long to wait, in ms from the call. The host's default when unset. */
  readonly deadlineMs?: number;
  /** The model step the wait belongs to: one wait per step. Omitted for a wait that is no model's tool call. */
  readonly step?: string;
  /** What the wait would park on, for the depth of its chain. */
  readonly binding?: WaitGateBinding;
  /** The request's own wait row, for the depth of its chain. */
  readonly own?: WaitRow;
  /** What `wait_unavailable` says: the waiter names what it needs. */
  readonly unavailable: string;
}

/**
 * The checks every wait makes before anything is written, whatever it waits
 * on (`getTask`'s wait, a plan's drain, a worker's call): the host can hold a
 * wait; the deadline is within its bounds (never clamped), the host's default
 * when unset; the chain stays within {@link MAX_WAIT_DEPTH}; and, for a model's
 * tool call, one wait per step. The step is claimed last, so a wait refused
 * for its depth doesn't hold it. The depth and the claim are recorded with the
 * request, so a replay decides the same way.
 */
export async function checkWaitable(
  ctx: BlockContext,
  options: WaitableOptions
): Promise<{ readonly ok: false; readonly error: WaitableRefusal; readonly message: string } | { readonly ok: true; readonly deadlineMs: number }> {
  const waits = ctx.requestHost?.waits;
  if (waits === undefined || !canHoldWait(ctx) || ctx.runOnce === undefined || ctx.suspend === undefined) {
    return { ok: false, error: "wait_unavailable", message: options.unavailable };
  }
  const { minMs, maxMs, defaultMs } = waits.deadlines;
  const deadlineMs = options.deadlineMs ?? defaultMs;
  if (!Number.isFinite(deadlineMs) || deadlineMs < minMs || deadlineMs > maxMs) {
    return {
      ok: false,
      error: "wait_deadline_out_of_range",
      message: `deadline must be from ${minMs} to ${maxMs} ms; ${deadlineMs} is outside it. Nothing was written.`
    };
  }
  const tooDeep = await depthRefusal(ctx, `fsd.wait.depth:${options.key}`, options.binding, options.own);
  if (tooDeep !== undefined) return { ok: false, error: "wait_too_deep", message: tooDeep.message };
  // One wait per model step. The first call to claim the step holds it,
  // durably, so a replay after the resume re-reads the same holder.
  if (options.step !== undefined) {
    const holder = await ctx.runOnce(`fsd.wait.step:${options.step}`, async () => options.key);
    if (holder !== options.key) {
      return { ok: false, error: "wait_already_pending", message: "this step already waits on something. Wait again on a later step." };
    }
  }
  return { ok: true, deadlineMs };
}

/**
 * The depth check, for one park: `wait_too_deep` when the chain this wait
 * would join passes {@link MAX_WAIT_DEPTH}. Decided once per park and recorded
 * under `memoKey`, so the replay after the resume decides as the first run
 * did: the chain it counts has changed by then.
 */
async function depthRefusal(
  ctx: BlockContext,
  memoKey: string,
  binding: WaitGateBinding | undefined,
  own: WaitRow | undefined
): Promise<Extract<TaskWaitResult, { ok: false }> | undefined> {
  const depth = await ctx.runOnce!(memoKey, () =>
    ctx.requestHost!.waits!.depth({ ...(binding !== undefined ? { binding } : {}), ...(own !== undefined ? { own } : {}) })
  );
  if (depth <= MAX_WAIT_DEPTH) return undefined;
  return refused(
    "wait_too_deep",
    `waits nest at most ${MAX_WAIT_DEPTH} deep, and this one would make ${depth} in its chain (the waits on ` +
      "this request's own task above it, and the waits under what it would wait on). Nothing was written."
  );
}

/** The wait itself, once its checks passed. */
async function waitChecked(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  taskId: string,
  options: WaitOnTaskOptions,
  { row, deadlineMs, binding, own }: CheckedWait
): Promise<TaskWaitResult> {
  const drain = options.ownBoard === true;
  for (let round = 0; ; round += 1) {
    const roundKey = round === 0 ? options.key : `${options.key}#${round}`;
    // A drain waiting again on a row it handed over never refuses on depth:
    // the cap refuses new waits, and this one already exists. Refusing it
    // can't shorten the chain, only leave the plan waiting on nothing. A lower
    // wait made while the drain was between parks may leave the chain one too
    // deep until one end finishes.
    if (round > 0 && !drain) {
      // Waiting again is a new park on a chain that may have grown while this
      // request ran between them: count it again, once for this round.
      const tooDeep = await depthRefusal(ctx, `fsd.wait.depth:${roundKey}`, binding, own);
      if (tooDeep !== undefined) {
        releaseAtRequestEnd(ctx, collection, taskId);
        return tooDeep;
      }
    }
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
    const marked = await collection.markWait!(taskId, {
      gateId: planned.gateId,
      deadline: planned.deadline,
      requestId,
      ...(drain ? { drain: true as const } : {})
    });
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
      return ended(ctx, collection, taskId, planned.gateId);
    }

    const outcome: WaitOutcome = await parkOnWait(ctx, park);
    if ("stopped" in outcome) return endStopped(ctx, collection, taskId);
    if (await ownTaskEnded(ctx, drain)) return endQuietly(ctx, collection, taskId, "its own task ended while it waited");
    // The ending, an error naming one, or (on a gate parked before FIX-2082,
    // replayed) the old timeout: read the row, whichever it was.
    if (!("deadline" in outcome) && !isLegacyTimeout(outcome)) return ended(ctx, collection, taskId, planned.gateId);

    // The deadline. The slot lapses, unless the ending already won.
    const lapsed = await collection.lapseWait!(taskId, planned.gateId, requestId);
    if (lapsed.outcome === "declined") return ended(ctx, collection, taskId, planned.gateId);
    // Released at the request's end, waiting again or not: a drain that fails
    // before its next mark leaves no lapsed slot, nor its `drain` mark, behind.
    // One it marks again is live by then, and the release passes it by.
    releaseAtRequestEnd(ctx, collection, taskId);
    if (options.waitAgain === true) continue;
    return { ok: true, task: collection.get(taskId) ?? row, ended: false };
  }
}

function refused(error: TaskWaitRefusal, message: string): Extract<TaskWaitResult, { ok: false }> {
  return { ok: false, error, message };
}

function isLegacyTimeout(outcome: WaitOutcome): boolean {
  return "error" in outcome && outcome.error.code === "wait_timed_out";
}

/**
 * The row the running request works, when it works one, read off its context:
 * the task it was admitted for, else the claim an inline worker holds, else
 * the task its session was opened for. Server-set, never input: the engine's
 * depth count reads it to find what waits on this request's own work.
 *
 * The admitted task comes first: inside a task's request, an inline plan
 * step's claim is a step of that task, which adds no depth, so the chain
 * above runs through the task. A drain's claim is the row it waits on, never
 * its own work.
 */
function ownWaitRowFromContext(ctx: BlockContext, drain = false): WaitRow | undefined {
  const admitted = admittedTaskOf(ctx);
  if (admitted !== undefined) return { board: admitted.ref.collectionId, taskId: admitted.taskId };
  const claim = drain ? undefined : currentWorkerClaim(ctx);
  if (claim !== undefined) return { board: claim.collectionId, taskId: claim.taskId };
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

/**
 * The waited-on row ended: clear what it owes the resume, and return it. An
 * ending that came before the wait owes its filer a notice; when the filer is
 * the one waiting, this answer delivers it, so it is dropped (FIX-2112). One
 * the filer's `onTaskSettled` already took is its delivery instead (FIX-2123).
 * `delivered` says this answer is the filer's one hearing of the ending
 * (FIX-2138): the ending resumed this wait, which owes no notice, or this
 * wait dropped the notice, or it read an ending held for it.
 *
 * @param gateId This round's gate, the same on the replay after the resume.
 */
async function ended(ctx: BlockContext, collection: TaskCollectionRef, taskId: string, gateId: string): Promise<TaskWaitResult> {
  const before = collection.get(taskId);
  // Ended onto this wait's own live slot: the ending resumed it, and owes no
  // notice. A later wait on the row finds the slot still there (a terminal
  // row keeps it) under another gate, and delivers nothing.
  const resumedHere =
    before !== undefined &&
    isTerminalStatus(before.status) &&
    before.wait != null &&
    before.wait.lapsed !== true &&
    before.wait.gateId === gateId;
  await clearMarker(collection, taskId);
  const task = collection.get(taskId)!;
  const heldHere = await deliverHeldEnding(ctx, collection, task);
  const read = await deliverEndedBeforeWait(ctx, collection, collection.get(taskId) ?? task);
  const delivered = !read.arrivesAsNotice && (resumedHere || heldHere || read.dropped);
  return {
    ok: true,
    task: collection.get(taskId) ?? task,
    ended: true,
    ...(read.arrivesAsNotice ? { arrivesAsNotice: true as const } : {}),
    ...(delivered ? { delivered: true as const } : {})
  };
}

/**
 * Drop the notice an ending owes its filer, when the filer's own wait read it
 * (FIX-2112). Never fails the call: a drop that fails leaves the notice owed,
 * and the filer hears the ending a second time.
 *
 * @returns `arrivesAsNotice`: whether the filer's `onTaskSettled` took the
 *   notice first (FIX-2123), read off the row as stored after the drop: that
 *   notice, still under way or to be sent again, is the delivery, and the wait
 *   says so. A notice already delivered is not: the wait answers with the
 *   ending, as a read does (FIX-2181). `dropped`: this wait dropped the notice, so its answer is the delivery
 *   (FIX-2138).
 */
async function deliverEndedBeforeWait(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  task: Task
): Promise<{ arrivesAsNotice: boolean; dropped: boolean }> {
  const filer = collection.filerOf?.(task) ?? task.filer?.sessionId;
  if (filer === undefined || filer !== ctx.session.identity.id) return { arrivesAsNotice: false, dropped: false };
  let row = task;
  const owed = Object.keys(deliveredByWait(task)).length > 0;
  if (owed) {
    try {
      await collection.dropNoticeReadByWait?.(task.id);
      // A drop declined by a take another request committed first.
      await collection.refresh?.(task.id);
      row = collection.get(task.id) ?? task;
    } catch (error) {
      console.warn(`[orchestration] wait "${task.id}": its ending's notice stays owed: ${(error as Error).message}`);
      return { arrivesAsNotice: false, dropped: false };
    }
  }
  const taken = noticeTakenByAnother(row, ctx.request.identity.id);
  const arrivesAsNotice = taken !== undefined && (taken.owed || !(await hasEnded(ctx, taken.by)));
  // Dropped: the notice this ending owed is gone, and no other request took it.
  return { arrivesAsNotice, dropped: owed && !arrivesAsNotice && Object.keys(deliveredByWait(row)).length === 0 };
}

/**
 * What a wait answers when the task's ending arrives as a notice (FIX-2123):
 * the task, by name, and that its ending reaches the conversation as a notice
 * in its own right, so a model doesn't read it as "no result" and wait again.
 */
export function arrivesAsNoticeAnswer(task: Pick<Task, "id" | "goal" | "title">): {
  ok: true;
  taskId: string;
  arrivesAsNotice: true;
  message: string;
} {
  return {
    ok: true,
    taskId: task.id,
    arrivesAsNotice: true,
    message:
      `Task "${task.title ?? task.goal}" (${task.id}) has ended. Its ending comes to this conversation as a notice, ` +
      `on its own; don't wait on this task again.`
  };
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

/**
 * The tasks each running request lapsed a wait on in this process, released
 * at its end: the fast path. The row records the lapse too, and the filer's
 * pass releases what this misses (a crash, or a run in another process).
 * `armed` is whether a request-end hook in the request's current run holds it.
 */
const lapsedByRequest = new Map<string, { readonly tasks: Map<string, TaskCollectionRef>; armed: boolean }>();

/** Exposed for tests: the requests with lapsed slots this process will release at their end. */
export function lapsedSlotsHeldInProcess(): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map([...lapsedByRequest].map(([requestId, entry]) => [requestId, new Set(entry.tasks.keys())]));
}

/**
 * Release this request's lapsed slot on `taskId` when the request ends. An
 * ending held for it and never read goes to the filer's notice, once. A park
 * releases nothing here: no row is written while a request parks. The board
 * owes the filer's pass a wake at the park, and that pass releases the slot
 * (FIX-2170), so a parked request holds no ending. This release is what pays
 * a slot the pass hadn't reached before the resume.
 */
function releaseAtRequestEnd(ctx: BlockContext, collection: TaskCollectionRef, taskId: string): void {
  const requestId = ctx.request.identity.id;
  let entry = lapsedByRequest.get(requestId);
  if (entry === undefined) {
    entry = { tasks: new Map(), armed: false };
    lapsedByRequest.set(requestId, entry);
  }
  entry.tasks.set(taskId, collection);
  arm(ctx, requestId, entry);
}

/**
 * In a run after a park: arm this run's request-end hook for the slots the
 * request lapsed before it. Every wait and every read of a task calls it; a
 * run that makes neither leaves its slots to the filer's pass.
 */
function rearmLapsed(ctx: BlockContext): void {
  const requestId = ctx.request?.identity?.id;
  const entry = requestId === undefined ? undefined : lapsedByRequest.get(requestId);
  if (entry !== undefined) arm(ctx, requestId!, entry);
}

function arm(ctx: BlockContext, requestId: string, entry: { readonly tasks: Map<string, TaskCollectionRef>; armed: boolean }): void {
  if (entry.armed) return;
  const registered = onRequestEnded(ctx, async (ending) => {
    entry.armed = false;
    // Parked: no row I/O here. The filer's pass, woken at the park, releases
    // the slots; its run after the resume arms again for any it hadn't.
    if (ending.status === "suspended") return;
    if (lapsedByRequest.get(requestId) === entry) lapsedByRequest.delete(requestId);
    for (const [id, ref] of entry.tasks) {
      try {
        await ref.releaseWait?.(id, { requestId, read: false });
      } catch (error) {
        console.warn(
          `[orchestration] wait "${id}": its lapsed slot was not released at the request's end; the filer's pass releases it: ${(error as Error).message}`
        );
      }
    }
  });
  if (registered) entry.armed = true;
  // No seam here (a hand-built context): nothing in this process releases it, the pass does.
  else if (lapsedByRequest.get(requestId) === entry) lapsedByRequest.delete(requestId);
}

/** This process no longer holds `taskId`'s lapsed slot for `requestId`; a request left with none is forgotten. */
function forgetLapsed(requestId: string, taskId: string): void {
  const entry = lapsedByRequest.get(requestId);
  if (entry === undefined) return;
  entry.tasks.delete(taskId);
  if (entry.tasks.size === 0) lapsedByRequest.delete(requestId);
}

/**
 * Release every slot on `collection` that lapsed for a request that no longer
 * runs its work ({@link requestStates}): parked (FIX-2170) or ended. Run by
 * the filer's pass. An ending held for such a request goes to the filer's
 * notice, once.
 *
 * A parked request holds no ending: the board owes this pass a wake at the
 * park, and the pass releases its slots then. A request that ended releases
 * its slots itself in the process that ran it; the pass releases what that
 * missed (a crash: the request reads ended once it is marked interrupted).
 * So the pass looks again at a slot whose request still runs less and less
 * often, from {@link LAPSED_SLOT_CHECK_MS} up to
 * {@link LAPSED_SLOT_CHECK_CAP_MS}, as the slot ages, and stops looking once
 * it is `maxAgeMs` past its lapse (the wait's deadline), as every other debt
 * of the pass ends. A slot it stops looking at is still released by its
 * request's end or park, or by a later pass that finds the request stopped.
 *
 * @returns When the pass should look again: the earliest check-in for a slot
 *   whose request still runs, or `undefined` when none is owed.
 */
export async function releaseEndedWaits(
  ctx: BlockContext,
  collection: TaskCollectionRef,
  now: number,
  maxAgeMs: number = Infinity
): Promise<number | undefined> {
  const lapsed = collection.list().filter((row) => row.wait?.lapsed === true && row.wait.requestId !== undefined);
  if (lapsed.length === 0) return undefined;
  if (ctx.requestHost?.waits?.ended === undefined || collection.releaseWait === undefined) return undefined;
  const states = await requestStates(
    ctx,
    lapsed.map((row) => row.wait!.requestId!)
  );
  let next: number | undefined;
  // Look again at this slot later, unless it is past the age every debt ends at.
  const lookAgain = (row: Task, why: string): void => {
    const age = Math.max(0, now - row.wait!.deadline);
    if (age > maxAgeMs) {
      // Said once, by the pass that crosses the bound: a later pass, at most a
      // check interval on, finds it past by more.
      if (age - maxAgeMs <= LAPSED_SLOT_CHECK_CAP_MS) {
        console.warn(
          `[orchestration] wait "${row.id}": ${why} ${Math.round(age / 1000)} s past the lapse; ` +
            "the pass stops looking at its slot, which the request's end releases"
        );
      }
      return;
    }
    const at = now + Math.min(Math.max(age, LAPSED_SLOT_CHECK_MS), LAPSED_SLOT_CHECK_CAP_MS);
    next = Math.min(next ?? Infinity, at);
  };
  for (const row of lapsed) {
    const requestId = row.wait!.requestId!;
    const state = states?.[requestId];
    // A request of another session reads as neither running nor ended, so as
    // parked: only this session's own slots are released at a park. The
    // slot's waiter is the session that filed the row (the filer check of
    // every wait; a drain hands over rows of its own session's board).
    const own = (collection.filerOf?.(row) ?? row.filer?.sessionId) === ctx.session?.identity?.id;
    if (state !== "ended" && !(state === "parked" && own)) {
      lookAgain(row, "its request still runs");
      continue;
    }
    try {
      await collection.releaseWait(row.id, { requestId, read: false });
      forgetLapsed(requestId, row.id);
    } catch (error) {
      console.warn(`[orchestration] wait "${row.id}": its lapsed slot stays for the next pass: ${(error as Error).message}`);
      lookAgain(row, "its request ended, and releasing its slot keeps failing,");
    }
  }
  return next;
}

/**
 * A read of `task` by the running request delivers an ending held for it
 * (FIX-2082): the request's wait on the task lapsed at its deadline, the task
 * ended while the request still ran, no park has released the slot since
 * (FIX-2170), and this read is that request's. The held
 * notice is dropped and the slot released, so the filer's `onTaskSettled` is
 * never told. A no-op for any other read.
 *
 * @returns Whether this read delivered an ending: the task ended, and its
 *   ending was held for this request (FIX-2138).
 */
export async function deliverHeldEnding(ctx: BlockContext, collection: TaskCollectionRef, task: Task): Promise<boolean> {
  rearmLapsed(ctx);
  const requestId = ctx.request?.identity?.id;
  if (requestId === undefined || task.wait?.lapsed !== true || task.wait.requestId !== requestId) return false;
  if (!isTerminalStatus(task.status) && !holdsAnEnding(task)) return false;
  const released = await collection.releaseWait?.(task.id, { requestId, read: true });
  forgetLapsed(requestId, task.id);
  // Delivered only by this write: a slot released by someone else meanwhile
  // turned the held ending into an owed notice, which delivers it instead.
  return released?.outcome === "recorded" && isTerminalStatus(task.status) && holdsAnEnding(task);
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
 * on reaching the ended row) or the request is not resumable yet (`busy`:
 * another resume holds it, or it has not finished parking); the next touch
 * tries again.
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
    // Two debts share the mark: the request waiting on this row (`wait`), and
    // the row's own run parked on a user's stop when the row ended (FIX-2129).
    // The mark clears once both are paid.
    const userOwed = owesUserResume(row);
    const waitOwed = row.wait != null && row.wait.lapsed !== true;
    if (collection.clearResumeOwed === undefined || host.resumeWait === undefined || (!userOwed && !waitOwed)) {
      stillOwed.push(row.id);
      continue;
    }
    let paid = true;
    let resumedHere = false;
    if (userOwed) {
      try {
        paid = await payOwedUserResume(ctx, row);
      } catch (error) {
        console.warn(`[orchestration] task "${row.id}": its cancelled resume failed and stays owed: ${(error as Error).message}`);
        paid = false;
      }
    }
    if (waitOwed) {
      let result: Awaited<ReturnType<NonNullable<typeof host.resumeWait>>>;
      try {
        result = await host.resumeWait({ gateId: row.wait!.gateId, outcome: outcomeOf(row) });
      } catch (error) {
        // One row's failed resume stays owed for the next touch, and never
        // stops the rest of the touch: the other rows, or the notices a board
        // run sends after it.
        console.warn(`[orchestration] wait "${row.id}": its resume failed and stays owed: ${(error as Error).message}`);
        stillOwed.push(row.id);
        continue;
      }
      if (result.ok) resumedHere = true;
      else if (result.refused !== "already-resolved") paid = false;
    }
    if (!paid) {
      stillOwed.push(row.id);
      continue;
    }
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
    if (resumedHere || userOwed) resumed.push(row.id);
  }
  return { resumed, stillOwed };
}
