/**
 * A request admitted for a dispatched task, and the one check that settles
 * the task at that request's end (FIX-2077, rule 6).
 *
 * **Done** means: a request for the task ended with a result, its background
 * work ended too, no steer is untaken by its attempt, no filed work still
 * holds the task, and nothing is queued for it. The claim gate admits the
 * task's own entry (`work`, and its resume); {@link taskRequestAdmission} admits the other requests for it a package
 * runs in the task's session (a notice of a piece's ending, a queued
 * message). Every one of them ends at the same check, which runs after the
 * engine's last drain through its request-end seam (`onRequestEnded`), on every
 * way the request can end:
 *
 * - **completed** — the check. Done: the row completes with the latest
 *   checkpoint its worker reported, else the last answer a request that
 *   counts gave (the entry's, or a woken turn's; a message's never). Not done:
 *   the row records what holds it (`waitingOn`, `"filed"` or `"queued"`),
 *   keeps that answer as its output, and drops its lease, so no reclaim takes
 *   it back. The next request admitted for it checks again.
 * - **a steer no request of its attempt took** (FIX-2086 D2): one more turn
 *   before it settles. The check owes the task session's steer entry a wake,
 *   records `waitingOn: "steer"` with no lease (the answer kept as for any
 *   wait), and starts that entry at once; the entry admits a same-attempt
 *   request whose message is the steer, and its end checks again. Each turn
 *   takes at least one steer, so the steer cap bounds the turns.
 * - **suspended** — the row records the stop (`"person"` for a person's,
 *   `human_approval` or `human_input`; `"wait"` for any other) and drops its
 *   lease (D1). The resume is admitted like any request.
 * - **failed, aborted, interrupted** — the attempt fails, where it does today
 *   (a gate's rescue has usually done it already, and then this writes
 *   nothing).
 *
 * **Admission** re-mints the claim from the row, clears `waitingOn`, and gives
 * the row a lease again, renewed until the request ends. Only the task's own
 * entry is admitted while no request waits: any other request is admitted
 * only while the task is waiting, so two requests never check it at once.
 *
 * A context with no request-end seam (a hand-built test context) admits
 * nothing outside the gate, and the gate checks at its entry's last step.
 */
import { handler } from "@flow-state-dev/core";
import { dispatchThroughSeam, onRequestEnded, type RequestEndVerdict, type RequestEnding } from "@flow-state-dev/core/types";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  DEFAULT_LEASE_DURATION_MS,
  filedWorkHolds,
  readCommittedTask,
  ticketForClaim,
  untakenSteers,
  type Task,
  type TaskClaimTicket,
  type TaskCollectionRef,
  type TaskWaitingOn,
} from "../tasks";
import { ticketNamesTask } from "../tasks/claim-ticket";
import { advisoryComplete, advisoryFail } from "../tasks/collection/advisory-write-back";
import { settleAtRequestEnd } from "./blocks/record-result";
import { startLeaseRenewal, type LeaseRenewalDriver } from "../tasks/lease-renewal";
import { stampLeaseRenewal, withLeaseRenewalScope } from "../tasks/lease-renewal-scope";
import { openWorkerClaimScope, stampCurrentClaim } from "./flow-policy-wiring";

/** What else holds a task open at a request's end, beside its own request (rule 6). */
export interface TaskEndRules {
  /**
   * Whether work the task filed still holds it. Default: a row on the task's
   * own ledger it filed (`filedByTask`) that is open or still owes its ending
   * (`filedWorkHolds`).
   */
  filedWorkHolds?: (ctx: BlockContext, task: Task, ledger: TaskCollectionRef) => Promise<boolean>;
  /**
   * Whether work is queued for the task that has not run: a durable record a
   * later request will act on, never a process's own queue. Default: none.
   */
  workQueued?: (ctx: BlockContext, task: Task) => Promise<boolean>;
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
  /** Whether this request's answer is the task's result: the entry's and a woken turn's are, a message's isn't. */
  readonly answerCounts: boolean;
  /** What the row waited on when this request was admitted. */
  readonly prior: TaskWaitingOn | undefined;
  readonly rules: TaskEndRules;
  /** The answer this request gave, once it gave one that counts. */
  answer?: { output: unknown };
  /** No request-end seam: the check runs where the answer is noted. */
  readonly inline: boolean;
  /**
   * The task's own request (its entry, or that entry's resume), rather than a
   * later one admitted for it while it waits (a notice, a message).
   */
  readonly own: boolean;
}

/**
 * The requests admitted in this process, by request id. Each leaves at its
 * request's end. Requests for the same task are serialized by admission, not
 * by this map: a task session's notices and messages run one at a time on its
 * line, and the task's own request is told from later ones by `own`.
 */
const admitted = new Map<string, Admitted>();

function requestKey(ctx: BlockContext): string {
  return ctx.request.identity.id;
}

/** Whether the row is still on the claim `ticket` names: same row, same attempt, running. */
function holds(ref: TaskCollectionRef, ticket: TaskClaimTicket, row: Task | undefined): row is Task {
  return (
    row !== undefined &&
    ticketNamesTask(ticket, ref.collectionId, row) &&
    row.status === "in_progress" &&
    row.attempts === ticket.attempt
  );
}

/** A task's request ended with a result that settles it, or that the next request picks up. */
function answeredBefore(prior: TaskWaitingOn | undefined): boolean {
  return prior === "filed" || prior === "queued" || prior === "steer";
}

/**
 * Admit the running request for a task whose claim it holds: clear what the
 * row waited on, give it a lease again, renew it until the request ends, and
 * check the task at that end.
 *
 * @returns the lease renewal driver, when the row holds a lease to renew.
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
): Promise<LeaseRenewalDriver | undefined> {
  const { ref, ticket } = options;
  let row = options.row;
  const prior = row.waitingOn ?? undefined;
  if (prior !== undefined && ref.setWaitingOn !== undefined) {
    const span = row.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    const outcome = await ref.setWaitingOn(row.id, null, { claim: ticket, leaseUntil: ref.now() + span });
    if (outcome.outcome === "declined") {
      throw (options.onStale ?? ((reason: string) => new Error(`[task-board] task "${row.id}" could not be admitted: ${reason}`)))(
        outcome.reason
      );
    }
    row = ref.get(row.id) ?? row;
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
    rules: options.rules ?? {},
    inline: false,
    own: options.own,
  };
  // The hook closes over its own record: a resume reuses the request id, so a
  // hook from the run before it must never check (or drop) the resume's record.
  const registered = onRequestEnded(ctx, (ending) => endRequest(key, record, ending));
  admitted.set(key, registered ? record : { ...record, inline: true });
  return renewal;
}

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
async function endRequest(key: string, record: Admitted, ending: RequestEnding): Promise<RequestEndVerdict | undefined> {
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

/** The guards every write of the check presents: advisory, fenced on the claim, a review park left alone. */
const guardsOf = (ticket: TaskClaimTicket) => ({ ifAllowed: true, claim: ticket, refuseWhenParked: true }) as const;

/** Whether a request ending is one that fails the attempt. */
const failsTheAttempt = (status: RequestEnding["status"]) =>
  status === "failed" || status === "aborted" || status === "interrupted";

/** The one check (rule 6), at the end of a request admitted for the task. A failure to record comes back. */
async function checkTask(record: Admitted, ending: RequestEnding): Promise<Error | undefined> {
  const { ref, ticket } = record;
  const row = ref.get(ticket.taskId);
  // Settled, retried, parked for review or taken back meanwhile: not this request's to write.
  if (!holds(ref, ticket, row)) return undefined;
  // A later request (a notice, a message) while the task's own request is
  // suspended settles nothing and fails nothing: the task still waits on that
  // request, and keeps an answer this one gave that counts.
  if (!record.own && waitsOnItsOwnRequest(record.prior)) return waitOn(record, row, record.prior!, record.answer);
  if (ending.status === "suspended") return waitOn(record, row, stopOf(record, ending), undefined);
  if (failsTheAttempt(ending.status)) {
    const message = ending.error?.message ?? `The request working the task was ${ending.status}.`;
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

/** A task whose own request stopped (a person, a wait) and has not ended. */
function waitsOnItsOwnRequest(prior: TaskWaitingOn | undefined): boolean {
  return prior === "person" || prior === "wait";
}

/**
 * What a suspended request leaves the task waiting on: a person, for a stop
 * that asks one, or another wait. A request other than the task's own that
 * stops after the task answered leaves it waiting on what it waited on.
 */
function stopOf(record: Admitted, ending: RequestEnding): TaskWaitingOn {
  if (!record.own && answeredBefore(record.prior)) return record.prior!;
  const reason = ending.suspension?.reason;
  return reason === "human_approval" || reason === "human_input" ? "person" : "wait";
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
    if (record.prior !== undefined) return waitOn(record, row, record.prior, undefined);
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
    if (ref.setWaitingOn !== undefined) return waitOn(record, row, holding, record.answer);
    // A ref that can't record a wait: leave the task running on its lease,
    // which lapses with nothing renewing it, rather than settle it early.
    console.warn(
      `[task-board] task "${row.id}" is still held by ${holding} work, and its ledger "${ref.collectionId}" ` +
        "has no setWaitingOn; it stays running on its lease."
    );
    return undefined;
  }
  // Done. The latest checkpoint stays the output (the collection's rule);
  // otherwise this request's answer, or the one the task kept while it waited.
  const output = record.answer !== undefined ? record.answer.output : row.output;
  // A steer that lands after the read above, while held work was checked,
  // would be settled over: the complete itself declines on an untaken steer,
  // where a turn can be owed for it, and the check runs once more.
  const fenceSteers = !noProgress && !rechecked && record.rules.steerTurn !== undefined && ref.setWaitingOn !== undefined;
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
  if (!holds(ref, ticket, fresh)) return undefined;
  return checkAnswered(record, fresh, true);
}

/** What else holds the task open: work it filed, then work queued for it, or nothing. */
async function holdingWork(record: Admitted, row: Task): Promise<"filed" | "queued" | undefined> {
  const { ref, ctx, rules } = record;
  if (await (rules.filedWorkHolds ?? defaultFiledWorkHolds)(ctx, row, ref)) return "filed";
  if (await (rules.workQueued ?? noWorkQueued)(ctx, row)) return "queued";
  return undefined;
}

/**
 * Record what the task waits on, and keep `answer` as its output while it
 * waits. A ref without `setWaitingOn` keeps its lease instead.
 *
 * Work queued for the task keeps the claim's lease, one span from now: it is
 * about to run, and its request renews the lease once admitted. If it never
 * runs (its dispatch lost to a restart), the lapse takes the task back, as for
 * a worker that died, rather than leave it waiting with nothing to wake it.
 */
async function waitOn(record: Admitted, row: Task, on: TaskWaitingOn, answer: { output: unknown } | undefined): Promise<undefined> {
  if (record.ref.setWaitingOn === undefined) return undefined;
  const lease = on === "queued" ? { leaseUntil: record.ref.now() + (row.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS) } : {};
  await record.ref.setWaitingOn(row.id, on, { claim: record.ticket, ...lease, ...(answer !== undefined ? { answer } : {}) });
  return undefined;
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
  if (entry === undefined || ref.setWaitingOn === undefined) return false;
  const wakes = ctx.requestHost?.wakes;
  try {
    await wakes?.owe({ entry, dueAt: ref.now() + STEER_TURN_DUE_MS });
  } catch (error) {
    console.warn(`[task-board] the wake for task "${row.id}"'s steer turn couldn't be written; its start runs now only`, {
      error: (error as Error).message,
    });
  }
  await waitOn(record, row, "steer", record.answer);
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

const defaultFiledWorkHolds: NonNullable<TaskEndRules["filedWorkHolds"]> = async (_ctx, task, ledger) =>
  filedWorkHolds(ledger, task.id);

const noWorkQueued: NonNullable<TaskEndRules["workQueued"]> = async () => false;

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
  /** Whether this entry's answer can be the task's result (a woken turn's can; a message's can't). */
  readonly answerCounts: boolean;
  /** What else holds the task open, as on the gate. */
  readonly endRules?: TaskEndRules;
  /** Whether the turn this request runs is a task turn (`isTaskTurn`). Default `true`. */
  readonly taskTurn?: boolean;
}

/**
 * Admit a request for a task that is waiting, as the head of its entry:
 * `.tap(taskRequestAdmission({ ... }))`, first in the entry's sequencer, and
 * `.tap(noteTaskAnswer)` after the turn whose answer counts. The request then
 * holds the task's claim (its tools write as the worker, `reportProgress`
 * included), renews its lease, and checks the task at its end.
 *
 * A task that is not waiting (no `waitingOn`) is left to the request working
 * it, and this request is admitted for nothing.
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
        if (row.status !== "in_progress" || row.waitingOn == null) return;
        const ticket = ticketForClaim(ref.collectionId, row, ref.partition);
        const renewal = await admitClaimedTask(ctx as never, {
          ref,
          row,
          ticket,
          answerCounts: options.answerCounts,
          own: false,
          ...(options.endRules !== undefined ? { rules: options.endRules } : {}),
        });
        stampCurrentClaim(ticket, ctx as never, { taskTurn: options.taskTurn !== false });
        if (renewal !== undefined) stampLeaseRenewal(renewal);
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
