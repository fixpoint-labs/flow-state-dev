/**
 * A request admitted for a dispatched task, and the one check that settles
 * the task at that request's end (FIX-2077, rule 6).
 *
 * **Done** means: a request for the task ended with a result, its background
 * work ended too, no steer is untaken by its attempt, and no filed work still
 * holds the task. The claim gate admits the task's own entry (`work`, and its
 * resume); {@link taskRequestAdmission} admits the other requests for it a
 * package runs in the task's session while it waits (a notice of a piece's
 * ending, a steer's turn). A message to the task's session is none of them:
 * it is conversation there, never part of the task; while the task's turn
 * runs, it runs after that turn. Every admitted
 * request ends at the same check, which runs after the
 * engine's last drain through its request-end seam (`onRequestEnded`), on every
 * way the request can end:
 *
 * - **completed** — the check. Done: the row completes with the latest
 *   checkpoint its worker reported, else the last answer a request that
 *   counts gave (the entry's, or a woken turn's). Not done: the row records
 *   what holds it (`keptOpenBy: "filed"`),
 *   keeps that answer as its output, and drops its lease, so no reclaim takes
 *   it back. The next request admitted for it checks again.
 * - **a steer no request of its attempt took** (FIX-2086 D2): one more turn
 *   before it settles. The check owes the task session's steer entry a wake,
 *   records `keptOpenBy: "steer"` with no lease (the answer kept as for any
 *   wait), and starts that entry at once; the entry admits a same-attempt
 *   request whose message is the steer, and its end checks again. Each turn
 *   takes at least one steer, so the steer cap bounds the turns.
 * - **suspended** — the row records the stop (`keptOpenBy: "wait"`) and drops
 *   its lease (D1), in one write; a stop for a person, by the one predicate
 *   `isUserSuspension`, is mirrored in that write as the row's suspension hold
 *   (`Task.questions`, FIX-2133 D2), what it asks with it. The resume is admitted
 *   like any request, and its admission closes the mirror. A row a question
 *   holds takes no mirror (one wait per turn): the stop is cancelled instead,
 *   and the run resumes `cancelled`.
 * - **held** — the turn asked questions (`TaskCollectionRef.ask`): it ends
 *   unsettled, and writes nothing more. The last answer owes the next turn.
 * - **failed, aborted, interrupted** — the attempt fails, where it does today
 *   (a gate's rescue has usually done it already, and then this writes
 *   nothing).
 *
 * **Admission** re-mints the claim from the row, clears `keptOpenBy`, and gives
 * the row a lease again, renewed until the request ends. Admitting a turn the
 * row owes (its last question answered, or a steer no request took) is that
 * turn's claim: the write advances the turn generation, and the ticket is
 * minted again from the row it left (FIX-2133 D3). Only the task's own
 * entry is admitted while no request waits: any other request is admitted
 * only while the task is waiting, so two requests never check it at once.
 *
 * A context with no request-end seam (a hand-built test context) admits
 * nothing outside the gate, and the gate checks at its entry's last step.
 */
import { handler } from "@flow-state-dev/core";
import { dispatchThroughSeam, isUserSuspension, onRequestEnded, waitForUserKindOf, type RequestEndVerdict, type RequestEnding, type SuspensionAddress } from "@flow-state-dev/core/types";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  DEFAULT_LEASE_DURATION_MS,
  MAX_QUESTION_PROMPT,
  filedWorkKeepsOpen,
  readCommittedTask,
  ticketForClaim,
  untakenSteers,
  type SuspensionQuestion,
  type Task,
  type TaskClaimTicket,
  type TaskCollectionRef,
  type TaskKeptOpenBy,
} from "../tasks";
import { ticketClaimsRow } from "../tasks/collection/internal";
import { askedOnTicket, suspensionQuestionOf } from "../tasks/collection/questions";
import { advisoryComplete, advisoryFail } from "../tasks/collection/advisory-write-back";
import { settleAtRequestEnd } from "./blocks/record-result";
import { startLeaseRenewal, type LeaseRenewalDriver } from "../tasks/lease-renewal";
import { stampLeaseRenewal, withLeaseRenewalScope } from "../tasks/lease-renewal-scope";
import { currentWorkerClaim, openWorkerClaimScope, stampCurrentClaim } from "./flow-policy-wiring";

/** What else holds a task open at a request's end, beside its own request (rule 6). */
export interface TaskEndRules {
  /**
   * Whether work the task filed still holds it. Default: a row on the task's
   * own ledger it filed (`filedByTask`) that is open or still owes its ending
   * (`filedWorkKeepsOpen`).
   */
  filedWorkKeepsOpen?: (ctx: BlockContext, task: Task, ledger: TaskCollectionRef) => Promise<boolean>;
  /**
   * The internal entry, on the task session's own flow, that runs one more
   * turn for a steer no request of the attempt took (FIX-2086 D2). The check
   * starts it in the running session, with a wake owed for it first, and the
   * entry admits its request for the task. Absent: a steer that lands after a
   * request's last model call waits for the attempt's next request, if any,
   * and the task settles without it.
   */
  steerTurn?: { readonly entry: string };
}

/**
 * When a steer's owed turn falls due if its fast-path start was lost: write +
 * 2 s (FIX-2086 D2), the wake's due time.
 */
export const STEER_TURN_DUE_MS = 2_000;

/** One request admitted for a task, until its end. */
interface Admitted {
  readonly ctx: BlockContext;
  readonly ref: TaskCollectionRef;
  readonly ticket: TaskClaimTicket;
  readonly renewal: LeaseRenewalDriver | undefined;
  /** Whether this request's answer is the task's result: the entry's and a woken turn's are, a check's isn't. */
  readonly answerCounts: boolean;
  /** What the row waited on when this request was admitted. */
  readonly prior: TaskKeptOpenBy | undefined;
  readonly rules: TaskEndRules;
  /** The answer this request gave, once it gave one that counts. */
  answer?: { output: unknown };
  /** No request-end seam: the check runs where the answer is noted. */
  readonly inline: boolean;
  /**
   * This request asked questions midway (FIX-2133): its turn is over, and the
   * row is the next turn's once they're answered, even when the last answer
   * lands before this request ends.
   */
  askedQuestions?: boolean;
  /**
   * The task's own request (its entry, or that entry's resume), rather than a
   * later one admitted for it while it waits (a notice, a steer's turn).
   */
  readonly own: boolean;
}

/**
 * The requests admitted in this process, by request id. Each leaves at its
 * request's end. Requests for the same task are serialized by admission, not
 * by this map: a task session's notices run one at a time on its line, and
 * the task's own request is told from later ones by `own`.
 */
const admitted = new Map<string, Admitted>();

function requestKey(ctx: BlockContext): string {
  return ctx.request.identity.id;
}

/**
 * The task the running request was admitted for in this process, and the
 * ledger it is on: what a wait reads its request's own task from (FIX-2082).
 * `undefined` when the request was admitted for no task.
 */
export function admittedTaskOf(ctx: BlockContext): { readonly ref: TaskCollectionRef; readonly taskId: string } | undefined {
  const requestId = ctx.request?.identity?.id;
  const record = requestId === undefined ? undefined : admitted.get(requestId);
  return record === undefined ? undefined : { ref: record.ref, taskId: record.ticket.taskId };
}

/**
 * Whether the row is still on the claim `ticket` names: same row, running,
 * same attempt and same turn (FIX-2133 D3), by the one predicate the write
 * fence shares (`ticketClaimsRow`).
 */
function claimHolds(ref: TaskCollectionRef, ticket: TaskClaimTicket, row: Task | undefined): row is Task {
  return ticketClaimsRow(ticket, ref.collectionId, row);
}

/**
 * Whether `record`'s turn asked questions midway (FIX-2133): this request
 * asked, or the row's `askedInTurn` names the turn its ticket holds (a resume of
 * the asking turn, whose own record is new).
 */
function askedThisTurn(record: Admitted, row: Task | undefined): boolean {
  return record.askedQuestions === true || askedOnTicket(row, record.ticket);
}

/** A task's request ended with a result that settles it, or that the next request picks up. */
function answeredBefore(prior: TaskKeptOpenBy | undefined): boolean {
  return prior === "filed" || prior === "steer";
}

/**
 * Admit the running request for a task whose claim it holds: clear what the
 * row waited on, give it a lease again, renew it until the request ends, and
 * check the task at that end.
 *
 * @returns the lease renewal driver, when the row holds a lease to renew,
 *   and the ticket the request holds now: the one passed in, or, when the
 *   admission took a turn the row owed, the same claim at its new turn.
 * @throws {Error} when the row can't be given a lease again because its claim moved on.
 */
export async function admitClaimedTask(
  ctx: BlockContext,
  options: {
    ref: TaskCollectionRef;
    row: Task;
    ticket: TaskClaimTicket;
    answerCounts: boolean;
    /** Whether this is the task's own request: its entry or that entry's resume. */
    own: boolean;
    rules?: TaskEndRules;
    /** Called when the row's lease could not be restored, with the decline reason. */
    onStale?: (reason: string) => Error;
  }
): Promise<{ renewal: LeaseRenewalDriver | undefined; ticket: TaskClaimTicket }> {
  const { ref } = options;
  let ticket = options.ticket;
  let row = options.row;
  const prior = row.keptOpenBy ?? undefined;
  // The task's own request resuming a turn that asked (FIX-2133): the turn is
  // over, and the row, owed turn included, is the next turn's. Admitted for
  // nothing to write: it takes no lease and no turn.
  const askedTurn = options.own && row.askedInTurn === ticket.turn;
  if (!askedTurn && (prior !== undefined || row.turnOwed === true) && ref.setKeptOpenBy !== undefined) {
    const span = row.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    // The run's own resume closes the mirror of its stop (FIX-2133). A later
    // request (a notice, a steer's turn) keeps it: the task's own run is
    // still parked on it, and a cancel meanwhile owes that run its resume.
    const outcome = await ref.setKeptOpenBy(row.id, null, {
      claim: ticket,
      leaseUntil: ref.now() + span,
      ...(options.own ? { resume: true } : {}),
    });
    if (outcome.outcome === "declined") {
      throw (options.onStale ?? ((reason: string) => new TaskAdmissionLost(row.id, reason)))(outcome.reason);
    }
    row = ref.get(row.id) ?? row;
    // A turn the row owed, taken here, moved its turn generation (D3).
    if ((row.turn ?? 0) !== ticket.turn) ticket = { ...ticket, turn: row.turn ?? 0 };
  }
  const renewal =
    row.leaseUntil == null
      ? undefined
      : startLeaseRenewal({
          collection: ref,
          ticket,
          claimedTask: row,
          // The request's signal, as before: a request that is stopped or torn
          // down stops renewing. The check at its end stops it otherwise.
          signal: ctx.signal,
        });
  const key = requestKey(ctx);
  admitted.get(key)?.renewal?.stop();
  const record: Admitted = {
    ctx,
    ref,
    ticket,
    renewal,
    answerCounts: options.answerCounts,
    prior,
    ...(askedTurn ? { askedQuestions: true } : {}),
    rules: options.rules ?? {},
    inline: false,
    own: options.own,
  };
  // The hook closes over its own record: a resume reuses the request id, so a
  // hook from the run before it must never check (or drop) the resume's record.
  const registered = onRequestEnded(ctx, (ending) => endRequest(key, record, ending));
  admitted.set(key, registered ? record : { ...record, inline: true });
  return { renewal, ticket };
}

/**
 * The admission a request lost: the row moved on between its read and the
 * write (another claim took the turn it was owed first, FIX-2133 D3). A
 * request admitted for a task while it waits admits nothing on it.
 */
export class TaskAdmissionLost extends Error {
  constructor(
    readonly taskId: string,
    readonly reason: string
  ) {
    super(`[task-board] task "${taskId}" could not be admitted: ${reason}`);
    this.name = "TaskAdmissionLost";
  }
}

/** How a request ended, as a task's check reads it: everything but its spend. */
type TaskEnding = Omit<RequestEnding, "spend">;

/**
 * Note the answer the running request gave, when it is one the task's
 * result can be (see {@link Admitted.answerCounts}). With no request-end seam,
 * the task is checked here.
 */
async function noteAnswer(ctx: BlockContext, output: unknown): Promise<void> {
  const key = requestKey(ctx);
  const record = admitted.get(key);
  if (record === undefined) return;
  if (record.answerCounts) record.answer = { output };
  if (record.inline) {
    const failure = await endRequest(key, record, { status: "completed" });
    if (failure !== undefined) throw failure.fail;
  }
}

/**
 * The request admitted for a task ended: check the task, then stop renewing
 * its lease. A failure to record the result is handed back as the request's
 * own (FIX-963), so the run's status never reads as success.
 */
async function endRequest(key: string, record: Admitted, ending: TaskEnding): Promise<RequestEndVerdict | undefined> {
  // Only this record's own entry leaves the map: a resume's is another record.
  if (admitted.get(key) === record) admitted.delete(key);
  try {
    const failure = await checkTask(record, ending);
    return failure === undefined ? undefined : { fail: failure };
  } finally {
    // After the write, never before: the write is fenced on the lease.
    record.renewal?.stop();
  }
}

/** The guards every write of the check presents: advisory, fenced on the claim. */
const guardsOf = (ticket: TaskClaimTicket) => ({ ifAllowed: true, claim: ticket }) as const;

/** Whether a request ending is one that fails the attempt. */
const failsTheAttempt = (status: RequestEnding["status"]) =>
  status === "failed" || status === "aborted" || status === "interrupted";

/** The one check (rule 6), at the end of a request admitted for the task. A failure to record comes back. */
async function checkTask(record: Admitted, ending: TaskEnding): Promise<Error | undefined> {
  const { ref, ticket } = record;
  const row = ref.get(ticket.taskId);
  // First, before any other branch (FIX-2133): a request whose turn asked
  // questions midway waits once, on those questions. It may not stop for the
  // user (its stop is cancelled, and the run resumes `cancelled`) and never
  // settles or records a wait, whether the questions are answered yet or not,
  // and whether or not a later turn has claimed the row since. Read from the
  // request (`askedQuestions`) and the turn generation its questions wrote, never from the
  // holds the row has open now.
  if (askedThisTurn(record, row)) {
    const suspension = ending.status === "suspended" ? ending.suspension : undefined;
    const stop = suspension !== undefined && isUserSuspension(suspension) ? mirrorOf(record.ctx, ending) : undefined;
    if (stop !== undefined) cancelRefusedStop(record.ctx, ticket.taskId, stop.source);
    return undefined;
  }
  // Settled, retried, taken back or claimed for a later
  // turn meanwhile: not this request's to write.
  if (!claimHolds(ref, ticket, row)) return undefined;
  // A later request (a notice, a steer's turn) while the task's own request is
  // suspended settles nothing and fails nothing: the task still waits on that
  // request, and keeps an answer this one gave that counts.
  if (!record.own && waitsOnItsOwnRequest(record.prior)) {
    await waitOn(record, row, record.prior!, record.answer);
    return undefined;
  }
  if (ending.status === "suspended") {
    const stop = stopOf(record, ending);
    const mirror = stop.forPerson ? mirrorOf(record.ctx, ending) : undefined;
    const outcome = await waitOn(record, row, stop.on, undefined, mirror);
    // Defence in depth (FIX-2133): a turn that asked never reaches here (the
    // first branch), and the collection still refuses a mirror on a row a
    // question holds, one source at a time. Cancelled if it does.
    if (mirror !== undefined && outcome?.outcome === "declined" && outcome.reason === "open-question") {
      cancelRefusedStop(record.ctx, row.id, mirror.source);
    }
    return undefined;
  }
  // The first failure only, on purpose: one fails the attempt, and the row records one error.
  const background = ending.backgroundFailures?.[0];
  if (failsTheAttempt(ending.status) || background !== undefined) {
    // The request's own error wins; then the first background step that failed (FIX-2088).
    const message =
      ending.error?.message ??
      (background !== undefined
        ? `Background work "${background.step}" failed: ${background.message}`
        : `The request working the task was ${ending.status}.`);
    return settleAtRequestEnd({
      ctx: record.ctx,
      collection: ref,
      claim: ticket,
      recorder: "fail",
      settle: (write) => advisoryFail(ref, row.id, message, { ...guardsOf(ticket), write }),
    });
  }
  return checkAnswered(record, row);
}

/**
 * Whether request `requestId` took any of `task`'s steers on its attempt:
 * every read that takes one names the request in its `takenIn`.
 */
function tookSteers(task: Task, requestId: string): boolean {
  return (task.steers ?? []).some((steer) => steer.takenBy === task.attempts && steer.takenIn?.includes(requestId) === true);
}

/** A task whose own request stopped (for a person, or any other wait) and has not ended. */
function waitsOnItsOwnRequest(prior: TaskKeptOpenBy | undefined): boolean {
  return prior === "wait";
}

/**
 * What a suspended request leaves the task waiting on: its own request's stop
 * (`"wait"`), mirrored on the row when it waits for a person (the one
 * predicate, `isUserSuspension`). A request other than the task's own that
 * stops after the task answered leaves it waiting on what it waited on.
 */
function stopOf(record: Admitted, ending: TaskEnding): { on: TaskKeptOpenBy; forPerson: boolean } {
  if (!record.own && answeredBefore(record.prior)) return { on: record.prior!, forPerson: false };
  const suspension = ending.suspension;
  return { on: "wait", forPerson: suspension !== undefined && isUserSuspension(suspension) };
}

/**
 * The row's mirror of its run's stop for a person (a suspension hold,
 * FIX-2133 D2), from the request's ending: its address, what it asks, and its
 * deadline (the stop's own, which the engine ends). The flow its answer goes
 * through is the run's session's, which a reader reads off the session the
 * row's run link names. `undefined` when the ending names no suspension id (a
 * host before it).
 */
function mirrorOf(ctx: BlockContext, ending: TaskEnding): SuspensionQuestion | undefined {
  const suspension = ending.suspension;
  if (suspension?.suspensionId === undefined) return undefined;
  const kind = waitForUserKindOf(suspension);
  if (kind === undefined) return undefined;
  const prompt = suspension.message ?? "";
  return {
    id: suspension.suspensionId,
    actor: "user",
    openedAt: Date.now(),
    ...(suspension.expiresAt !== undefined ? { due: suspension.expiresAt } : {}),
    source: { kind: "suspension", requestId: requestKey(ctx), suspensionId: suspension.suspensionId },
    ask: {
      kind,
      prompt: prompt.length > MAX_QUESTION_PROMPT ? `${prompt.slice(0, MAX_QUESTION_PROMPT - 1)}…` : prompt,
      ...(suspension.title !== undefined ? { title: suspension.title } : {}),
    },
  };
}

/** How long the cancel of a refused stop keeps trying while its request finishes parking. */
const REFUSED_STOP_RETRY_MS = [50, 100, 250, 500, 1_000, 2_000, 5_000];

/**
 * Cancel a stop a held row refused to mirror (FIX-2133, one wait per turn),
 * through ER-1's cancel: the run resumes `cancelled` and reads it, and no
 * Inbox item survives for it. Called while the request is still parking, so
 * the cancel is tried again until the engine has recorded it parked. Not the
 * task's cancel: the row and its questions stand. Never fails the caller.
 */
function cancelRefusedStop(ctx: BlockContext, taskId: string, address: SuspensionAddress): void {
  const resumeWait = ctx.requestHost?.resumeWait;
  if (resumeWait === undefined) return;
  const suspension = { requestId: address.requestId, suspensionId: address.suspensionId };
  void (async () => {
    for (const wait of [0, ...REFUSED_STOP_RETRY_MS]) {
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      try {
        const result = await resumeWait({ suspension, outcome: { cancelled: true } });
        if (result.ok || result.refused !== "busy") return;
      } catch (error) {
        console.warn(`[task-board] task "${taskId}": the stop its questions refused couldn't be cancelled: ${(error as Error).message}`);
        return;
      }
    }
    console.warn(`[task-board] task "${taskId}": the stop its questions refused is still parking; the user can still answer it`);
  })();
}

/**
 * A request that ended with a result: done, or what still holds the task.
 * `rechecked` is set on the one pass after the settle declined for a steer
 * that landed after this check read the row.
 */
async function checkAnswered(record: Admitted, row: Task, rechecked = false): Promise<Error | undefined> {
  const { ref, ticket } = record;
  if (record.answer === undefined && !answeredBefore(record.prior)) {
    // The task's own request hasn't answered yet: it still waits on that.
    if (record.prior !== undefined) await waitOn(record, row, record.prior, undefined);
    return undefined;
  }
  // A steer no request of this attempt took: one more turn first (D2). Read
  // as stored: a steer is another request's write, which this one's
  // snapshot doesn't hold.
  const stored = (await readCommittedTask(ref, row.id)) ?? row;
  // The turn owed for a steer that took none: owing another would loop with
  // no end, so the task settles and the steers stay on it, untaken.
  const noProgress = record.prior === "steer" && !tookSteers(stored, requestKey(record.ctx));
  if (untakenSteers(stored).length > 0) {
    if (noProgress) {
      console.warn(`[task-board] task "${row.id}"'s steer turn took none of its steers; it settles without another turn`);
    } else if (await oweSteerTurn(record, row)) {
      return undefined;
    }
  }
  const holding = await holdingWork(record, row);
  if (holding !== undefined) {
    if (ref.setKeptOpenBy !== undefined) {
      await waitOn(record, row, holding, record.answer);
      return undefined;
    }
    // A ref that can't record a wait: leave the task running on its lease,
    // which lapses with nothing renewing it, rather than settle it early.
    console.warn(
      `[task-board] task "${row.id}" is still held by ${holding} work, and its ledger "${ref.collectionId}" ` +
        "has no setKeptOpenBy; it stays running on its lease."
    );
    return undefined;
  }
  // Done. The latest checkpoint stays the output (the collection's rule);
  // otherwise this request's answer, or the one the task kept while it waited.
  const output = record.answer !== undefined ? record.answer.output : row.output;
  // A steer that lands after the read above, while held work was checked,
  // would be settled over: the complete itself declines on an untaken steer,
  // where a turn can be owed for it, and the check runs once more.
  const fenceSteers = !noProgress && !rechecked && record.rules.steerTurn !== undefined && ref.setKeptOpenBy !== undefined;
  let lateSteer = false;
  const settled = await settleAtRequestEnd({
    ctx: record.ctx,
    collection: ref,
    claim: ticket,
    recorder: "complete",
    settle: async (write) => {
      const outcome = await advisoryComplete(ref, row.id, output, {
        ...guardsOf(ticket),
        ...(fenceSteers ? { refuseUntakenSteers: true } : {}),
        write,
      });
      lateSteer = outcome.outcome === "declined" && outcome.reason === "untaken-steers";
      return outcome;
    },
  });
  if (!lateSteer) return settled;
  // Checked again only while this request's claim still holds the row: a
  // steer for an attempt that took the row over is that attempt's to take.
  const fresh = await readCommittedTask(ref, row.id);
  if (!claimHolds(ref, ticket, fresh)) return undefined;
  return checkAnswered(record, fresh, true);
}

/** What else holds the task open: work it filed, or nothing. */
async function holdingWork(record: Admitted, row: Task): Promise<"filed" | undefined> {
  const { ref, ctx, rules } = record;
  if (await (rules.filedWorkKeepsOpen ?? defaultFiledWorkKeepsOpen)(ctx, row, ref)) return "filed";
  return undefined;
}

/**
 * Record what the task waits on, with no lease, and keep `answer` as its
 * output while it waits; with `hold`, mirror its run's stop for a person on
 * the row in the same write (FIX-2133). A later request that leaves the task
 * waiting on what it waited on passes none, and the mirror stays. A ref
 * without `setKeptOpenBy` keeps its lease instead.
 */
async function waitOn(
  record: Admitted,
  row: Task,
  on: TaskKeptOpenBy,
  answer: { output: unknown } | undefined,
  hold?: SuspensionQuestion,
  owesTurn?: boolean
): Promise<Awaited<ReturnType<NonNullable<TaskCollectionRef["setKeptOpenBy"]>>> | undefined> {
  if (record.ref.setKeptOpenBy === undefined) return undefined;
  return record.ref.setKeptOpenBy(row.id, on, {
    claim: record.ticket,
    ...(answer !== undefined ? { answer } : {}),
    ...(hold !== undefined ? { question: hold } : {}),
    ...(owesTurn === true ? { owesTurn: true } : {}),
  });
}

/**
 * Owe the task one more turn for its untaken steers (D2): the wake first, then
 * the wait (`"steer"`, no lease, the answer kept), then the entry's start in
 * this session. `false` when no turn can be owed (no steer entry, a ledger
 * that records no wait, or a flow that declares no such entry), and the check
 * goes on as before.
 */
async function oweSteerTurn(record: Admitted, row: Task): Promise<boolean> {
  const entry = record.rules.steerTurn?.entry;
  const { ctx, ref } = record;
  if (entry === undefined || ref.setKeptOpenBy === undefined) return false;
  const wakes = ctx.requestHost?.wakes;
  try {
    await wakes?.owe({ entry, dueAt: ref.now() + STEER_TURN_DUE_MS });
  } catch (error) {
    console.warn(`[task-board] the wake for task "${row.id}"'s steer turn couldn't be written; its start runs now only`, {
      error: (error as Error).message,
    });
  }
  await waitOn(record, row, "steer", record.answer, undefined, true);
  let refused: string | undefined;
  try {
    const sent = await dispatchThroughSeam(ctx, {
      type: "internal",
      action: entry,
      session: { id: ctx.session.identity.id },
      payload: {},
      from: "task-steer-turn",
    });
    if (!sent.ok && sent.refused === "no-entry") refused = sent.detail;
  } catch {
    // Not definitive: the wake starts it.
  }
  if (refused === undefined) return true;
  // The flow declares no steer entry: nothing can take the steer, so the check
  // goes on without it rather than leave the task waiting on a turn that never comes.
  console.warn(`[task-board] task "${row.id}"'s flow declares no "${entry}" entry, so its untaken steer gets no turn`, {
    detail: refused,
  });
  try {
    const read = await wakes?.read(entry);
    if (wakes !== undefined && read !== undefined) await wakes.settle(entry, read, null);
  } catch {
    // The wake fails on its own when it fires.
  }
  return false;
}

const defaultFiledWorkKeepsOpen: NonNullable<TaskEndRules["filedWorkKeepsOpen"]> = async (_ctx, task, ledger) =>
  filedWorkKeepsOpen(ledger, task.id);

/** What {@link taskRequestAdmission} is built from. */
export interface TaskRequestAdmissionOptions {
  /** Names the block. */
  readonly name: string;
  /**
   * The task this request is for, and the ledger it is on, read from
   * server-set state only. Answer only for a row this request may act for:
   * one whose run link names the running session. `undefined` admits nothing.
   */
  readonly find: (ctx: BlockContext) => Promise<{ ref: TaskCollectionRef; row: Task } | undefined>;
  /** Whether this entry's answer can be the task's result (a woken turn's can; the check entry's, which runs no turn, can't). */
  readonly answerCounts: boolean;
  /** What else holds the task open, as on the gate. */
  readonly endRules?: TaskEndRules;
}

/**
 * Admit a request for a task that is waiting, as the head of its entry:
 * `.tap(taskRequestAdmission({ ... }))`, first in the entry's sequencer, and
 * `.tap(noteTaskAnswer)` after the turn whose answer counts. The request then
 * holds the task's claim (its tools write as the worker, `reportProgress`
 * included), renews its lease, and checks the task at its end.
 *
 * A task that is not waiting (no `keptOpenBy`, and no turn owed for its
 * answered questions, FIX-2133) is left to the request working it, and this
 * request is admitted for nothing. Nor is one whose owed turn another claim
 * took first: whichever claims first wins (D3).
 */
export function taskRequestAdmission(options: TaskRequestAdmissionOptions) {
  return handler({
    name: options.name,
    transient: true,
    inputSchema: z.unknown(),
    // No `uses` and no resources here, deliberately: a block that declares
    // them is entered after an await (their load), and the claim and lease
    // scopes opened below would then publish to nobody. `find` reads ledgers
    // the entry's flow declares.
    execute: async (_input, ctx) => {
      // FIRST STATEMENTS, before any await: past the first await both publish to nobody.
      openWorkerClaimScope();
      await withLeaseRenewalScope(async () => {
        const found = await options.find(ctx as never);
        if (found === undefined) return;
        const { ref, row } = found;
        if (row.status !== "in_progress" || (row.keptOpenBy == null && row.turnOwed !== true)) return;
        let admittedAs: Awaited<ReturnType<typeof admitClaimedTask>>;
        try {
          admittedAs = await admitClaimedTask(ctx as never, {
            ref,
            row,
            ticket: ticketForClaim(ref.collectionId, row, ref.partition),
            answerCounts: options.answerCounts,
            // The resume of the stop the row waits on is that stop's own request, whichever entry
            // started it (a steer's turn, after an answered question): its admission closes the
            // mirror, and its end settles the task. Any other request admitted meanwhile is a later one.
            own: suspensionQuestionOf(row)?.source.requestId === ctx.request.identity.id,
            ...(options.endRules !== undefined ? { rules: options.endRules } : {}),
          });
        } catch (error) {
          // The board's claim took the turn first (D3): admitted for nothing.
          if (error instanceof TaskAdmissionLost) return;
          throw error;
        }
        stampCurrentClaim(admittedAs.ticket, ctx as never);
        if (admittedAs.renewal !== undefined) stampLeaseRenewal(admittedAs.renewal);
      });
    },
  });
}

/**
 * After the turn whose answer is the task's result: note it for the check at
 * the request's end. Passes nothing on; a `.tap()`.
 */
export const noteTaskAnswer = handler({
  name: "note-task-answer",
  transient: true,
  inputSchema: z.unknown(),
  execute: async (output, ctx) => {
    await noteAnswer(ctx as never, output);
  },
});

/**
 * Run `after` once the running request's task has been checked: at the
 * request's end, right after the check, when the request was admitted for a
 * task; at once otherwise. For a package's own step that reads the task's
 * ending, such as a send of the notice it owes, from a hook like `onCompleted`
 * that runs before the check.
 */
export async function afterTaskCheck(ctx: BlockContext, after: () => Promise<unknown>): Promise<void> {
  const record = admitted.get(requestKey(ctx));
  if (record !== undefined && !record.inline && onRequestEnded(ctx, async () => void (await after()))) return;
  await after();
}

/** Why a midway ask was refused: the board's decline, or no claim to ask with. */
type AskDeclineReason = Extract<Awaited<ReturnType<NonNullable<TaskCollectionRef["ask"]>>>, { outcome: "declined" }>["reason"];

/** What {@link askMidway} answers: the questions' ids once asked, or why not. */
export type MidwayAsk =
  | { readonly ok: true; readonly questions: readonly string[] }
  | { readonly ok: false; readonly reason: "no-claim" | "not-supported" | AskDeclineReason };

/**
 * Ask questions midway, from the turn holding the task's claim (FIX-2133): the
 * collection's one write opens them on the row, drops its lease and ends the
 * turn unsettled, and this request stops renewing that lease. What the turn
 * did stands (its writes, messages and last checkpoint); the next turn starts
 * from the brief, that checkpoint and the answers, on the same attempt, once
 * the user has answered every one (or a deadline the host set passes).
 *
 * The claim is the one this request holds (the gate's or an admission's,
 * server-set), never one from input, so only the turn holding the current
 * ticket asks. FIX-2131's model tool calls this.
 *
 * After the question is opened, a ledger that declares `onMidwayQuestion` (FIX-2241) is told the
 * row's open midway questions, read from the committed row, so its filer
 * hears them; a replay whose ask is declined tells them again, and the
 * declaration's implementer dedupes per hold (Workforce by message id). Only
 * this turn's questions are told: a decline for any other reason tells
 * nothing. The telling runs inline, before this returns.
 *
 * Once per request for the same turn and questions (`ctx.runOnce`): a durable
 * turn that resumes from a stop replays the code before it, and that replay
 * gets the first ask's answer back rather than opening the questions twice.
 *
 * @param ledger The board the task is on, as the request resolves it.
 */
export async function askMidway(
  ctx: BlockContext,
  ledger: TaskCollectionRef,
  questions: readonly { readonly kind?: "question" | "confirm"; readonly prompt: string; readonly title?: string; readonly onNo?: "cancel" | "continue" }[]
): Promise<MidwayAsk> {
  const record = admitted.get(requestKey(ctx));
  const claim = record !== undefined && record.ref.collectionId === ledger.collectionId ? record.ticket : currentWorkerClaim(ctx);
  if (claim === undefined || claim.collectionId !== ledger.collectionId) return { ok: false, reason: "no-claim" };
  const ask = ledger.ask;
  if (ask === undefined) return { ok: false, reason: "not-supported" };
  const asks = questions.map((question) => ({
    kind: question.kind ?? ("question" as const),
    prompt: question.prompt,
    ...(question.title !== undefined ? { title: question.title } : {}),
    ...(question.onNo !== undefined ? { onNo: question.onNo } : {}),
  }));
  const write = async (): Promise<MidwayAsk> => {
    const outcome = await ask(claim.taskId, asks, { claim });
    return outcome.outcome === "declined" ? { ok: false, reason: outcome.reason } : { ok: true, questions: outcome.questions ?? [] };
  };
  const key = `task-board:ask-midway:${claim.collectionId}:${claim.taskId}:${claim.attempt}:${claim.turn}:${JSON.stringify(asks)}`;
  const asked = ctx.runOnce !== undefined ? await ctx.runOnce(key, write) : await write();
  // The turn is over: its lease is gone, and nothing renews it again.
  if (asked.ok && record !== undefined) {
    record.askedQuestions = true;
    record.renewal?.stop();
  }
  // Tell the filer (FIX-2241), from the committed row: a replay whose ask is
  // declined (its lease already gone) still tells the questions this turn
  // opened. Any other decline (another turn's ticket, a row no longer
  // running) tells nothing: the row's questions aren't this turn's. Outside
  // `runOnce` on purpose: a durable replay tells again, by the same hold ids.
  if (ledger.tellMidwayQuestions !== undefined) {
    try {
      const row = await readCommittedTask(ledger, claim.taskId);
      if (row !== undefined && (asked.ok || askedOnTicket(row, claim))) await ledger.tellMidwayQuestions(row);
    } catch (error) {
      // Best effort: the question stands on the row and in the Inbox either way.
      console.warn(`[task-board] task "${claim.taskId}": its row couldn't be read to tell the filer its question; it stays in the Inbox: ${(error as Error).message}`);
    }
  }
  return asked;
}
