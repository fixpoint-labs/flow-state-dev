/**
 * Result-recorder blocks for the Task Board worker pipeline.
 *
 * Two blocks, each scoped to one outcome:
 *
 * - `recordSuccess` — `.tap()`-shaped (per BP-012, no `outputSchema`,
 *   no `return input`). Reads `currentClaim` from worker state, takes
 *   the worker's output as input, calls `collection.complete`. Clears
 *   `currentClaim` (and the `currentLedger` beside it) when done so a stale claim can't leak into a later
 *   iteration on retry.
 *
 * - `recordError` — invoked via `.rescue()` on the worker body
 *   sequencer. Receives the caught error as input, reads
 *   `currentClaim` from worker state, calls `collection.fail`. Honors
 *   `onError`: `"skip"` swallows the error after writing the failure;
 *   `"fail"` rethrows so the parent forEach rejects. A
 *   {@link TaskEndsForGoodError} ends the row on this attempt instead of
 *   re-queueing it: `fail` with `noRetry`, or `cancel`.
 *
 * Both write-backs are **advisory** (FIX-951): they pass `ifAllowed` and the
 * worker's `claim`, so a result that arrives after the task was settled by
 * someone else — a coordinator cancelled it, the worker settled it through
 * its own task tools, a lease reclaim handed it to another worker — is
 * dropped instead of throwing. The throw is what used to escape the rescue
 * and abandon every sibling task on the board.
 *
 * The write's target comes from the ticket rather than being named separately
 * (FIX-981), so "which task do I settle" and "which task may I settle" are one
 * fact and cannot disagree.
 *
 * **A write that committed and then failed to be announced is reported, not
 * swallowed** (FIX-963). Both backings announce a change as a tail call, after
 * the durable write resolves, so an announcement that throws rejects a call
 * whose write already landed. Each write is therefore correlated
 * (`beginTaskWrite` / `didWriteLand`, FIX-989) and branches three ways: a write
 * that committed nothing keeps today's path exactly, while one that committed —
 * or that the board cannot tell about — is reported on a persisted entry and,
 * where the board cannot tell, released so the row is not left claimed. See
 * {@link ./recorder-failure} for what the entry means and why it is awaited.
 *
 * **The write is shared; the exits are not** (FIX-1472). That baseline, write,
 * classify, release sequence lives once, in
 * {@link writeRethrowingIfNothingSaved}, and both recorders call it. Everything
 * that decides how a recorder *leaves* stays written out in that recorder's own
 * body: its no-claim exit, where it stops renewal and clears the
 * claim (the two recorders do those in different orders), and the tail that
 * emits the report and then raises or defers by site. The error recorder's two
 * containment guards stay two separate statements for the same reason: one is
 * fatal at every site, the other defers except at a raising one. Reading a
 * recorder top to bottom is how you see where it exits, so the shared step never
 * picks an exit and never reads the raise-or-defer setting.
 *
 * The split lets the worker run as a plain `.step(workerStep)` step in
 * the sequencer — no handler wrapper around the worker, no manual
 * try/catch. The framework's rescue mechanism owns failure flow
 * (BP-011 conformance: the worker block is composed, not invoked from
 * inside another block's `execute`).
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  beginTaskWrite,
  didWriteLand,
  type Task,
  type TaskClaimTicket,
  type TaskCollectionRef,
  type TaskWriteToken,
} from "../../tasks";
import {
  advisoryCancel,
  advisoryComplete,
  advisoryFail,
} from "../../tasks/collection/advisory-write-back";
import { currentLeaseRenewal } from "../../tasks/lease-renewal-scope";
import { taskBoardWorkerBodyStateSchema } from "../schemas";
import {
  HandedOverRowError,
  reportRecorderFailure,
  TaskBoardRecorderFailureError,
  TaskBoardReportFailureError,
  type RecorderFailureReport,
  type RecorderKind,
  type RecorderWriteVerdict,
} from "./recorder-failure";

/**
 * Stop renewing this worker's lease (FIX-1005).
 *
 * Called from both recorders because they are the board's two exits — the
 * success tap and the `.rescue()` handler — and the driver must stop on every
 * path out, not just the happy one. Reading the driver off the per-worker
 * AsyncLocalStorage seam rather than a closure is what makes that per-iteration
 * correct under concurrent fan-out.
 *
 * **Called AFTER the settlement, never before.** `complete()` and `fail()` are
 * fenced on this worker's ticket, and the fence refuses a write on a row whose
 * lease has lapsed. Stopping first therefore opens a window — the width of one
 * store round trip — in which a perfectly healthy worker's result is rejected
 * as a lost claim, the task is recovered, and every side effect it already
 * committed is repeated. That is precisely the duplicate work the lease exists
 * to prevent, produced by the lease. The reverse hazard does not exist: a
 * renewal in flight across the settlement writes only `leaseUntil`, and against
 * a row that has just been settled the fence declines it and the driver stops
 * itself.
 *
 * **The rule is "once no further fenced write can follow", not "on the way
 * out".** Those coincide for this handler's success path and for `recordError`,
 * which nothing follows — but not for `recordSuccess` when its own `complete()`
 * throws having committed nothing, because the body's `.rescue()` then runs
 * `recordError` and that `fail()` is fenced on the same claim. So
 * `recordSuccess` stops renewal only once its write has settled, and leaves the
 * driver running on that one throw.
 *
 * FIX-963 narrowed that exception rather than widening it. A `complete()` that
 * threw *after* committing — or that may have — is no longer handed to the
 * rescue at all: the recorder settles or releases the row itself and returns.
 * No fenced write can follow that, so renewal stops there like any other exit,
 * and the release write is what it stops after. Leaving the driver running on
 * the swallow path would renew a lease on a row nothing is coming back for.
 *
 * Deliberately not the *only* thing that stops a driver. It also stops when the
 * request's own signal aborts, and — the case neither recorder can see — when
 * the worker step's dispatch reports that it SUSPENDED, via the `onSettled`
 * option the board composes it with. A worker that calls `ctx.suspend()` exits
 * through NEITHER recorder (`SuspensionError` bypasses `.rescue()` by design)
 * and does not abort its signal either, so that third stop is what keeps a
 * suspended worker from renewing an `in_progress` row forever. That hook fires on
 * the returned and threw paths too, which is exactly why it must not stop on
 * them: it runs before the recorder that owns the write. The unref'd timer only
 * keeps the runtime from being held open; it does not stop the renewals.
 */
function stopLeaseRenewal(): void {
  currentLeaseRenewal()?.stop();
}

/**
 * Read a task without letting the read replace the failure being classified.
 *
 * Both callers run on a path where something has already gone wrong against a
 * ref the substrate may not have written. An unreadable task is not an error of
 * its own — it removes an input, and `didWriteLand(undefined, …)` already
 * answers *cannot tell* for exactly that case.
 */
function readTaskQuietly(
  collection: TaskCollectionRef,
  taskId: string
): Task | undefined {
  try {
    return collection.get(taskId) as Task | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Thrown when the next attempt would end the same way. The recorder ends the
 * row on this attempt, under the worker's claim, so the worker writes no
 * ending of its own. `ending` defaults to `errored`.
 *
 * It speaks only for `taskId`, the row its thrower holds: a recorder holding
 * another row (a board nested inside the worker rethrows its worker's error on
 * `onError: "fail"`) reads it as an ordinary failure.
 */
export class TaskEndsForGoodError extends Error {
  readonly taskId: string;
  readonly ending: "errored" | "cancelled";

  constructor(message: string, options: { taskId: string; ending?: "errored" | "cancelled" }) {
    super(message);
    this.name = "TaskEndsForGoodError";
    this.taskId = options.taskId;
    this.ending = options.ending ?? "errored";
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * How a settlement site reports a recorder failure (FIX-963).
 *
 * Both recorders are composed in two places — the inline drain, and the gate
 * around a task dispatched to a child run — and the difference between them is
 * entirely about *when* the run is allowed to fail.
 */
export interface RecorderFailureWiring {
  /**
   * This drain run's stamp, read at failure time. Reports accumulate on the
   * per-REQUEST item buffer and a request can drain the same board more than
   * once, so the tail filters on this rather than on collection id — a second
   * batch must not inherit the first one's failure. Omitted where there is no
   * batch.
   */
  runId?: (ctx: BlockContext) => string | undefined;
  /**
   * `"defer"` reports and returns, leaving the drain's tail to fail the run
   * once every sibling has finished. `"raise"` throws here instead.
   *
   * **`"raise"` is the default, and deferring is what has to be asked for.**
   * Deferring only works because something downstream reads the report and
   * fails the run; a recorder composed without a tail — these blocks are
   * exported, and `taskBoard()` is not the only way to reach them — would
   * otherwise report into a stream nobody checks and return successfully,
   * leaving that caller *quieter* than it was before any of this existed,
   * where the announcement's rejection simply propagated. That is this issue's
   * own defect, reintroduced one caller over. So the only site that defers is
   * the one that can name what will pick the report up.
   */
  onRecorderFailure?: "defer" | "raise";
}

/** Resolve the wiring's raise/defer choice. Absent wiring raises — see above. */
function raisesHere(wiring: RecorderFailureWiring): boolean {
  return (wiring.onRecorderFailure ?? "raise") === "raise";
}

/**
 * The recorders' shared write step: baseline, write, classify, release.
 *
 * Mints the write token from the task as it reads NOW, before the write — the
 * baseline it records is what makes `didWriteLand`'s answer mean anything, and a
 * token assembled after the fact would describe a world the write may not have
 * used (FIX-989). Then runs `attempt` with it.
 *
 * - The write did not throw: returns `undefined`.
 * - It threw and **committed nothing**: **rethrows the attempt's own error
 *   unchanged**, so the caller's next statement does not run. That is the
 *   routine case and keeps the behaviour it has always had. The name says so
 *   because on the success recorder this rethrow is an exit, and it skips the
 *   renewal stop that follows the call.
 * - It threw having committed, or the board cannot tell: returns the report to
 *   emit, after releasing the row in the cannot-tell case.
 *
 * **Mechanism only, never an exit.** It does not stop renewal, clear the claim,
 * emit the report, or raise or defer; each recorder does those itself, in its
 * own order, where they can be read. Of the wiring it takes only the run stamp,
 * and `recorder` only labels the report.
 */
async function writeRethrowingIfNothingSaved(params: {
  ctx: BlockContext;
  collection: TaskCollectionRef;
  claim: TaskClaimTicket;
  recorder: RecorderKind;
  runId: RecorderFailureWiring["runId"];
  attempt: (write: TaskWriteToken) => Promise<unknown>;
  /** The row's failure is final, so a release ends it rather than re-queueing it. */
  noRetry?: boolean;
}): Promise<RecorderFailureReport | undefined> {
  const { ctx, collection, claim, recorder, attempt } = params;
  const write = beginTaskWrite(readTaskQuietly(collection, claim.taskId));
  try {
    await attempt(write);
    return undefined;
  } catch (err) {
    const landed = didWriteLand(
      readTaskQuietly(collection, claim.taskId),
      write
    );

    // `false` — the write changed nothing. Nothing was lost and nothing is
    // uncertain, so this is not a bookkeeping failure: the error goes back the
    // way it came.
    if (landed === false) throw err;

    // `true` and `undefined` are BOTH reported, and never merged. `undefined`
    // is the permanent answer for a caller-supplied store and for rows that
    // predate write provenance, so collapsing it into either neighbour would be
    // a silent, total lie for those populations rather than an occasional one.
    const verdict: RecorderWriteVerdict =
      landed === true ? "committed" : "undetermined";

    if (verdict === "undetermined") {
      await releaseRow(collection, claim, err, params.noRetry === true);
    }

    const runId = params.runId?.(ctx);
    return {
      collectionId: collection.collectionId,
      taskId: claim.taskId,
      recorder,
      verdict,
      error: messageOf(err),
      ...(runId !== undefined ? { runId } : {}),
    };
  }
}

/**
 * Hand the row back when the board cannot tell whether its write landed.
 *
 * The rethrow this path replaces was doing more than being loud: on the success
 * recorder it handed the task to the body's `.rescue()`, whose fenced `fail()`
 * is what actually settled the row, and on the error recorder nothing followed
 * at all. Swallowing without settling would leave the task `in_progress` under
 * a lease nobody renews — recoverable only by waiting the lease out, which is a
 * worse outcome than the failure being reported.
 *
 * One fenced write serves both halves of the uncertainty: if the original write
 * did commit, the claim fence declines this one harmlessly; if it did not, this
 * settles the row (or re-queues it, where retries remain). A row whose
 * worker said its failure is final (`noRetry`) is not re-queued here either.
 *
 * Best-effort by design. Nothing is hidden by a failure here — the report still
 * goes out and the run still fails — and letting a failed *recovery* displace
 * the report would cost the caller the signal this whole path exists to give.
 */
async function releaseRow(
  collection: TaskCollectionRef,
  claim: TaskClaimTicket,
  err: unknown,
  noRetry: boolean
): Promise<void> {
  try {
    await advisoryFail(
      collection,
      claim.taskId,
      `task board could not confirm its own write: ${messageOf(err)}`,
      { ifAllowed: true, claim, ...(noRetry ? { noRetry: true } : {}) }
    );
  } catch {
    /* see above */
  }
}

export interface RecordSuccessOptions {
  name: string;
  collection: (ctx: BlockContext) => Promise<TaskCollectionRef>;
  /** Recorder-failure reporting for this settlement site (FIX-963). */
  recorderFailure?: RecorderFailureWiring;
}

/**
 * Builds the success-path recorder. Wired into the worker pipeline as
 * `.tap(recordSuccess)` — no output is produced, the upstream worker
 * output flows through unchanged.
 */
export function createRecordSuccess(options: RecordSuccessOptions) {
  const { name, collection: collectionFactory } = options;
  const wiring = options.recorderFailure ?? {};
  return handler({
    name,
    // Substrate-internal write-back; user-visible task lifecycle flows
    // through the `task-change` ComponentItem `collection.complete` emits.
    transient: true,
    inputSchema: z.unknown(),
    sequencerStateSchema: taskBoardWorkerBodyStateSchema,
    execute: async (output: unknown, ctx) => {
      const claim = ctx.sequencer!.state.currentClaim;
      if (claim === undefined) {
        // Nothing fenced to protect, so there is nothing left to keep the
        // lease alive for.
        stopLeaseRenewal();
        return;
      }
      const collection = await collectionFactory(ctx);
      // FIX-963. This call RETHROWS the write's own error untouched when the
      // write committed nothing, which is the pre-existing path: the body's
      // `.rescue()` then runs `recordError`, whose fenced `fail()` settles the
      // row — and the lease driver is deliberately still running for it,
      // because that rethrow skips the `stopLeaseRenewal()` below.
      //
      // A returned report means the write landed, or may have, and only the
      // announcement failed. That is reported rather than rethrown, and the row
      // is settled here instead of by a rescue that is no longer coming.
      const recorderFailure = await writeRethrowingIfNothingSaved({
        ctx,
        collection,
        claim,
        recorder: "complete",
        runId: wiring.runId,
        attempt: (write) =>
          advisoryComplete(collection, claim.taskId, output, {
            ifAllowed: true,
            claim,
            write,
          }),
      });
      // Only now, and deliberately NOT in a `finally`. The write has settled —
      // recorded, declined, or released above — so this claim has nothing left
      // to assert, and no further fenced write can follow.
      //
      // A `finally` would stop renewal on the one path where it must not: if
      // `complete()` threw having committed NOTHING, this block did not settle
      // the task, and the worker body's `.rescue()` is about to run
      // `recordError`, whose `fail()` is fenced on this same claim. Stopping
      // there would hand that recovery write a lapsed lease, so it would be
      // declined `lost-claim`, and work that actually finished would be
      // recovered and repeated. That path leaves through the rethrow above and
      // never reaches this line. The rule is not "stop on the way out", it is
      // "stop once no further fenced write can follow".
      stopLeaseRenewal();
      await ctx.sequencer!.patchState({ currentClaim: undefined, currentLedger: undefined });

      if (recorderFailure !== undefined) {
        // Awaited, and its own failure is caught by nothing — a board that
        // cannot report its own bookkeeping failure has nothing left to be
        // honest with (FIX-963).
        await reportRecorderFailure(ctx, recorderFailure);
        if (raisesHere(wiring)) {
          throw new TaskBoardRecorderFailureError([recorderFailure]);
        }
        // Otherwise: return quietly. The drain's tail fails the run once every
        // sibling has finished, which is what keeps being honest from costing
        // the rest of the board.
      }
    },
  });
}

export interface RecordErrorOptions {
  name: string;
  collection: (ctx: BlockContext) => Promise<TaskCollectionRef>;
  /**
   * Failure policy. `"skip"` swallows after writing the failure.
   * `"fail"` rethrows so the worker sequencer fails — propagates up
   * through `.forEach`, surfacing on the board's parent.
   */
  onError: "skip" | "fail";
  /** Recorder-failure reporting for this settlement site (FIX-963). */
  recorderFailure?: RecorderFailureWiring;
}

/**
 * Builds the rescue-path recorder. Wired into the worker body as
 * `.rescue([{ block: recordError }])`.
 *
 * Reading `currentClaim` (per-worker state) is the key correctness
 * property: each worker only knows its own claimed task, so a thrown
 * error here writes `fail` only to that one task — never to siblings'
 * concurrently-claimed work. Presenting the same claim is what makes that
 * property hold at the substrate too, rather than resting on this block
 * reading the right slot.
 */
export function createRecordError(options: RecordErrorOptions) {
  const { name, collection: collectionFactory, onError } = options;
  const wiring = options.recorderFailure ?? {};
  return handler({
    name,
    // Substrate-internal failure write-back; the failure is surfaced
    // via `task-change kind:"errored"` on the collection.
    transient: true,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    sequencerStateSchema: taskBoardWorkerBodyStateSchema,
    execute: async (error: unknown, ctx) => {
      const claim = ctx.sequencer!.state.currentClaim;
      const message = error instanceof Error ? error.message : String(error);
      const forGood =
        error instanceof TaskEndsForGoodError && claim !== undefined && error.taskId === claim.taskId
          ? error.ending
          : undefined;
      const recorded = forGood === "cancelled" ? ("cancelled" as const) : ("errored" as const);

      // A report that could not be DELIVERED is fatal wherever it happens, and
      // is never written to the row or swallowed by `onError`. The deferral
      // every other path relies on works by leaving the report on the stream
      // for the drain's tail to find; when the emission itself failed there is
      // nothing there to find, so there is nothing to defer to.
      if (error instanceof TaskBoardReportFailureError) {
        stopLeaseRenewal();
        throw error;
      }

      // A plan drain that failed past its hand-over: the row is another
      // session's, so there is nothing of this request's to record on it, and
      // `skip` swallowing it would leave the drain waiting on nothing. The
      // plan fails instead (see `dispatch-row.ts`).
      if (error instanceof HandedOverRowError) {
        stopLeaseRenewal();
        throw error;
      }

      // A recorder failure raised by the success tap at THIS site arrives here
      // as the rescued error. It is never swallowed by `onError` and never
      // written to the row: the tap already settled and released it, the claim
      // is already cleared, and the raise exists precisely to leave.
      //
      // Scoped to a raising site on purpose. At a deferring site the same class
      // can arrive from a board nested inside this worker, whose own tail
      // already failed its own run — rethrowing that here would reject THIS
      // board's fan-out and abandon its siblings, which is the containment
      // FIX-951 shipped. From this board's point of view a nested board blowing
      // up is a worker going wrong, and that is what `onError` is for.
      if (
        raisesHere(wiring) &&
        error instanceof TaskBoardRecorderFailureError
      ) {
        stopLeaseRenewal();
        throw error;
      }

      let recorderFailure: RecorderFailureReport | undefined;
      try {
        if (claim !== undefined) {
          const collection = await collectionFactory(ctx);
          // FIX-963, and this is the half that was worse than the filed one:
          // before it, nothing caught a throw from this write, so it escaped
          // the rescue it runs inside, the `forEach` rejected, and every task
          // that had not started was abandoned.
          //
          // This call still RETHROWS the write's own error untouched when the
          // write committed nothing — a store that is simply down on a task
          // the worker still holds has nothing to do with that issue and
          // keeps reaching the caller. The claim stays set on that path; the
          // `finally` below still stops renewal.
          recorderFailure = await writeRethrowingIfNothingSaved({
            ctx,
            collection,
            claim,
            recorder: "fail",
            runId: wiring.runId,
            ...(forGood !== undefined ? { noRetry: true } : {}),
            attempt: (write) =>
              forGood === "cancelled"
                ? advisoryCancel(collection, claim.taskId, message, {
                    ifAllowed: true,
                    claim,
                    write,
                  })
                : advisoryFail(collection, claim.taskId, message, {
                    ifAllowed: true,
                    claim,
                    write,
                    ...(forGood === "errored" ? { noRetry: true } : {}),
                  }),
          });
          await ctx.sequencer!.patchState({ currentClaim: undefined, currentLedger: undefined });
        }
      } finally {
        // After the fenced write — including the release one — for the same
        // reason the success path does. Nothing follows this recorder, so the
        // rule's two halves coincide here.
        stopLeaseRenewal();
      }

      if (recorderFailure !== undefined) {
        // Awaited, and its own failure is caught by nothing (FIX-963).
        await reportRecorderFailure(ctx, recorderFailure);
        if (raisesHere(wiring)) {
          throw new TaskBoardRecorderFailureError([recorderFailure]);
        }
        // `onError` is deliberately not consulted. It is a policy about a task
        // going wrong, and the board's own bookkeeping falling over is not a
        // task outcome — the run fails at the drain's tail either way. Taking
        // `onError`'s throw here instead would reject the fan-out and abandon
        // every task that had not started, which is the defect this branch
        // exists to remove.
        return { recorded, error: message };
      }

      if (onError === "fail") {
        throw error instanceof Error ? error : new Error(message);
      }
      return { recorded, error: message };
    },
  });
}

/**
 * Settle a dispatched task's claim from the claim gate's check at its
 * request's end (FIX-2077), with the recorders' write semantics (FIX-963):
 * `settle` is the fenced write (a completion or a failure), run under a write
 * token so a write that threw can be classified.
 *
 * - The write didn't throw: `undefined`.
 * - It threw and committed nothing: a completion fails the attempt instead,
 *   as the gate's rescue would; when that write throws too, its error comes
 *   back. A failure's own error comes back.
 * - It threw having committed, or the board can't tell: the report is emitted
 *   on its saved entry (and the row released when it can't tell), and a
 *   {@link TaskBoardRecorderFailureError} comes back.
 *
 * Returns the failure rather than raising it: the check runs after the
 * request's record is written, and the engine turns a failure the check hands
 * back into the request's own (`onRequestEnded`).
 */
export async function settleAtRequestEnd(params: {
  ctx: BlockContext;
  collection: TaskCollectionRef;
  claim: TaskClaimTicket;
  recorder: RecorderKind;
  settle: (write: TaskWriteToken) => Promise<unknown>;
}): Promise<Error | undefined> {
  const { ctx, collection, claim } = params;
  let report: RecorderFailureReport | undefined;
  try {
    report = await writeRethrowingIfNothingSaved({
      ctx,
      collection,
      claim,
      recorder: params.recorder,
      runId: undefined,
      attempt: params.settle,
    });
  } catch (err) {
    if (params.recorder === "fail") return err instanceof Error ? err : new Error(messageOf(err));
    // Nothing was saved: fail the attempt, the rescue's write.
    try {
      await advisoryFail(collection, claim.taskId, messageOf(err), { ifAllowed: true, claim });
      return undefined;
    } catch (failed) {
      return failed instanceof Error ? failed : new Error(messageOf(failed));
    }
  }
  if (report === undefined) return undefined;
  await reportRecorderFailure(ctx, report);
  return new TaskBoardRecorderFailureError([report]);
}
