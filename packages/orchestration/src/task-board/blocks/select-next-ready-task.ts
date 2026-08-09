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
import { isClaimable, taskSchema, type Task, type TaskCollectionRef } from "../../tasks";

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
      // The substrate's shared admission predicate (FIX-1005), so the preview
      // shows what `claim` would look at rather than a narrower hand-written
      // copy. A row this admits may turn out to be one the claim write settles
      // rather than runs — which is correct here, not hazardous: this block
      // previews and never dispatches, so "there is something to do on this
      // board" is the honest answer either way.
      const candidates = collection.list({ status: ["pending", "in_progress"] });
      const lookup = (id: string): Task | undefined => collection.get(id);
      const now = collection.now();
      const eligible = candidates.filter((task) => isClaimable(task, lookup, now));
      if (eligible.length === 0) return { ready: false };
      eligible.sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id.localeCompare(b.id);
      });
      return { ready: true, task: eligible[0] };
    },
  });
}
