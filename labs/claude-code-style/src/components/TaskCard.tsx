import type { TaskRow } from "../adapter";
import { TASK_STATUS } from "../lib/task-status";
import { cn } from "../lib/utils";
import { Spend } from "./flow-state/spend";
import { harnessLabelOf } from "./ThreadStatus";

/*
 * A background task as a list shows it: a full card while it runs or waits,
 * one line once it has finished. Each is a button that opens the task; what
 * opening does is the list's.
 */

/** A running or waiting task, at full size. */
export function TaskCard({ task, selected, onOpen }: { task: TaskRow; selected: boolean; onOpen: () => void }) {
  const status = TASK_STATUS[task.status];
  return (
    <button
      type="button"
      aria-expanded={selected}
      onClick={onOpen}
      className={cn("flex w-full items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent", selected && "border-primary")}
      data-task-status={task.status}
    >
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", status.dot, task.status === "in_progress" && "animate-pulse")} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold" data-task-title>
          {task.title}
        </span>
        <span className={cn("block truncate text-xs", status.tone)}>
          {status.label}
          {task.statusNote ? ` · "${task.statusNote}"` : ""}
        </span>
        {task.assignee ? <span className="block text-xs text-muted-foreground">{task.assignee}</span> : null}
        <Spend spend={task.spend} harnessLabel={harnessLabelOf(task)} />
      </span>
    </button>
  );
}

/** A finished task, on one line: its mark, title, worker and what it spent. */
export function TaskDoneRow({ task, selected, onOpen }: { task: TaskRow; selected: boolean; onOpen: () => void }) {
  const status = TASK_STATUS[task.status];
  return (
    <button
      type="button"
      aria-expanded={selected}
      onClick={onOpen}
      title={`${task.title} · ${status.label}`}
      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent", selected && "bg-accent")}
      data-task-status={task.status}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", status.dot)} aria-label={status.label} />
      <span className="min-w-0 flex-1 truncate" data-task-title>
        {task.title}
      </span>
      {task.assignee ? <span className="shrink-0 text-muted-foreground">{task.assignee}</span> : null}
      <Spend spend={task.spend} className="shrink-0" />
    </button>
  );
}
