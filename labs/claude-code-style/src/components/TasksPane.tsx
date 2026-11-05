import { useCallback, useMemo } from "react";
import type { LabAdapter, TaskRow, TaskStatus } from "../adapter";
import { TASK_STATUS } from "../lib/task-status";
import { useMissing, useWatch } from "../lib/use-watch";
import { cn } from "../lib/utils";
import { Entry } from "./Entry";
import { LoadEarlier } from "./LoadEarlier";
import { Sheet } from "./Sheet";
import { ErrorBody } from "./flow-state/error";
import { Spend } from "./flow-state/spend";
import { StreamingIndicator } from "./flow-state/streaming-indicator";
import { TaskActions } from "./flow-state/task-actions";
import { workingStatus } from "./flow-state/working-status";
import { harnessLabelOf } from "./ThreadStatus";
import { TaskCard, TaskDoneRow } from "./TaskCard";

/** The endings a task stays in: these rows move to the pane's *Done* group. */
const FINISHED: ReadonlySet<TaskStatus> = new Set(["completed", "errored", "cancelled"]);

/**
 * The right pane: the main session's background tasks. A row opens the task's
 * work in a sheet over the main thread, and the sheet's action row changes the
 * task on its board: Cancel, Steer, Release or Retry, by its status. Asking the main session to
 * stop or steer a task still works too. Running and waiting tasks show as
 * cards; finished ones fold into a *Done* group, collapsed until you open it.
 */
export function TasksPane({
  adapter,
  sessionId,
  openId,
  onOpen,
  onMissing,
}: {
  adapter: LabAdapter;
  sessionId: string;
  /** The task whose sheet is open, kept by the app so the page's address can name it. */
  openId: string | undefined;
  onOpen: (taskId: string | undefined) => void;
  /** `openId` names no task of this session's, once its tasks are read. */
  onMissing: () => void;
}) {
  const listed = useWatch((emit: (rows: TaskRow[]) => void) => adapter.watchTasks(sessionId, emit), [adapter, sessionId]);
  const tasks = listed ?? [];
  const close = useCallback(() => onOpen(undefined), [onOpen]);
  const open = tasks.find((t) => t.id === openId);
  useMissing(listed, openId, onMissing);
  const active = tasks.filter((t) => !FINISHED.has(t.status));
  const done = tasks.filter((t) => FINISHED.has(t.status));
  const toggle = (id: string) => onOpen(openId === id ? undefined : id);

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
    </aside>
  );
}

/**
 * One task's work in a sheet over the main thread, live while it runs, with
 * its action row at the foot. The sheet has no composer, so the row carries
 * the Steer box. A failed task's error shows as an error.
 */
function TaskSheet({ adapter, sessionId, task, onClose }: { adapter: LabAdapter; sessionId: string; task: TaskRow; onClose: () => void }) {
  const actions = useMemo(() => adapter.taskActions(sessionId), [adapter, sessionId]);
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
          <Spend spend={task.spend} split harnessLabel={harnessLabelOf(task)} />
        </>
      }
      onClose={onClose}
      footer={<TaskActions key={task.id} id={task.id} status={task.status} actions={actions} steer />}
    >
      {task.status === "errored" && task.error !== undefined ? (
        <div role="alert" className="mb-3 flex flex-col gap-1 border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <ErrorBody message={task.error} />
        </div>
      ) : null}
      {work === undefined || work.entries.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : null}
      <LoadEarlier load={work?.loadEarlier} />
      {work?.entries.map((entry) => <Entry key={entry.id} entry={entry} />)}
      {/* The live line: what it is doing now, else "Working...", and for how long. A task waiting on you isn't working. */}
      {task.status === "in_progress" && task.waitingOn === undefined ? (
        <StreamingIndicator message={workingStatus({ ...work?.working, note: task.statusNote })} since={task.startedAt} />
      ) : null}
    </Sheet>
  );
}
