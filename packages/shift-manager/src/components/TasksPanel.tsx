/**
 * TASKS, at Shift Coordinator (FIX-1794 S11): the tasks the user's
 * conversation filed for its delegates, as the conversation's own
 * `listTasks` read answers them (`lib/conversation-tasks.ts`), which stores
 * nothing, so a poll costs no request (FIX-2286). Each conversation
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
import { ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { columnFor, isDone } from "../lib/columns";
import { workerLabel } from "../lib/derive";
import { readConversationTasks, type ConversationTask } from "../lib/conversation-tasks";
import { useLab } from "../lib/lab-data";
import { conversationBoardRef, describeFailure, type Worker } from "../lib/reads";
import { RouteLink } from "./RouteLink";
import { STATE_OF_COLUMN, StateSquare } from "./ui";

type Read = { tasks: ConversationTask[] } | { failure: string } | undefined;

/** How often the panel reads again while a task is open, or just moved. */
export const TASKS_POLL_MS = 3_000;
/** How long the panel keeps reading after a task moved: the turn its ending woke runs in that time. */
const AFTER_A_MOVE_MS = 30_000;

/** Whether a task can still move by itself. */
export const isOpen = (task: ConversationTask) => task.status === "pending" || task.status === "in_progress";
/** What the panel compares between reads: each task and where it stands. */
const standing = (tasks: readonly ConversationTask[]) => tasks.map((task) => `${task.id}:${task.status}`).join(",");

const isErrored = (task: ConversationTask) => task.status === "errored";

export function TasksPanel({
  worker,
  sessionId,
  readAt,
  activeOnly = false,
}: {
  worker: Worker;
  sessionId: string | null;
  readAt: number;
  /** List only the active tasks, with the done and the errored each folded into a closed group. */
  activeOnly?: boolean;
}) {
  const { client, refresh } = useLab();
  const [read, setRead] = useState<Read>(undefined);
  const [polls, setPolls] = useState(0);
  // The last read's standing, and when a task last moved.
  const last = useRef<{ standing?: string; movedAt: number }>({ movedAt: 0 });

  // Another conversation's tasks never show under this one. A read again of the
  // same conversation keeps its list up until the new answer lands.
  useEffect(() => {
    setRead(undefined);
    last.current = { movedAt: 0 };
  }, [worker.kind, sessionId]);

  useEffect(() => {
    if (sessionId === null || worker.kind === null) return;
    let closed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    readConversationTasks(client, worker.kind, sessionId)
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
  }, [client, refresh, worker.kind, sessionId, readAt, polls]);

  if (sessionId === null || worker.kind === null) {
    return (
      <p className="px-1 text-xs text-muted-foreground" data-testid="shift-coordinator-tasks-none">
        Tasks belong to a conversation. Say something to start one.
      </p>
    );
  }
  if (read === undefined) {
    return (
      <p className="px-1 text-xs text-muted-foreground" data-testid="shift-coordinator-tasks-reading">
        Reading the tasks…
      </p>
    );
  }
  if ("failure" in read) {
    return (
      <p className="px-1 text-xs text-destructive" data-testid="shift-coordinator-tasks-failure">
        The tasks didn't load: {read.failure}
      </p>
    );
  }
  if (read.tasks.length === 0) {
    return (
      <p className="px-1 text-xs text-muted-foreground" data-testid="shift-coordinator-tasks-empty">
        This conversation hasn't filed a task.
      </p>
    );
  }
  const boardRef = conversationBoardRef(sessionId);
  if (!activeOnly) return <TaskList tasks={read.tasks} boardRef={boardRef} />;
  const done = read.tasks.filter((task) => isDone(task.status));
  const errored = read.tasks.filter(isErrored);
  const active = read.tasks.filter((task) => !isDone(task.status) && !isErrored(task));
  return (
    <div className="space-y-1">
      {active.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground" data-testid="shift-coordinator-tasks-none-active">
          No task is active.
        </p>
      ) : (
        <TaskList tasks={active} boardRef={boardRef} />
      )}
      <TaskGroup tasks={done} name="done" boardRef={boardRef} />
      <TaskGroup tasks={errored} name="errored" boardRef={boardRef} />
    </div>
  );
}

function TaskGroup({ tasks, name, boardRef }: { tasks: readonly ConversationTask[]; name: string; boardRef: string }) {
  if (tasks.length === 0) return null;
  return (
    <Collapsible className="group/tasks px-1" data-testid="shift-coordinator-task-group" data-group={name}>
      <CollapsibleTrigger className="inline-flex items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground">
        <span className={name === "errored" ? "text-destructive" : undefined}>
          {tasks.length} {name}
        </span>
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/tasks:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="outline-none">
        <TaskList tasks={tasks} boardRef={boardRef} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Each task opens its session on the conversation's board. */
function TaskList({ tasks, boardRef }: { tasks: readonly ConversationTask[]; boardRef: string }) {
  return (
    <ul className="space-y-0.5" data-testid="shift-coordinator-tasks">
      {tasks.map((task) => (
        <li
          key={task.id}
          className="flex items-start gap-2 px-1 py-1 text-sm"
          data-testid="shift-coordinator-task"
          data-task-id={task.id}
          data-status={task.status}
        >
          <StateSquare state={STATE_OF_COLUMN[columnFor(task.status)]} className="mt-1.5" />
          <RouteLink
            to={{ level: "task", boardRef, taskId: task.id, tab: "session" }}
            className="min-w-0 text-left hover:underline"
            data-testid="shift-coordinator-task-open"
          >
            <span className="line-clamp-2">{task.title || task.goal}</span>
            <span className="block text-xs text-muted-foreground">
              {task.status} · {task.assignee == null ? "unassigned" : workerLabel(task.assignee)}
            </span>
          </RouteLink>
        </li>
      ))}
    </ul>
  );
}
