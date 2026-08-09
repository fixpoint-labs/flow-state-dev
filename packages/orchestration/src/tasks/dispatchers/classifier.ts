/**
 * `classifierDispatcher({ classify })` — LLM picks among ready `pending`
 * tasks.
 *
 * The factory takes a user-supplied `classify` callback that, given
 * the claimable candidate set and the runtime context, returns the id of
 * the task to claim (or `null` to back off). The dispatcher then narrows
 * `eligibility` to that id alone.
 *
 * **Narrowing by id is safe here since FIX-1005**, and it was not before. The
 * substrate now composes its own admission rule with a caller's narrowing
 * rather than letting the narrowing replace it, so the claim's re-check inside
 * the conditional write still arbitrates when a parallel worker won the task
 * during the model call — which is the wide window this dispatcher has by
 * construction. Restating that rule here as an `isReady` conjunct would only
 * pin a second copy of it, and the copy is what would exclude an abandoned row.
 *
 * The classifier sees the tasks the claim path would look at: `pending` ones
 * with deps satisfied, plus any whose worker died. Review-gated tasks are
 * filtered before the callback runs.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task } from "../schema/task";
import type { TaskCollectionRef } from "../collection/types";
import { isClaimable } from "../collection/internal";
import type { TaskDispatcher } from "./types";

export type ClassifyFn = (
  candidates: ReadonlyArray<Task>,
  ctx: BlockContext,
  collection: TaskCollectionRef
) => Promise<string | null>;

export interface ClassifierDispatcherOptions {
  classify: ClassifyFn;
}

export function classifierDispatcher(
  options: ClassifierDispatcherOptions
): TaskDispatcher {
  return {
    async claim(collection, workerId, ctx) {
      const lookup = (id: string) => collection.get(id);
      const ready = collection.list().filter((t) => isClaimable(t, lookup, collection.now()));
      if (ready.length === 0) return null;

      const pickedId = await options.classify(ready, ctx, collection);
      if (pickedId === null) return null;

      return collection.claim(workerId, {
        eligibility: (task) => task.id === pickedId,
      });
    },
  };
}
