import { memo } from "react";
import type { BoardTask } from "../adapter";
import { cn } from "../lib/utils";
import type { Look } from "../lib/looks";
import { Avatar } from "./Avatar";
import { Spend } from "./flow-state/spend";
import { RunsOn, runsOn, taskLabel, taskLine, taskRowPresentation } from "./Popups";

/** What a task's line draws: a board row's task, or a filed task's stand-in before its row is read. */
export type TaskLine = Pick<BoardTask, "id" | "to" | "title" | "status" | "harness" | "model" | "spend" | "landed" | "waiting">;

/**
 * A task a conversation filed, as one line in the thread: what was asked of
 * whom, or a coding task, and how it stands. It opens the task's run in a
 * popup, where its buttons are. Memoized, like a conversation's entries.
 */
export const TaskCard = memo(function TaskCard({
  task,
  nameOf,
  lookOf,
  coding = false,
  onOpen,
}: {
  task: TaskLine;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  /** It is a coding task: a background task, not a teammate's. */
  coding?: boolean;
  onOpen: (taskId: string) => void;
}) {
  const line = taskLine(task, coding, nameOf);
  const on = coding ? runsOn(task) : undefined;
  const state = taskRowPresentation(task);
  return (
    <button
      type="button"
      data-entry="task"
      data-status={task.status}
      aria-label={coding ? taskLabel(line, task) : line}
      onClick={() => onOpen(task.id)}
      className="flex w-full max-w-[85%] items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-1.5 text-left text-sm hover:bg-accent"
    >
      {coding ? (
        <span aria-hidden className="shrink-0 text-muted-foreground">
          ⚙
        </span>
      ) : (
        <Avatar look={lookOf(task.to)} size="sm" />
      )}
      <span className="min-w-0 flex-1 truncate">{line}</span>
      {on === undefined ? null : <RunsOn on={on} />}
      {task.landed === undefined ? null : (
        <span data-task-landed={task.landed.kind} className="shrink-0 text-xs text-muted-foreground">
          {task.landed.kind === "pull-request" ? `PR #${task.landed.number}` : `merged into ${task.landed.branch}`}
        </span>
      )}
      {/* What its runs spent: tokens, and the charge when the vendor reported one. The tag above names the model. */}
      {coding && task.spend ? <Spend spend={{ ...task.spend, model: null }} className="w-auto shrink-0" /> : null}
      <span className={cn("shrink-0 text-xs", state.tone)} data-task-status>
        {state.word}
      </span>
    </button>
  );
});
