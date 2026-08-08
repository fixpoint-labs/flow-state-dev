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
import type { TaskCollectionRef } from "../../tasks";
import { taskBoardWorkerBodyStateSchema } from "../schemas";

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
      if (claim === undefined) return;
      await (await collectionFactory(ctx)).complete(claim.taskId, output, {
        ifAllowed: true,
        claim,
      });
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
      if (claim !== undefined) {
        await (await collectionFactory(ctx)).fail(claim.taskId, message, {
          ifAllowed: true,
          claim,
        });
        await ctx.sequencer!.patchState({ currentClaim: undefined });
      }
      if (onError === "fail") {
        throw error instanceof Error ? error : new Error(message);
      }
      return { recorded: "errored" as const, error: message };
    },
  });
}
