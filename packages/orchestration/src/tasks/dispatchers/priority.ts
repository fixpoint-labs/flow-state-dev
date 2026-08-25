/**
 * `priorityDispatcher` — picks the highest-`priority` `pending` task with
 * deps satisfied. Higher numeric priority wins; ties break on
 * ascending `createdAt`.
 *
 * Tasks with `priority === undefined` are treated as priority `0` for
 * comparison — a deliberate choice so unprioritized tasks slot in
 * after explicitly-prioritized ones rather than being skipped.
 *
 * This dispatcher orders; it does not narrow. Its `isReady` eligibility
 * conjunct was a restatement of the substrate's own admission rule and came
 * out in FIX-1005 — a dispatcher carrying its own copy is one that stops
 * recovering abandoned work the day that rule widens.
 */
import type { Task } from "../schema/task";
import type { TaskDispatcher } from "./types";

function priorityOf(task: Task): number {
  return task.priority ?? 0;
}

export const priorityDispatcher: TaskDispatcher = {
  async claim(collection, workerId) {
    return collection.claim(workerId, {
      order: (a, b) => {
        const dp = priorityOf(b) - priorityOf(a);
        if (dp !== 0) return dp;
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id.localeCompare(b.id);
      },
    });
  },
};
