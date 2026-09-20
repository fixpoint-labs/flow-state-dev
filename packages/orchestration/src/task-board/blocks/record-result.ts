/**
 * Result-recorder blocks for the Task Board worker pipeline.
 *
 * Two blocks, each scoped to one outcome:
 *
 * - `recordSuccess` — `.tap()`-shaped (per BP-012, no `outputSchema`,
 *   no `return input`). Reads `currentClaim` from worker state, takes
 *   the worker's output as input, calls `collection.complete`. Clears
 *   `currentClaim` when done so a stale claim can't leak into a later
 *   iteration on retry.
 *
 * - `recordError` — invoked via `.rescue()` on the worker body
 *   sequencer. Receives the caught error as input, reads
 *   `currentClaim` from worker state, calls `collection.fail`. Honors
 *   `onError`: `"skip"` swallows the error after writing the failure;
 *   `"fail"` rethrows so the parent forEach rejects.
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
 * **Neither recorder writes to a row the worker parked for review** (FIX-1234).
 * A worker that calls `awaitReview()` on its own task has handed that row to a
 * human, and both `parked → completed` and `parked → errored`
 * are legal transitions the ticket fence admits — so without an explicit status
 * read the park did not survive the very next step. See
 * {@link workerParkedItForReview}.
 *
 * **A write that committed and then failed to be announced is reported, not
 * swallowed** (FIX-963). Both backings announce a change as a tail call, after
 * the durable write resolves, so an announcement that throws rejects a call
 * whose write already landed. Each recorder therefore correlates its own write
 * (`beginTaskWrite` / `didWriteLand`, FIX-989) and branches three ways: a write
 * that committed nothing keeps today's path exactly, while one that committed —
 * or that the board cannot tell about — is reported on a persisted entry and,
 * where the board cannot tell, released so the row is not left claimed. See
 * {@link ./recorder-failure} for what the entry means and why it is awaited.
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
  advisoryComplete,
  advisoryFail,
} from "../../tasks/collection/advisory-write-back";
import { currentLeaseRenewal } from "../../tasks/lease-renewal-scope";
import { taskBoardWorkerBodyStateSchema } from "../schemas";
import {
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
 * parked worker from renewing an `in_progress` row forever. That hook fires on
 * the returned and threw paths too, which is exactly why it must not stop on
 * them: it runs before the recorder that owns the write. The unref'd timer only
 * keeps the runtime from being held open; it does not stop the renewals.
 */
function stopLeaseRenewal(): void {
  currentLeaseRenewal()?.stop();
}

/**
 * Did the worker park this row for a human before it left (FIX-1234)?
 *
 * Both recorders ask before they write, and a `true` answer means **write
 * nothing**: the row is not this worker's to settle any more.
 *
 * ## Why the ticket fence does not already cover this
 *
 * Every write below is advisory — `ifAllowed` plus the worker's claim — so the
 * natural assumption is that a row the worker moved out from under itself is
 * refused anyway. It is not. The claim ticket admits a row in `in_progress` *or*
 * `parked` (a parked row is still that attempt's row, which is what
 * lets a worker resume and settle it later), and `parked → completed`
 * and `parked → errored` are both legal transitions. So a worker that
 * called `awaitReview()` on its own task and then returned normally had that
 * task **completed** by the success tap a moment later: the park never survived
 * the step that follows it, `onReview: "exit"` had nothing to excuse, and the
 * HITL surface the substrate documents did not work from inside a worker at all.
 *
 * The status is therefore read explicitly, and it is read on **every** board
 * rather than only on one that declared `onReview: "exit"`. A worker parking its
 * own row is a deliberate, recorded transition on any board; silently undoing it
 * is wrong wherever it happens, and gating the guard on board configuration
 * would leave the same defect standing on the default.
 *
 * ## This read is an optimisation. The guarantee is in the write.
 *
 * An earlier version of this comment claimed the read was "the conservative
 * direction, not a race", on the grounds that a resume landing between the read
 * and the write moves the row to `pending`, which the fence declines anyway.
 * That is true of a **resume** and false of a **park**, and the difference is
 * the whole point: `parked` is in `ATTEMPT_OWNED_STATUSES`, so a
 * concurrent park lands the row in a status this attempt still owns and one that
 * `parked → completed` / `→ errored` can legally leave. Nothing in the
 * fence refused it, so a park arriving in that window was overwritten — the
 * defect this guard exists to stop, reachable through the guard itself.
 *
 * So the refusal now lives in `transitionDeclineReason`, evaluated inside the
 * atomic write against committed state, and returns `parked`. A check that has
 * to win a race can be wrong; a check the write cannot bypass cannot be.
 *
 * What this read still buys is skipping work the substrate would decline —
 * resolving nothing, emitting nothing, and leaving the reason in one place
 * rather than in a discarded verdict. Deleting it would change no outcome.
 */
function workerParkedItForReview(
  collection: TaskCollectionRef,
  taskId: string
): boolean {
  return collection.get(taskId)?.status === "parked";
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

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * How a settlement site reports a recorder failure (FIX-963).
 *
 * Both recorders are composed in two places — the inline drain, and the gate
 * around a task handed off to a child run — and the difference between them is
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
   * `"defer"` (the default) reports and returns, leaving the drain's tail to
   * fail the run once every sibling has finished — the ordering BR-8 makes
   * non-negotiable. `"raise"` throws here instead, for a settlement with no
   * tail to raise at.
   */
  onRecorderFailure?: "defer" | "raise";
}

/**
 * Classify a recorder write that threw, and leave the row recoverable.
 *
 * Returns the report to emit. **Rethrows the caller's own error unchanged**
 * when the write demonstrably committed nothing — that is the routine case and
 * keeps the behaviour it has always had.
 */
async function classifyAndRelease(params: {
  ctx: BlockContext;
  collection: TaskCollectionRef;
  claim: TaskClaimTicket;
  recorder: RecorderKind;
  write: TaskWriteToken;
  err: unknown;
  wiring: RecorderFailureWiring;
}): Promise<RecorderFailureReport> {
  const { ctx, collection, claim, recorder, write, err, wiring } = params;
  const landed = didWriteLand(readTaskQuietly(collection, claim.taskId), write);

  // `false` — the write changed nothing. Nothing was lost and nothing is
  // uncertain, so this is not a bookkeeping failure: the error goes back the
  // way it came.
  if (landed === false) throw err;

  // `true` and `undefined` are BOTH reported, and never merged. `undefined` is
  // the permanent answer for a caller-supplied store and for rows that predate
  // write provenance, so collapsing it into either neighbour would be a silent,
  // total lie for those populations rather than an occasional one.
  const verdict: RecorderWriteVerdict =
    landed === true ? "committed" : "undetermined";

  if (verdict === "undetermined") {
    await releaseRow(collection, claim, err);
  }

  const runId = wiring.runId?.(ctx);
  return {
    collectionId: collection.collectionId,
    taskId: claim.taskId,
    recorder,
    verdict,
    error: messageOf(err),
    ...(runId !== undefined ? { runId } : {}),
  };
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
 * settles the row (or re-queues it, where retries remain).
 *
 * Best-effort by design. Nothing is hidden by a failure here — the report still
 * goes out and the run still fails — and letting a failed *recovery* displace
 * the report would cost the caller the signal this whole path exists to give.
 */
async function releaseRow(
  collection: TaskCollectionRef,
  claim: TaskClaimTicket,
  err: unknown
): Promise<void> {
  try {
    await advisoryFail(
      collection,
      claim.taskId,
      `task board could not confirm its own write: ${messageOf(err)}`,
      { ifAllowed: true, claim, refuseWhenParked: true }
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
      if (workerParkedItForReview(collection, claim.taskId)) {
        // The worker handed this row to a human and then returned. It owes the
        // substrate no result, so nothing is written — but it IS done with the
        // row, so the two pieces of bookkeeping below still run. Stopping
        // renewal here is safe for the reason the block comment above gives:
        // the rule is "once no further fenced write can follow", and on this
        // path there is no write at all and no `.rescue()` to come, because the
        // worker returned normally. Leaving the driver running would renew a
        // lease on a row the lease has deliberately stopped governing.
        stopLeaseRenewal();
        await ctx.sequencer!.patchState({ currentClaim: undefined });
        return;
      }
      // Minted from the task as it reads NOW, before the write — the baseline
      // it records is what makes `didWriteLand`'s answer mean anything, and a
      // token assembled after the fact would describe a world the write may not
      // have used (FIX-989).
      const write = beginTaskWrite(readTaskQuietly(collection, claim.taskId));
      let recorderFailure: RecorderFailureReport | undefined;
      try {
        await advisoryComplete(collection, claim.taskId, output, {
          ifAllowed: true,
          claim,
          // The guarantee. The status read above can be raced by a park; this
          // cannot, because it is evaluated inside the same atomic write.
          refuseWhenParked: true,
          write,
        });
      } catch (err) {
        // FIX-963. `classifyAndRelease` rethrows `err` untouched when the write
        // committed nothing, which is the pre-existing path: the body's
        // `.rescue()` then runs `recordError`, whose fenced `fail()` settles the
        // row — and the lease driver is deliberately still running for it,
        // because this `throw` skips the `stopLeaseRenewal()` below.
        //
        // Everything else means the write landed, or may have, and only the
        // announcement failed. That is reported rather than rethrown, and the
        // row is settled here instead of by a rescue that is no longer coming.
        recorderFailure = await classifyAndRelease({
          ctx,
          collection,
          claim,
          recorder: "complete",
          write,
          err,
          wiring,
        });
      }
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
      await ctx.sequencer!.patchState({ currentClaim: undefined });

      if (recorderFailure !== undefined) {
        // Awaited, and its own failure is caught by nothing — a board that
        // cannot report its own bookkeeping failure has nothing left to be
        // honest with (BR-13).
        await reportRecorderFailure(ctx, recorderFailure);
        if (wiring.onRecorderFailure === "raise") {
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

      // A report that could not be DELIVERED is fatal wherever it happens, and
      // is never written to the row or swallowed by `onError`. The deferral
      // every other path relies on works by leaving the report on the stream
      // for the drain's tail to find; when the emission itself failed there is
      // nothing there to find, so there is nothing to defer to.
      if (error instanceof TaskBoardReportFailureError) {
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
        wiring.onRecorderFailure === "raise" &&
        error instanceof TaskBoardRecorderFailureError
      ) {
        stopLeaseRenewal();
        throw error;
      }

      let recorderFailure: RecorderFailureReport | undefined;
      try {
        if (claim !== undefined) {
          const collection = await collectionFactory(ctx);
          // The mirror of the success path (FIX-1234), and it matters more here
          // than it looks. `fail()` on a parked row does not merely overwrite
          // the park: on a task carrying `maxAttempts` it RE-PENDS the row for
          // another attempt, so a worker that parked for a human and then threw
          // would put that row back in the queue and a sibling worker would run
          // it — while the human is still being asked. The park is an explicit
          // decision the worker recorded; a throw afterwards is about the
          // worker, not about the row.
          //
          // The error is not swallowed by this: it still reaches `onError`
          // below, which rethrows on `"fail"` and reports it on `"skip"`.
          if (!workerParkedItForReview(collection, claim.taskId)) {
            // Minted before the write, from the task as it reads now (FIX-989).
            const write = beginTaskWrite(
              readTaskQuietly(collection, claim.taskId)
            );
            try {
              await advisoryFail(collection, claim.taskId, message, {
                ifAllowed: true,
                claim,
                refuseWhenParked: true,
                write,
              });
            } catch (err) {
              // FIX-963, and this is the half that was worse than the filed
              // one: today nothing catches this at all, so the throw escapes
              // the rescue it is running inside, the `forEach` rejects, and
              // every task that had not started is abandoned.
              //
              // `classifyAndRelease` still rethrows `err` untouched when the
              // write committed nothing — a store that is simply down on a task
              // the worker still holds has nothing to do with this issue and
              // keeps reaching the caller.
              recorderFailure = await classifyAndRelease({
                ctx,
                collection,
                claim,
                recorder: "fail",
                write,
                err,
                wiring,
              });
            }
          }
          await ctx.sequencer!.patchState({ currentClaim: undefined });
        }
      } finally {
        // After the fenced write — including the release one — for the same
        // reason the success path does. Nothing follows this recorder, so the
        // rule's two halves coincide here.
        stopLeaseRenewal();
      }

      if (recorderFailure !== undefined) {
        // Awaited, and its own failure is caught by nothing (BR-13).
        await reportRecorderFailure(ctx, recorderFailure);
        if (wiring.onRecorderFailure === "raise") {
          throw new TaskBoardRecorderFailureError([recorderFailure]);
        }
        // `onError` is deliberately not consulted. It is a policy about a task
        // going wrong, and the board's own bookkeeping falling over is not a
        // task outcome — the run fails at the drain's tail either way. Taking
        // `onError`'s throw here instead would reject the fan-out and abandon
        // every task that had not started, which is the defect this branch
        // exists to remove.
        return { recorded: "errored" as const, error: message };
      }

      if (onError === "fail") {
        throw error instanceof Error ? error : new Error(message);
      }
      return { recorded: "errored" as const, error: message };
    },
  });
}
