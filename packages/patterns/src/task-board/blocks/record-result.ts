/**
 * Write the worker's outcome back to the collection.
 *
 * Maps a `RunWorkerOutput` to either `collection.complete(taskId, output)`
 * or `collection.fail(taskId, error)`. Honors the pattern's `onError`
 * policy: with `"fail"` the recorder rethrows after writing the failure
 * so the parent sequencer's error path can fire.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { TaskCollectionRef } from "@flow-state-dev/tasks";

export interface RecordResultOptions {
  name: string;
  collection: (ctx: BlockContext) => TaskCollectionRef;
  /**
   * Failure policy. `"skip"` records `fail` and returns. `"fail"` records
   * `fail` and rethrows so the caller's sequencer fails too.
   */
  onError: "skip" | "fail";
}

export type RecordResultInput =
  | { taskId: string; ok: true; output: unknown }
  | { taskId: string; ok: false; error: string };

export interface RecordResultOutput {
  taskId: string;
  recorded: "completed" | "errored";
  /** Mirror of the input error message, for `onError: "skip"` callers. */
  error?: string;
}

export function createRecordResult(options: RecordResultOptions) {
  const { name, collection: collectionFactory, onError } = options;
  return handler({
    name,
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (
      input: RecordResultInput,
      ctx
    ): Promise<RecordResultOutput> => {
      const collection = collectionFactory(ctx);
      if (input.ok) {
        await collection.complete(input.taskId, input.output);
        return { taskId: input.taskId, recorded: "completed" };
      }

      await collection.fail(input.taskId, input.error);
      if (onError === "fail") {
        throw new Error(input.error);
      }
      return { taskId: input.taskId, recorded: "errored", error: input.error };
    },
  });
}
