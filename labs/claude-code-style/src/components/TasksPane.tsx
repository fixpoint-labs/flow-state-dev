import { useState } from "react";
import type { LabAdapter, TaskRow } from "../adapter";
import { TASK_STATUS } from "../lib/task-status";
import { useWatch } from "../lib/use-watch";
import { cn } from "../lib/utils";
import { Entry } from "./Entry";

/**
 * The right pane: the main session's background tasks. Read only (spec D2):
 * a row opens to show the task's work, and to stop or steer it you ask the
 * main session.
 */
export function TasksPane({ adapter, sessionId }: { adapter: LabAdapter; sessionId: string }) {
  const tasks = useWatch((emit: (rows: TaskRow[]) => void) => adapter.watchTasks(sessionId, emit), [adapter, sessionId]) ?? [];
  const [openId, setOpenId] = useState<string>();
  const open = tasks.find((t) => t.id === openId);

  return (
    <aside aria-label="Background tasks" className="flex h-full min-h-0 flex-col bg-inspector">
      <div className="px-4 pt-4 pb-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        Background tasks · {tasks.length}
      </div>
      {tasks.length === 0 ? (
        <p className="px-4 text-xs text-muted-foreground">
          None yet. The main session starts one when a piece of work would take a while.
        </p>
      ) : (
        <ul className={cn("flex min-h-0 flex-col gap-2 overflow-y-auto px-3", open && "max-h-[45%] shrink-0")}>
          {tasks.map((task) => {
            const status = TASK_STATUS[task.status];
            return (
              <li key={task.id}>
                <button
                  type="button"
                  aria-expanded={task.id === openId}
                  onClick={() => setOpenId((id) => (id === task.id ? undefined : task.id))}
                  className={cn(
                    "flex w-full items-start gap-2 border border-border bg-card px-3 py-2 text-left hover:bg-accent",
                    task.id === openId && "border-primary",
                  )}
                  data-task-status={task.status}
                >
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", status.dot, task.status === "in_progress" && "animate-pulse")} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{task.title}</span>
                    <span className={cn("block truncate text-xs", status.tone)}>
                      {status.label}
                      {task.statusNote ? ` · "${task.statusNote}"` : ""}
                    </span>
                    {task.assignee ? <span className="block text-xs text-muted-foreground">{task.assignee}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open ? <TaskWorkView adapter={adapter} sessionId={sessionId} task={open} /> : null}
      <p className="mt-auto px-4 py-3 text-xs text-muted-foreground">Read only. To stop or steer a task, ask the main session.</p>
    </aside>
  );
}

/** One task's work, read only: no composer, no controls. */
function TaskWorkView({ adapter, sessionId, task }: { adapter: LabAdapter; sessionId: string; task: TaskRow }) {
  const work = useWatch(
    (emit: Parameters<LabAdapter["watchTaskWork"]>[2]) => adapter.watchTaskWork(sessionId, task.id, emit),
    [adapter, sessionId, task.id],
  );
  return (
    <section aria-label={`Work: ${task.title}`} className="mx-3 mt-3 flex min-h-0 flex-1 flex-col border border-border bg-background">
      <div className="border-b border-border px-3 py-2">
        <div className="text-sm font-semibold">{task.title}</div>
        <div className="text-xs text-muted-foreground">{task.goal}</div>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto px-3 py-2">
        {work?.entries.map((entry) => <Entry key={entry.id} entry={entry} />)}
      </div>
    </section>
  );
}
