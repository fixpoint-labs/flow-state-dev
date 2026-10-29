import { useCallback, useState } from "react";
import type { LabAdapter, TaskRow, TaskStatus } from "../adapter";
import { TASK_STATUS } from "../lib/task-status";
import { useWatch } from "../lib/use-watch";
import { cn } from "../lib/utils";
import { Entry } from "./Entry";
import { Sheet } from "./Sheet";
import { Spend } from "./Spend";
import { TaskCard, TaskDoneRow } from "./TaskCard";

/** The endings a task stays in: these rows move to the pane's *Done* group. */
const FINISHED: ReadonlySet<TaskStatus> = new Set(["completed", "errored", "cancelled"]);

/** What the pane and the sheet say about steering a task. */
const READ_ONLY_NOTE = "Read only. To stop or steer a task, ask the main session.";

/**
 * The right pane: the main session's background tasks. Read only (spec D2):
 * a row opens the task's work in a sheet over the main thread, and to stop or
 * steer it you ask the main session. Running and waiting tasks show as cards;
 * finished ones fold into a *Done* group, collapsed until you open it.
 */
export function TasksPane({ adapter, sessionId }: { adapter: LabAdapter; sessionId: string }) {
  const tasks = useWatch((emit: (rows: TaskRow[]) => void) => adapter.watchTasks(sessionId, emit), [adapter, sessionId]) ?? [];
  const [openId, setOpenId] = useState<string>();
  const close = useCallback(() => setOpenId(undefined), []);
  const open = tasks.find((t) => t.id === openId);
  const active = tasks.filter((t) => !FINISHED.has(t.status));
  const done = tasks.filter((t) => FINISHED.has(t.status));
  const toggle = (id: string) => setOpenId((current) => (current === id ? undefined : id));

  return (
    <aside aria-label="Background tasks" className="flex h-full min-h-0 flex-col bg-inspector">
      <div className="px-4 pt-4 pb-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        Background tasks · {active.length}
      </div>
      {tasks.length === 0 ? (
        <p className="px-4 text-xs text-muted-foreground">
          None yet. The main session starts one when a piece of work would take a while.
        </p>
      ) : (
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-3">
          {active.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {active.map((task) => (
                <li key={task.id}>
                  <TaskCard task={task} selected={task.id === openId} onOpen={() => toggle(task.id)} />
                </li>
              ))}
            </ul>
          ) : null}
          {done.length > 0 ? (
            <details className="group">
              <summary className="cursor-pointer list-none font-mono text-[10px] tracking-widest text-muted-foreground uppercase select-none hover:text-foreground">
                <span className="inline-block transition-transform group-open:rotate-90">›</span> Done · {done.length}
              </summary>
              <ul className="mt-2 flex flex-col">
                {done.map((task) => (
                  <li key={task.id}>
                    <TaskDoneRow task={task} selected={task.id === openId} onOpen={() => toggle(task.id)} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
      {open ? <TaskSheet adapter={adapter} sessionId={sessionId} task={open} onClose={close} /> : null}
      <p className="mt-auto px-4 py-3 text-xs text-muted-foreground">{READ_ONLY_NOTE}</p>
    </aside>
  );
}

/** One task's work in a sheet over the main thread: live while it runs, read only throughout. */
function TaskSheet({ adapter, sessionId, task, onClose }: { adapter: LabAdapter; sessionId: string; task: TaskRow; onClose: () => void }) {
  const work = useWatch(
    (emit: Parameters<LabAdapter["watchTaskWork"]>[2]) => adapter.watchTaskWork(sessionId, task.id, emit),
    [adapter, sessionId, task.id],
  );
  const status = TASK_STATUS[task.status];
  return (
    <Sheet
      label={`Work: ${task.title}`}
      title={
        <span className="flex items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", status.dot, task.status === "in_progress" && "animate-pulse")} />
          {task.title}
          <span className={cn("text-xs font-normal", status.tone)}>
            {status.label}
            {task.assignee ? ` · ${task.assignee}` : ""}
          </span>
        </span>
      }
      subtitle={
        <>
          {task.goal}
          <Spend task={task} split />
        </>
      }
      onClose={onClose}
      footer={READ_ONLY_NOTE}
    >
      {work === undefined || work.entries.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : null}
      {work?.entries.map((entry) => <Entry key={entry.id} entry={entry} />)}
    </Sheet>
  );
}
