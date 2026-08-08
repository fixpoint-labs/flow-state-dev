/**
 * `classifierDispatcher({ classify })` — LLM picks among ready `pending`
 * tasks.
 *
 * The factory takes a user-supplied `classify` callback that, given
 * the ready candidate set and the runtime context, returns the id of
 * the task to claim (or `null` to back off). The dispatcher then
 * narrows `eligibility` to that id **and keeps the readiness test**, so
 * the claim's re-check inside the conditional write still arbitrates if
 * a parallel worker won it first. Narrowing by id alone would drop that
 * test and hand the same task to both workers — the candidate scan here
 * runs well before the write, and the model call in between makes the
 * window wide.
 *
 * The classifier sees only `pending` tasks with deps satisfied; review-
 * gated tasks are filtered before the callback runs.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task } from "../schema/task";
import type { TaskCollectionRef } from "../collection/types";
import { isReady } from "../collection/internal";
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
      const ready = collection.list().filter((t) => isReady(t, lookup));
      if (ready.length === 0) return null;

      const pickedId = await options.classify(ready, ctx, collection);
      if (pickedId === null) return null;

      return collection.claim(workerId, {
        eligibility: (task) => task.id === pickedId && isReady(task, lookup),
      });
    },
  };
}
