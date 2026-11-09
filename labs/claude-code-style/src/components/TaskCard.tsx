import type { LabTask } from "../adapter";
import { TASK_STATUS, taskSignalTone } from "../lib/task-status";
import { cn } from "../lib/utils";
import { Spend } from "./flow-state/spend";
import { TaskTime } from "./flow-state/task-signals";
import { harnessLabelOf, pullRequestOpenLine, waitsOnPullRequest } from "./ThreadStatus";

/*
 * A background task as a list shows it: a full card while it runs or waits,
 * one line once it has finished. Each is a button that opens the task; what
 * opening does is the list's. A running card times this attempt's run, or
 * says *quiet* once its run stopped answering; a finished row says how long
 * ago it ended (the registry's `task-signals`, at the list's `now`). While the
 * list's read is `stale`, a running card never says *quiet*: its rows may be old.
 * A task waiting on its pull request says *PR open · #7*; its view has the link.
 */

/** A running or waiting task, at full size. */
export function TaskCard({ task, selected, onOpen, now, stale = false }: { task: LabTask; selected: boolean; onOpen: () => void; now: number; stale?: boolean }) {
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
          {task.view === undefined ? status.label : <TaskTime view={task.view} run={task.run} now={now} stale={stale} tone={taskSignalTone} fallback={status.label} />}
          {task.statusNote ? ` · "${task.statusNote}"` : ""}
        </span>
        {/* Plain words: the card is a button, and the link is in the task's view. */}
        {waitsOnPullRequest(task) ? <span className="block truncate text-xs text-muted-foreground" data-testid="pull-request-wait">{pullRequestOpenLine(task)}</span> : null}
        {task.assignee ? <span className="block text-xs text-muted-foreground">{task.assignee}</span> : null}
        <Spend spend={task.spend} harnessLabel={harnessLabelOf(task)} />
      </span>
    </button>
  );
}

/** A finished task, on one line: its mark, title, worker, what it spent and how long ago it ended. */
export function TaskDoneRow({ task, selected, onOpen, now }: { task: LabTask; selected: boolean; onOpen: () => void; now: number }) {
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
      {/* The title keeps room to be read; the worker and the spend give way to it, cut short, so the row never outgrows the pane. */}
      <span className="min-w-24 flex-1 truncate" data-task-title>
        {task.title}
      </span>
      {task.assignee ? <span className="max-w-24 shrink-0 truncate text-muted-foreground">{task.assignee}</span> : null}
      <Spend spend={task.spend} className="min-w-0" />
      {task.view === undefined ? null : (
        <span className="shrink-0 font-mono text-[10px]">
          <TaskTime view={task.view} run={task.run} now={now} tone={taskSignalTone} />
        </span>
      )}
    </button>
  );
}
