/**
 * `fifoClaimOrder` — picks the earliest-`createdAt` `pending` task.
 *
 * Eligibility excludes `parked` naturally because the default
 * eligibility predicate inside the collection's `claim` requires
 * `status === 'pending'` (FIX-443 §10.1).
 */
import type { ClaimOrder } from "./types";

export const fifoClaimOrder: ClaimOrder = {
  async claim(collection, workerId) {
    return collection.claim(workerId);
  },
};
