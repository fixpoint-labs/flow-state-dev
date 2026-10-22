/**
 * A task as a worker reads it (FIX-1794 S6): a leaf module, so the task entry
 * (`./task-entry`) and the plan (`./plan`) read a task with one spelling.
 */
import type { TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import { routedBriefOf, routedMessage } from "../coordinator/routed-brief";

/**
 * A task as a worker reads it: the title when there is one, the goal, the
 * task's context, and its structured input as JSON when it carries any. A
 * routed task (FIX-2083) leads with the message it hands on, as written, in
 * place of its title and goal.
 */
export function taskMessage(task: TaskWorkerInput): string {
  const brief = routedBriefOf(task);
  const lines = [
    brief !== undefined ? routedMessage(brief, task.goal) : task.title === undefined ? task.goal : `${task.title}\n\n${task.goal}`
  ];
  if (task.context !== undefined && task.context.trim().length > 0) lines.push(`Context:\n${task.context}`);
  if (hasInput(task.input)) lines.push(`Input:\n${JSON.stringify(task.input, null, 2)}`);
  return lines.join("\n\n");
}

/** True for a task input worth showing: present, and not an empty object. */
function hasInput(input: unknown): boolean {
  if (input === undefined || input === null) return false;
  if (typeof input === "object" && !Array.isArray(input)) return Object.keys(input).length > 0;
  return true;
}
