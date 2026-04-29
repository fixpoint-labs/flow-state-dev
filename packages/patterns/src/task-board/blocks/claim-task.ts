/**
 * Atomic claim block.
 *
 * Calls the configured dispatcher's `claim` to flip the next eligible
 * task to `in_progress` against the calling worker. Returns
 * `{ claimed, task? }`. The substrate's CAS retry inside `claim`
 * guarantees exactly-once dispatch under contention; under load this
 * block surfaces that semantic to the pattern layer.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { Task, TaskCollectionRef, TaskDispatcher } from "@flow-state-dev/tasks";

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

export interface ClaimTaskOutput {
  claimed: boolean;
  task?: Task;
}

export function createClaimTask(options: ClaimTaskOptions) {
  const { name, collection: collectionFactory, dispatcher, workerId } = options;
  return handler({
    name,
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (_input, ctx): Promise<ClaimTaskOutput> => {
      const collection = collectionFactory(ctx);
      const task = await dispatcher.claim(collection, workerId(ctx), ctx);
      if (task === null) return { claimed: false };
      return { claimed: true, task };
    },
  });
}
