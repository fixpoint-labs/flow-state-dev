/**
 * Read-only "what would the dispatcher pick next?" preview.
 *
 * Returns the first task the claim path would actually hand to a worker —
 * ready, or recoverable with its abandonment allowance still unspent —
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
import {
  claimDisposition,
  DEFAULT_MAX_ABANDONMENTS,
  isClaimable,
  taskSchema,
  type Task,
  type TaskCollectionRef,
} from "../../tasks";

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
      // Admission AND disposition, because this block answers "which task
      // next" and only the pair answers it (FIX-1005). `isClaimable` is the
      // substrate's shared admission predicate, so the preview looks at the
      // rows `claim` looks at rather than a narrower hand-written copy — but
      // admission alone over-reports: a row whose abandonment allowance is
      // spent is admitted, and then the claim write settles it `errored` and
      // scans past it. Naming that row as the next task promises a dispatch
      // no dispatcher will perform.
      //
      // `claimDisposition` is the same call, against the same constant, that
      // both backings make inside their claim write, so preview and dispatch
      // cannot disagree about which row is next.
      //
      // Deliberately NOT mirrored in the board's wake probe
      // (`task-board/shared.ts`): a worker SHOULD wake for an exhausted row,
      // because claiming it is what settles it and lets the board reach
      // `drained`. The probe asks "is there anything to do", which this block
      // does not.
      const candidates = collection.list({ status: ["pending", "in_progress"] });
      const lookup = (id: string): Task | undefined => collection.get(id);
      const now = collection.now();
      const eligible = candidates.filter(
        (task) =>
          isClaimable(task, lookup, now) &&
          claimDisposition(task, now, DEFAULT_MAX_ABANDONMENTS) === "claim"
      );
      if (eligible.length === 0) return { ready: false };
      eligible.sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id.localeCompare(b.id);
      });
      return { ready: true, task: eligible[0] };
    },
  });
}
