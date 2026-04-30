/**
 * Atomic claim block.
 *
 * Calls the configured dispatcher's `claim` to flip the next eligible
 * task to `in_progress` against the calling worker. Outputs a typed
 * `ClaimResult` describing whether something was claimed and (if so)
 * the claimed task. Side-channels the claim outcome onto the worker's
 * sequencer state (`currentTaskId`, `lastClaimed`) so downstream
 * `recordSuccess` / `recordError` / `checkBoard` can read it without
 * threading the value through `.thenIf` branches.
 *
 * The substrate's CAS retry inside `collection.claim` guarantees
 * exactly-once dispatch under contention; this block simply surfaces
 * that semantic to the pattern layer.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { TaskCollectionRef, TaskDispatcher } from "@flow-state-dev/tasks";
import {
  claimResultSchema,
  taskBoardWorkerStateSchema,
  type ClaimResult,
} from "../schemas";

export interface ClaimTaskOptions {
  name: string;
  collection: (ctx: BlockContext) => TaskCollectionRef;
  dispatcher: TaskDispatcher;
  /**
   * Worker-id resolver. The pattern stamps `worker-${index}` per worker;
   * remixers can pass any function that produces a stable string per
   * caller. Used for trace attribution; does not affect routing.
   */
  workerId: (ctx: BlockContext) => string;
}

export type ClaimTaskOutput = ClaimResult;

export function createClaimTask(options: ClaimTaskOptions) {
  const { name, collection: collectionFactory, dispatcher, workerId } = options;
  return handler({
    name,
    // Substrate-internal worker-loop block: a single idle worker can
    // run claim every `idlePollMs` for the lifetime of the board, so
    // its `block_output` trace is the highest-volume noise in the
    // session item stream. Mark transient so the auto-emitted trace
    // is filtered out of client subscriptions and history replay —
    // task-level outcomes flow through `task-change` items instead.
    transient: true,
    inputSchema: z.unknown(),
    outputSchema: claimResultSchema,
    sequencerStateSchema: taskBoardWorkerStateSchema,
    execute: async (_input, ctx): Promise<ClaimResult> => {
      const collection = collectionFactory(ctx);
      const task = await dispatcher.claim(collection, workerId(ctx), ctx);
      if (task === null) {
        await ctx.sequencer!.patchState({ lastClaimed: false });
        return { claimed: false };
      }
      await ctx.sequencer!.patchState({ lastClaimed: true });
      // Per-task status — surface what the agent is actually working
      // on. Latest-wins, so multi-worker boards cycle through their
      // active task goals naturally.
      ctx.emitStatus(`Working...`);
      return { claimed: true, task };
    },
  });
}
