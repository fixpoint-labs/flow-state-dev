import { memo } from "react";
import type { BoardTask } from "../adapter";
import { cn } from "../lib/utils";
import type { Look } from "../lib/looks";
import { Avatar } from "./Avatar";
import { taskLine } from "./Popups";

/**
 * A task a conversation filed, as one line in the thread: what was asked of
 * whom, or a coding task, and how it stands. It opens the task's run in a
 * popup, read only. Memoized, like a conversation's entries.
 */
export const TaskCard = memo(function TaskCard({
  task,
  nameOf,
  lookOf,
  coding = false,
  onOpen,
}: {
  task: BoardTask;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  /** It is a coding task: a background task, not a teammate's. */
  coding?: boolean;
  onOpen: (taskId: string) => void;
}) {
  const line = taskLine(task, coding, nameOf);
  return (
    <button
      type="button"
      data-entry="task"
      data-status={task.status}
      aria-label={line}
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
      <span className={cn("shrink-0 text-xs", task.status === "failed" ? "text-destructive" : "text-muted-foreground")} data-task-status>
        {task.status}
      </span>
    </button>
  );
});
