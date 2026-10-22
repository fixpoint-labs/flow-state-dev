/**
 * Which fields of a task its filer may change, and until when. `patchSettings`
 * reads {@link lockedFields} inside the write, so a task that starts between
 * a read and the write is refused. `updateTask` reads the same answer to name
 * the refusal.
 *
 * *Before it first starts* means never claimed ({@link hasStarted}): a task
 * pending again after a retry stays locked. Never editable, in any state:
 * `followUpOf`, `session`, `resultTo`, and the attempts used. A finished task
 * refuses every field.
 */
import type { Task } from "../schema/task";
import { isTerminalStatus } from "../schema/task-status";

/** How long a field stays editable. */
type TaskFieldRule =
  /** Until the task is first claimed (`hasStarted`). */
  | "until-start"
  /** Until the task reaches a terminal status. */
  | "until-finish";

/** Every field `updateTask` may change, with its one rule. */
export const TASK_FIELD_RULES = {
  goal: "until-start",
  title: "until-start",
  context: "until-start",
  input: "until-start",
  deps: "until-start",
  priority: "until-start",
  labels: "until-start",
  metadata: "until-start",
  assignee: "until-start",
  maxAttempts: "until-start",
  held: "until-start",
  // Here only so a refusal can name a cancel beside the fields: a cancel is
  // `status: "cancelled"` through `cancel()`, never a settings patch.
  cancel: "until-finish",
  // A steer (FIX-2086): words that join the brief, kept on the task through
  // the collection's `steer`, never a settings patch. A finished task takes
  // none, so its output never changes: a correction is a follow-up.
  message: "until-finish",
} as const satisfies Record<string, TaskFieldRule>;

/** A field the table holds a rule for. */
export type TaskEditField = keyof typeof TASK_FIELD_RULES;

/**
 * The settings `updateTask` takes as fields, beside `id`: the table less a
 * hold and a cancel, which it takes as `status`, and a message, which steers
 * rather than patches.
 */
export type TaskUpdateField = Exclude<TaskEditField, "held" | "cancel" | "message">;

/**
 * Whether the row has ever started: claimed at least once. A retry's return
 * to `pending` does not make it unstarted again.
 */
export function hasStarted(task: Task): boolean {
  return task.startedAt != null || task.attempts > 0;
}

/**
 * The fields of `fields` the row's state no longer allows, by the table:
 * every field on a finished row, and every until-start field on a row that
 * has started. Empty when each may change now.
 */
export function lockedFields(task: Task, fields: readonly TaskEditField[]): TaskEditField[] {
  if (isTerminalStatus(task.status)) return [...fields];
  if (!hasStarted(task)) return [];
  return fields.filter((field) => TASK_FIELD_RULES[field] === "until-start");
}
