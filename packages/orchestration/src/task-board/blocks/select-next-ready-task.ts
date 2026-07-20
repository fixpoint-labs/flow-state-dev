/**
 * Read-only "what would the dispatcher pick next?" preview.
 *
 * Returns the first eligible task (status `pending`, deps satisfied)
 * without claiming it. Useful for visualizations, dry-run planners,
 * and external test harnesses. NOT atomic with respect to a concurrent
 * `claim` — by the time the caller reads this output, another worker
 * may have already claimed the previewed task. CAS-correct dispatch
 * runs through `claimTask` (which delegates to the substrate's
 * `collection.claim`).
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { taskSchema, type TaskCollectionRef } from "../../tasks";
import { depsSatisfied } from "../shared";

export interface SelectNextReadyTaskOptions {
  name: string;
  collection: (ctx: BlockContext) => Promise<TaskCollectionRef>;
}

export const selectNextReadyTaskOutputSchema = z.object({
  ready: z.boolean(),
  task: taskSchema.optional(),
});

export type SelectNextReadyTaskOutput = z.infer<
  typeof selectNextReadyTaskOutputSchema
>;

/**
 * Builds a preview block. Default ordering matches the substrate's
 * `defaultOrder` (ascending `createdAt`, ties broken by `id`).
 */
export function createSelectNextReadyTask(options: SelectNextReadyTaskOptions) {
  const { name, collection: collectionFactory } = options;
  return handler({
    name,
    inputSchema: z.unknown(),
    outputSchema: selectNextReadyTaskOutputSchema,
    execute: async (_input, ctx): Promise<SelectNextReadyTaskOutput> => {
      const collection = await collectionFactory(ctx);
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
