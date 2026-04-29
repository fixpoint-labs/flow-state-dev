/**
 * `priorityDispatcher` — picks the highest-`priority` `pending` task with
 * deps satisfied. Higher numeric priority wins; ties break on
 * ascending `createdAt`.
 *
 * Tasks with `priority === undefined` are treated as priority `0` for
 * comparison — a deliberate choice so unprioritized tasks slot in
 * after explicitly-prioritized ones rather than being skipped.
 */
import type { Task } from "../schema/task";
import { isReady } from "../collection/internal";
import type { TaskDispatcher } from "./types";

function priorityOf(task: Task): number {
  return task.priority ?? 0;
}

export const priorityDispatcher: TaskDispatcher = {
  async claim(collection, workerId) {
    return collection.claim(workerId, {
      eligibility: (task) => isReady(task, (id) => collection.get(id)),
      order: (a, b) => {
        const dp = priorityOf(b) - priorityOf(a);
        if (dp !== 0) return dp;
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id.localeCompare(b.id);
      },
    });
  },
};
