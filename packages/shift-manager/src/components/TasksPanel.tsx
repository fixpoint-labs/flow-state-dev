// FIX-1794 S11; FIX-2286; FIX-2429; FIX-2623.
/**
 * TASKS, at Shift Coordinator: the tasks the user's
 * conversation filed for its delegates, as the conversation's own
 * task-list view answers them (`lib/conversation-tasks.ts`), which stores
 * nothing, so a look costs no request. Each conversation
 * keeps a board of its own, so this watches that one board and nothing else.
 *
 * The view keeps it current: a task filed, moved or settled in any session,
 * on any process, reaches it, and it names no topic. Where push can miss a
 * change, the view's own timer reads it again (`useConversationTasks`).
 * Nothing here knows a tool's name.
 */
import { useEffect, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { columnFor, isDone } from "../lib/columns";
import { workerLabel } from "../lib/derive";
import {
  pullRequestsWaitedOn,
  readPullRequestLinks,
  useConversationTasks,
  type ConversationTask,
} from "../lib/conversation-tasks";
import { useLab } from "../lib/lab-data";
import { conversationBoardRef, type Worker } from "../lib/reads";
import { RouteLink } from "./RouteLink";
import { STATE_OF_COLUMN, StateSquare } from "./ui";

const isErrored = (task: ConversationTask) => task.status === "errored";

export function TasksPanel({
  worker,
  sessionId,
  activeOnly = false,
}: {
  worker: Worker;
  sessionId: string | null;
  /** List only the active tasks, with the done and the errored each folded into a closed group. */
  activeOnly?: boolean;
}) {
  const { tasks, stale } = useConversationTasks(worker.kind, sessionId);

  if (sessionId === null || worker.kind === null) {
    return (
      <p className="px-1 text-xs text-muted-foreground" data-testid="shift-coordinator-tasks-none">
        Tasks belong to a conversation. Say something to start one.
      </p>
    );
  }
  if (tasks === undefined && !stale) {
    return (
      <p className="px-1 text-xs text-muted-foreground" data-testid="shift-coordinator-tasks-reading">
        Reading the tasks…
      </p>
    );
  }
  if (tasks === undefined) {
    // Generic by design: a view answers `{ value, stale }`, with no failure reason to show.
    return (
      <p className="px-1 text-xs text-destructive" data-testid="shift-coordinator-tasks-failure">
        The tasks didn't load. They are read again on their own.
      </p>
    );
  }
  if (tasks.length === 0) {
    return (
      <p className="px-1 text-xs text-muted-foreground" data-testid="shift-coordinator-tasks-empty">
        This conversation hasn't filed a task.
      </p>
    );
  }
  const boardRef = conversationBoardRef(sessionId);
  if (!activeOnly) return <TaskList tasks={tasks} boardRef={boardRef} />;
  const done = tasks.filter((task) => isDone(task.status));
  const errored = tasks.filter(isErrored);
  const active = tasks.filter((task) => !isDone(task.status) && !isErrored(task));
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

/** The line a task waiting on its pull request offers, while nothing tells it of a merge. */
const PULL_REQUEST_HINT = "Merged? Say so here and I'll check.";

/**
 * A task waiting on its pull request: *PR open · #7*, each number linked once
 * its run session's record is read, and how to wake it (a line in its session).
 */
function PullRequestOpen({ task }: { task: ConversationTask }) {
  const { client } = useLab();
  const waited = pullRequestsWaitedOn(task);
  const runSessionId = waited?.runSessionId ?? null;
  const [links, setLinks] = useState<ReadonlyMap<number, string>>(new Map());
  useEffect(() => {
    if (runSessionId === null) return;
    let current = true;
    void readPullRequestLinks(client, runSessionId).then((read) => {
      if (current) setLinks(read);
    });
    return () => {
      current = false;
    };
  }, [client, runSessionId, waited?.numbers.join(",")]);
  return (
    <span className="ml-auto shrink-0 text-right text-xs text-muted-foreground" data-testid="shift-coordinator-task-pull-request">
      <span data-testid="pull-request-wait">
        PR open
        {(waited?.numbers ?? []).map((n, i) => (
          <span key={n}>
            {i === 0 ? " · " : ", "}
            {links.has(n) ? (
              <a href={links.get(n)} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                #{n}
              </a>
            ) : (
              `#${n}`
            )}
          </span>
        ))}
      </span>
      <span className="block" data-testid="pull-request-hint">
        {PULL_REQUEST_HINT}
      </span>
    </span>
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
          {pullRequestsWaitedOn(task) === undefined ? null : <PullRequestOpen task={task} />}
        </li>
      ))}
    </ul>
  );
}
