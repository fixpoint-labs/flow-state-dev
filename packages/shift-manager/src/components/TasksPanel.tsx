/**
 * TASKS, at Shift Coordinator (FIX-1794 S11): the tasks the person's
 * conversation filed for its delegates, as the conversation's own
 * `listTasks` answers them (`lib/conversation-tasks.ts`). Each conversation
 * keeps a board of its own, so this reads that one board and nothing else.
 *
 * It reads when it opens and again each time the Lab is read again
 * (`readAt`), which is after each turn the person sends: a task filed or
 * reassigned in that turn shows then. Nothing here knows a tool's name. A
 * task that ends between turns shows at the next read.
 */
import { useEffect, useState } from "react";
import { columnFor } from "../lib/columns";
import { readConversationTasks, type ConversationTask } from "../lib/conversation-tasks";
import { useLab } from "../lib/lab-data";
import { describeFailure, type Seat } from "../lib/reads";
import { STATE_OF_COLUMN, StateSquare } from "./ui";

type Read = { tasks: ConversationTask[] } | { failure: string } | undefined;

export function TasksPanel({ seat, sessionId, readAt }: { seat: Seat; sessionId: string | null; readAt: number }) {
  const { clients } = useLab();
  const [read, setRead] = useState<Read>(undefined);

  // Another conversation's tasks never show under this one. A read again of the
  // same conversation keeps its list up until the new answer lands.
  useEffect(() => setRead(undefined), [seat.kind, sessionId]);

  useEffect(() => {
    if (sessionId === null || seat.kind === null) return;
    let closed = false;
    readConversationTasks(clients, seat.kind, sessionId)
      .then((tasks) => !closed && setRead({ tasks }))
      .catch((error: unknown) => !closed && setRead({ failure: describeFailure(error).message }));
    return () => {
      closed = true;
    };
  }, [clients, seat.kind, sessionId, readAt]);

  if (sessionId === null || seat.kind === null) {
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
  return (
    <ul className="space-y-0.5" data-testid="cos-tasks">
      {read.tasks.map((task) => (
        <li
          key={task.id}
          className="flex items-start gap-2 px-1 py-1 text-sm"
          data-testid="cos-task"
          data-task-id={task.id}
          data-status={task.status}
        >
          <StateSquare state={STATE_OF_COLUMN[columnFor(task.status)]} className="mt-1.5" />
          <span className="min-w-0">
            <span className="line-clamp-2">{task.goal}</span>
            <span className="block text-xs text-muted-foreground">
              {task.status} · {task.assignee ?? "unassigned"}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
