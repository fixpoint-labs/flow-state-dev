/**
 * `topologicalDispatcher` — picks the earliest-`createdAt` claimable task
 * whose `deps[]` are all `completed`.
 *
 * The substrate's own admission predicate already enforces dep-completion, so
 * this dispatcher adds no narrowing at all — explicit because the spec ships
 * it as a named primitive even though its eligibility is the substrate's.
 *
 * It used to spell that predicate out as an `isReady` conjunct (FIX-1005
 * removed it). Restating the substrate's rule in a dispatcher makes the
 * dispatcher a second copy of it, and the copy is what stops recovering
 * abandoned work the day the substrate's rule widens.
 */
import type { TaskDispatcher } from "./types";

export const topologicalDispatcher: TaskDispatcher = {
  async claim(collection, workerId) {
    return collection.claim(workerId);
  },
};
