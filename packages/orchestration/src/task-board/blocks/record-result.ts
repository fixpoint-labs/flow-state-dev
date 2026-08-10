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
 * The split lets the worker run as a plain `.step(workerStep)` step in
 * the sequencer — no handler wrapper around the worker, no manual
 * try/catch. The framework's rescue mechanism owns failure flow
 * (BP-011 conformance: the worker block is composed, not invoked from
 * inside another block's `execute`).
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { type TaskCollectionRef } from "../../tasks";
import { currentLeaseRenewal } from "../../tasks/lease-renewal-scope";
import { taskBoardWorkerBodyStateSchema } from "../schemas";

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
 * throws, because the body's `.rescue()` then runs `recordError` and that
 * `fail()` is fenced on the same claim. So `recordSuccess` stops renewal only
 * once its write has settled, and leaves the driver running when it throws.
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

export interface RecordSuccessOptions {
  name: string;
  collection: (ctx: BlockContext) => Promise<TaskCollectionRef>;
}

/**
 * Builds the success-path recorder. Wired into the worker pipeline as
 * `.tap(recordSuccess)` — no output is produced, the upstream worker
 * output flows through unchanged.
 */
export function createRecordSuccess(options: RecordSuccessOptions) {
  const { name, collection: collectionFactory } = options;
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
      await (await collectionFactory(ctx)).complete(claim.taskId, output, {
        ifAllowed: true,
        claim,
      });
      // Only now, and deliberately NOT in a `finally`. The write has settled —
      // recorded or declined — so this claim has nothing left to assert.
      //
      // A `finally` would stop renewal on the one path where it must not: if
      // `complete()` THREW, this block did not settle the task, and the worker
      // body's `.rescue()` is about to run `recordError`, whose `fail()` is
      // fenced on this same claim. Stopping here would hand that recovery write
      // a lapsed lease, so it would be declined `lost-claim`, and work that
      // actually finished would be recovered and repeated. The rule is not
      // "stop on the way out", it is "stop once no further fenced write can
      // follow" — and after a throw, one can.
      stopLeaseRenewal();
      await ctx.sequencer!.patchState({ currentClaim: undefined });
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
      try {
        if (claim !== undefined) {
          await (await collectionFactory(ctx)).fail(claim.taskId, message, {
            ifAllowed: true,
            claim,
          });
          await ctx.sequencer!.patchState({ currentClaim: undefined });
        }
      } finally {
        // After the fenced write, for the same reason the success path does.
        stopLeaseRenewal();
      }
      if (onError === "fail") {
        throw error instanceof Error ? error : new Error(message);
      }
      return { recorded: "errored" as const, error: message };
    },
  });
}
