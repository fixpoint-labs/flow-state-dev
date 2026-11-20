// FIX-2848 D1.
/**
 * A task's ending as the line an app draws (`workforce:result`): written in
 * the conversation that filed the task, beside the board's ending message, by
 * whichever path says that message (the notice's line, or the answer's
 * read of a task that finished during its turn). Client-only: the model reads
 * the message.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { TaskNotice } from "@flow-state-dev/orchestration/tasks";
import { TASK_RESULT_DATA_TYPE } from "../messages/keys";
import type { TaskResultValue } from "../messages/line-values";

/**
 * The result line for `notice` on the task `task`, or `undefined` for an ending
 * that isn't one (a park, a retry). `said` is the board's ending message, and
 * the line says exactly that: never the task's output or error read here,
 * which can say more than the message lets the browser see.
 */
export function resultLineOf(
  notice: Pick<TaskNotice, "taskId" | "ending">,
  task: { goal: string; title?: string; assignee?: string },
  said: string
): TaskResultValue | undefined {
  const ending = notice.ending;
  if (ending !== "completed" && ending !== "errored" && ending !== "cancelled") return undefined;
  return {
    taskId: notice.taskId,
    ...(task.assignee === undefined ? {} : { from: task.assignee }),
    title: task.title ?? task.goal,
    text: said,
    ending
  };
}

/** Write `result` as its line, keyed by its task, so a second copy of the same ending replaces the first. */
export function writeResultLine(ctx: BlockContext, result: TaskResultValue): void {
  ctx.emit.data(TASK_RESULT_DATA_TYPE, result, {
    key: `result:${result.taskId}`,
    ...(result.from === undefined ? {} : { agentName: result.from }),
    itemVisibility: { client: true, history: false }
  });
}
