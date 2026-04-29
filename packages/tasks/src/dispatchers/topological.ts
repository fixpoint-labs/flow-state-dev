/**
 * `topologicalDispatcher` — picks the earliest-`createdAt` `pending` task
 * whose `deps[]` are all `completed`.
 *
 * The substrate's default eligibility already enforces dep-completion
 * for a pending task with deps. This dispatcher delegates to the
 * default — explicit because the spec ships it as a named primitive
 * even though its eligibility is the substrate default.
 */
import { isReady } from "../collection/internal";
import type { TaskDispatcher } from "./types";

export const topologicalDispatcher: TaskDispatcher = {
  async claim(collection, workerId) {
    return collection.claim(workerId, {
      eligibility: (task) => isReady(task, (id) => collection.get(id)),
    });
  },
};
