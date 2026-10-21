/**
 * A request admitted for a dispatched task, and the one check that settles
 * the task at that request's end (FIX-2077, rule 6).
 *
 * **Done** means: a request for the task ended with a result, its background
 * work ended too, no filed work still holds the task, and nothing is queued
 * for it. The claim gate admits the task's own entry (`work`, and its resume);
 * {@link taskRequestAdmission} admits the other requests for it a package
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
import { onRequestEnded, type RequestEnding } from "@flow-state-dev/core/types";
import type { DefinedCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  DEFAULT_LEASE_DURATION_MS,
  filedWorkHolds,
  ticketForClaim,
  type Task,
  type TaskClaimTicket,
  type TaskCollectionRef,
  type TaskWaitingOn,
} from "../tasks";
import { ticketNamesTask } from "../tasks/claim-ticket";
import { advisoryComplete, advisoryFail } from "../tasks/collection/advisory-write-back";
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
}

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
}

/** The requests admitted in this process, by request id. Each leaves at its request's end. */
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
  return prior === "filed" || prior === "queued";
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
          // The background signal, not the request's: the lease must outlive a
          // client's disconnect while the request's background work still runs.
          signal: ctx._requestSideChainSignal ?? ctx.signal,
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
  };
  const registered = onRequestEnded(ctx, (ending) => endRequest(key, ending));
  admitted.set(key, registered ? record : { ...record, inline: true });
  return renewal;
}

/**
 * Note the answer the running request gave, when it is one the task's
 * result can be (see {@link Admitted.answerCounts}). With no request-end seam,
 * the task is checked here.
 */
export async function noteAnswer(ctx: BlockContext, output: unknown): Promise<void> {
  const key = requestKey(ctx);
  const record = admitted.get(key);
  if (record === undefined) return;
  if (record.answerCounts) record.answer = { output };
  if (record.inline) await endRequest(key, { status: "completed" });
}

/** The request admitted for a task ended: check the task, then stop renewing its lease. */
async function endRequest(key: string, ending: RequestEnding): Promise<void> {
  const record = admitted.get(key);
  if (record === undefined) return;
  admitted.delete(key);
  try {
    await checkTask(record, ending);
  } finally {
    // After the write, never before: the write is fenced on the lease.
    record.renewal?.stop();
  }
}

/** The one check (rule 6), at the end of a request admitted for the task. */
async function checkTask(record: Admitted, ending: RequestEnding): Promise<void> {
  const { ref, ticket, ctx } = record;
  const row = ref.get(ticket.taskId);
  // Settled, retried, parked for review or taken back meanwhile: not this request's to write.
  if (!holds(ref, ticket, row)) return;
  const guards = { ifAllowed: true, claim: ticket, refuseWhenParked: true } as const;

  if (ending.status === "suspended") {
    const reason = ending.suspension?.reason;
    const stop: TaskWaitingOn = reason === "human_approval" || reason === "human_input" ? "person" : "wait";
    // A request other than the task's own that stops after the task answered
    // leaves the task waiting on what it waited on.
    await waitOn(record, row, !record.answerCounts && answeredBefore(record.prior) ? record.prior! : stop, undefined);
    return;
  }
  if (ending.status === "failed" || ending.status === "aborted" || ending.status === "interrupted") {
    await advisoryFail(ref, row.id, ending.error?.message ?? `The request working the task was ${ending.status}.`, guards);
    return;
  }

  const answered = record.answer !== undefined || answeredBefore(record.prior);
  if (!answered) {
    // The task's own request hasn't answered yet (it is suspended): it still waits on that.
    if (record.prior !== undefined) await waitOn(record, row, record.prior, undefined);
    return;
  }
  const filed = await (record.rules.filedWorkHolds ?? defaultFiledWorkHolds)(ctx, row, ref);
  const queued = filed ? false : await (record.rules.workQueued ?? noWorkQueued)(ctx, row);
  if ((filed || queued) && ref.setWaitingOn !== undefined) {
    await waitOn(record, row, filed ? "filed" : "queued", record.answer);
    return;
  }
  // Done. The latest checkpoint stays the output (the collection's rule);
  // otherwise this request's answer, or the one the task kept while it waited.
  await advisoryComplete(ref, row.id, record.answer !== undefined ? record.answer.output : row.output, guards);
}

/** Record what the task waits on, and keep `answer` as its output while it waits. */
async function waitOn(record: Admitted, row: Task, on: TaskWaitingOn, answer: { output: unknown } | undefined): Promise<void> {
  if (record.ref.setWaitingOn === undefined) return;
  await record.ref.setWaitingOn(row.id, on, { claim: record.ticket, ...(answer !== undefined ? { answer } : {}) });
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
  /** Declarations `find` needs in scope (its ledgers' resources). */
  readonly uses?: readonly DefinedCapability[];
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
    ...(options.uses !== undefined ? { uses: [...options.uses] } : {}),
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
