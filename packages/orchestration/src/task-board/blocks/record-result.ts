/**
 * Result-recorder blocks for the Task Board worker pipeline.
 *
 * Two blocks, each scoped to one outcome:
 *
 * - `recordSuccess` — `.tap()`-shaped (per BP-012, no `outputSchema`,
 *   no `return input`). Reads `currentTaskId` from worker state, takes
 *   the worker's output as input, calls `collection.complete`. Clears
 *   `currentTaskId` when done so a stale id can't leak into a later
 *   iteration on retry.
 *
 * - `recordError` — invoked via `.rescue()` on the worker body
 *   sequencer. Receives the caught error as input, reads
 *   `currentTaskId` from worker state, calls `collection.fail`. Honors
 *   `onError`: `"skip"` swallows the error after writing the failure;
 *   `"fail"` rethrows so the parent forEach rejects.
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
      const taskId = ctx.sequencer!.state.currentTaskId;
      if (taskId === undefined) return;
      await (await collectionFactory(ctx)).complete(taskId, output);
      await ctx.sequencer!.patchState({ currentTaskId: undefined });
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
 * Reading `currentTaskId` (per-worker state) is the key correctness
 * property: each worker only knows its own claimed task, so a thrown
 * error here writes `fail` only to that one task — never to siblings'
 * concurrently-claimed work.
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
      const taskId = ctx.sequencer!.state.currentTaskId;
      const message = error instanceof Error ? error.message : String(error);
      if (taskId !== undefined) {
        await (await collectionFactory(ctx)).fail(taskId, message);
        await ctx.sequencer!.patchState({ currentTaskId: undefined });
      }
      if (onError === "fail") {
        throw error instanceof Error ? error : new Error(message);
      }
      return { recorded: "errored" as const, error: message };
    },
  });
}
