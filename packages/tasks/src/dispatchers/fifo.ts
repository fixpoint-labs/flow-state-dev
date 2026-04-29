/**
 * `fifoDispatcher` — picks the earliest-`createdAt` `pending` task.
 *
 * Eligibility excludes `awaiting_review` naturally because the default
 * eligibility predicate inside the collection's `claim` requires
 * `status === 'pending'` (FIX-443 §10.1).
 */
import type { TaskDispatcher } from "./types";

export const fifoDispatcher: TaskDispatcher = {
  async claim(collection, workerId) {
    return collection.claim(workerId);
  },
};
