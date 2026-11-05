/**
 * The marker a task's brief carries in its session: the `user` line a task
 * request opens with, the task as filed (or the answer that re-queued it) for
 * a later turn's history. Its message item names the task in `metadata`, so a
 * client draws it as the brief the session was handed, never as a line the
 * user typed. Imports nothing: a browser reads the marker by the rule the
 * server writes it by.
 */

/** The key a brief carries its marker under, in its message item's `metadata`. */
const TASK_BRIEF_KEY = "taskBrief";

/** A task's brief, as its item names it. */
export interface TaskBrief {
  /** The task the brief is, by id. */
  readonly taskId: string;
}

/** The `metadata` a task's brief is written with. */
export function taskBriefMetadata(brief: TaskBrief): { [TASK_BRIEF_KEY]: TaskBrief } {
  return { [TASK_BRIEF_KEY]: { taskId: brief.taskId } };
}

/**
 * The task brief a message item is, or `undefined` for any other item. A
 * brief stored before its item carried the marker reads as `undefined`.
 *
 * @param item A stored or streamed item: a message's `metadata`.
 */
export function taskBriefOf(item: {
  readonly type?: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}): TaskBrief | undefined {
  if (item.type !== undefined && item.type !== "message") return undefined;
  const marked = item.metadata?.[TASK_BRIEF_KEY] as { taskId?: unknown } | null | undefined;
  if (marked == null || typeof marked.taskId !== "string") return undefined;
  return { taskId: marked.taskId };
}
