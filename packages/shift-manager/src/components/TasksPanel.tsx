/**
 * TASKS, at Shift Coordinator (FIX-1794 S11): the tasks the user's
 * conversation filed for its delegates, as the conversation's own
 * `listTasks` answers them (`lib/conversation-tasks.ts`). Each conversation
 * keeps a board of its own, so this reads that one board and nothing else.
 *
 * It reads when it opens and again each time the Lab is read again
 * (`readAt`), which is after each turn the user sends: a task filed or
 * reassigned in that turn shows then. A task ends between those turns, and
 * its ending wakes a coordinator turn of its own, so while a task is open the
 * panel reads again every {@link TASKS_POLL_MS}; when a read shows a task
 * moved, it reloads the Lab, and it keeps reading for a while after, so the
 * turn that ending woke (a task filed again, say) shows too. Nothing here
 * knows a tool's name.
 */
import { useEffect, useRef, useState } from "react";
import { columnFor } from "../lib/columns";
import { readConversationTasks, type ConversationTask } from "../lib/conversation-tasks";
import { useLab } from "../lib/lab-data";
import { conversationBoardRef, describeFailure, type Worker } from "../lib/reads";
import { navigate } from "../lib/routes";
import { STATE_OF_COLUMN, StateSquare } from "./ui";

type Read = { tasks: ConversationTask[] } | { failure: string } | undefined;

/** How often the panel reads again while a task is open, or just moved. */
export const TASKS_POLL_MS = 3_000;
/** How long the panel keeps reading after a task moved: the turn its ending woke runs in that time. */
const AFTER_A_MOVE_MS = 30_000;

/** How long a failed task stays in the list, red, before it fades out of it. */
export const FAILED_STAYS_MS = 5_000;
/** How long the fade itself takes. The row leaves the list when it ends. */
export const FADE_MS = 600;

/** Whether a task can still move by itself. */
const isOpen = (task: ConversationTask) => task.status === "pending" || task.status === "in_progress";
/** What the panel compares between reads: each task and where it stands. */
const standing = (tasks: readonly ConversationTask[]) => tasks.map((task) => `${task.id}:${task.status}`).join(",");

export function TasksPanel({ worker, sessionId, readAt }: { worker: Worker; sessionId: string | null; readAt: number }) {
  const { clients, refresh } = useLab();
  const [read, setRead] = useState<Read>(undefined);
  const [polls, setPolls] = useState(0);
  // The last read's standing, and when a task last moved.
  const last = useRef<{ standing?: string; movedAt: number }>({ movedAt: 0 });
  // A failed task is cleared from the list, never from its board: it shows red,
  // fades, then leaves. The ids already on that path, and where each one is.
  const [fading, setFading] = useState<ReadonlySet<string>>(new Set());
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const clearing = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());
  const stopClearing = () => {
    for (const timers of clearing.current.values()) timers.forEach(clearTimeout);
    clearing.current.clear();
  };

  // Another conversation's tasks never show under this one. A read again of the
  // same conversation keeps its list up until the new answer lands.
  useEffect(() => {
    setRead(undefined);
    last.current = { movedAt: 0 };
    stopClearing();
    setFading(new Set());
    setGone(new Set());
    return stopClearing;
  }, [worker.kind, sessionId]);

  // Each task that has failed starts its own clock once, however often it is read again.
  const failedIds = read !== undefined && "tasks" in read ? read.tasks.filter((t) => t.status === "errored").map((t) => t.id) : [];
  const failedKey = failedIds.join(",");
  useEffect(() => {
    for (const id of failedIds) {
      if (clearing.current.has(id)) continue;
      clearing.current.set(id, [
        setTimeout(() => setFading((held) => new Set(held).add(id)), FAILED_STAYS_MS),
        setTimeout(() => setGone((held) => new Set(held).add(id)), FAILED_STAYS_MS + FADE_MS),
      ]);
    }
  }, [failedKey]);

  useEffect(() => {
    if (sessionId === null || worker.kind === null) return;
    let closed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    readConversationTasks(clients, worker.kind, sessionId)
      .then((tasks) => {
        if (closed) return;
        setRead({ tasks });
        const now = standing(tasks);
        if (last.current.standing !== undefined && last.current.standing !== now) {
          last.current.movedAt = Date.now();
          void refresh();
        }
        last.current.standing = now;
        if (tasks.some(isOpen) || Date.now() - last.current.movedAt < AFTER_A_MOVE_MS) {
          next = setTimeout(() => setPolls((n) => n + 1), TASKS_POLL_MS);
        }
      })
      .catch((error: unknown) => !closed && setRead({ failure: describeFailure(error).message }));
    return () => {
      closed = true;
      if (next !== undefined) clearTimeout(next);
    };
  }, [clients, refresh, worker.kind, sessionId, readAt, polls]);

  if (sessionId === null || worker.kind === null) {
    return (
      <p className="px-1 text-xs text-muted-foreground" data-testid="cos-tasks-none">
        Tasks belong to a conversation. Say something to start one.
      </p>
    );
  }
  if (read === undefined) {
    return (
      <p className="px-1 text-xs text-muted-foreground" data-testid="cos-tasks-reading">
        Reading the tasks…
      </p>
    );
  }
  if ("failure" in read) {
    return (
      <p className="px-1 text-xs text-destructive" data-testid="cos-tasks-failure">
        The tasks didn't load: {read.failure}
      </p>
    );
  }
  if (read.tasks.length === 0) {
    return (
      <p className="px-1 text-xs text-muted-foreground" data-testid="cos-tasks-empty">
        This conversation hasn't filed a task.
      </p>
    );
  }
  const shown = read.tasks.filter((task) => !gone.has(task.id));
  if (shown.length === 0) {
    return (
      <p className="px-1 text-xs text-muted-foreground" data-testid="cos-tasks-cleared">
        Nothing open. Failed tasks are on the Tasks list.
      </p>
    );
  }
  return (
    <ul className="space-y-0.5" data-testid="cos-tasks">
      {shown.map((task) => (
        <li
          key={task.id}
          className={`flex items-start gap-2 px-1 py-1 text-sm transition-opacity motion-reduce:transition-none ${
            task.status === "errored" ? "text-destructive" : ""
          } ${fading.has(task.id) ? "opacity-0" : "opacity-100"}`}
          style={{ transitionDuration: `${FADE_MS}ms` }}
          data-testid="cos-task"
          data-task-id={task.id}
          data-status={task.status}
        >
          <StateSquare state={STATE_OF_COLUMN[columnFor(task.status)]} className="mt-1.5" />
          <button
            type="button"
            className="min-w-0 text-left hover:underline"
            data-testid="cos-task-open"
            onClick={() => navigate({ level: "task", boardRef: conversationBoardRef(sessionId), taskId: task.id, tab: "session" })}
          >
            <span className="line-clamp-2">{task.goal}</span>
            <span className={`block text-xs ${task.status === "errored" ? "text-destructive" : "text-muted-foreground"}`}>
              {task.status === "errored" ? "failed" : task.status} · {task.assignee ?? "unassigned"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
