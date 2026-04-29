/**
 * Read-only "what would the dispatcher pick next?" preview.
 *
 * Returns the first eligible task (status `pending`, deps satisfied)
 * without claiming it. Useful for visualizations, dry-run planners,
 * and external test harnesses. NOT atomic with respect to a concurrent
 * `claim` — by the time the caller reads this output, another worker
 * may have already claimed the previewed task. CAS-correct dispatch
 * runs through `claimTask` (or the substrate's `collection.claim`).
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { Task, TaskCollectionRef } from "@flow-state-dev/tasks";
import { depsSatisfied } from "../shared";

export interface SelectNextReadyTaskOptions {
  name: string;
  collection: (ctx: BlockContext) => TaskCollectionRef;
}

export interface SelectNextReadyTaskOutput {
  /** True when a candidate was found. */
  ready: boolean;
  /** The would-be picked task, when `ready === true`. */
  task?: Task;
}

/**
 * Builds a preview block. Default ordering matches the substrate's
 * `defaultOrder` (ascending `createdAt`, ties broken by `id`).
 */
export function createSelectNextReadyTask(options: SelectNextReadyTaskOptions) {
  const { name, collection: collectionFactory } = options;
  return handler({
    name,
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (_input, ctx): Promise<SelectNextReadyTaskOutput> => {
      const collection = collectionFactory(ctx);
      const pending = collection.list({ status: "pending" });
      const eligible = pending.filter((task) => depsSatisfied(task, collection));
      if (eligible.length === 0) return { ready: false };
      eligible.sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id.localeCompare(b.id);
      });
      return { ready: true, task: eligible[0] };
    },
  });
}
