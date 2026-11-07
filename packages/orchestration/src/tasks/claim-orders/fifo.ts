// FIX-1005; FIX-443 §10.1.
/**
 * `fifoClaimOrder` — picks the earliest-`createdAt` claimable task. The
 * task board's default claim order.
 *
 * It adds no eligibility of its own: the collection's `claim` admits only a
 * claimable row whose `deps[]` are all `completed`, so fifo is dep-gated
 * without restating that rule (a copy would stop recovering abandoned work
 * the day the substrate's rule widens), and it skips `parked`.
 */
import type { ClaimOrder } from "./types";

export const fifoClaimOrder: ClaimOrder = {
  async claim(collection, workerId) {
    return collection.claim(workerId);
  },
};
