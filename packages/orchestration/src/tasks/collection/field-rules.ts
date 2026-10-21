/**
 * The task field table (FIX-2081): which fields of a task its filer, or the
 * user from a screen, may change, and until when. One rule per field, and
 * one place for it.
 *
 * The collection's guarded patch (`patchSettings`, FIX-2080) reads it inside
 * the write, so a task that starts between a caller's read and the write is
 * refused, not edited. The `updateTask` tool and its action read it to name a
 * refusal. Nothing else decides a field's rule.
 *
 * | Field | Allowed |
 * | -- | -- |
 * | `goal`, `title`, `context`, `input`, `deps`, `priority`, `labels`, `metadata`, `assignee`, `maxAttempts` | Before the task first starts |
 * | `held` (a hold, or a release) | Before the task first starts |
 * | a cancel | Until the task finishes |
 *
 * *Before it first starts* means never claimed: a task pending again after a
 * retry stays locked. Never editable: any other status, `followUpOf`, the
 * attempts used, and the `session` and `resultTo` settings. A finished task
 * refuses everything.
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
} as const satisfies Record<string, TaskFieldRule>;

/** A field the table holds a rule for. */
export type TaskEditField = keyof typeof TASK_FIELD_RULES;

/** The fields `updateTask` takes as fields, beside `id`: the table less a hold and a cancel, which it takes as `status`. */
export type TaskUpdateField = Exclude<TaskEditField, "held" | "cancel">;

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
