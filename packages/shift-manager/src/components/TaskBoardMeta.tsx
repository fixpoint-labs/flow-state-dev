/**
 * The feed's task board. One card per task the turn filed on the conversation's
 * board; status comes from that board, because the feed only holds the task as
 * filed. Any other board is drawn by `TaskPlan` (`flow-state/task-plan.tsx`,
 * byte-equal to the registry, no router).
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ComponentItem, OutputItem } from "@flow-state-dev/core/items";
import { ERROR_REPORTER_FLOW } from "@flow-state-dev/workforce/browser";
import { SessionItemsProvider, useSessionItems } from "./flow-state/session-items-context";
import { TaskPlan } from "./flow-state/task-plan";
import { extractTaskPlanState, TASK_CHANGE_COMPONENT } from "./flow-state/task-plan-state";
import { isOpen, TASKS_POLL_MS } from "./TasksPanel";
import { STATE_OF_COLUMN, StateSquare } from "./ui";
import { columnFor } from "../lib/columns";
import { useConversationSession } from "../lib/conversation";
import { readConversationTasks, type ConversationTask } from "../lib/conversation-tasks";
import { workerLabel } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { CONVERSATION_BOARD_COLLECTION, conversationBoardRef } from "../lib/reads";
import { navigate } from "../lib/routes";

/** The board the surrounding feed's session keeps, and its tasks as last read; `{}` outside a {@link SessionScope}. */
type Board = { boardRef?: string; read?: ReadonlyMap<string, ConversationTask> };
const BoardContext = createContext<Board>({});

/**
 * What a conversation's feed reads: the session's items, and the board that
 * session keeps. A feed holds one session's own items (a delegate run's live
 * in its own session's feed), so the board its task cards show is that
 * session's, not one read from the item: every conversation's board shares
 * one `collectionId`, which names no board.
 */
export function SessionScope({
  sessionId,
  flow,
  items,
  children,
}: {
  sessionId: string;
  /** The flow the session runs on, which answers its `listTasks`. Absent, the cards draw the feed's record. */
  flow?: string | null;
  items: OutputItem[];
  children: ReactNode;
}) {
  const boardRef = conversationBoardRef(sessionId);
  const filed = useMemo(() => items.some(isConversationTaskChange), [items]);
  const scoped = <SessionItemsProvider value={items}>{children}</SessionItemsProvider>;
  if (flow == null || !filed) return <BoardContext.Provider value={{ boardRef }}>{scoped}</BoardContext.Provider>;
  return (
    <LiveBoard flow={flow} sessionId={sessionId} boardRef={boardRef}>
      {scoped}
    </LiveBoard>
  );
}

function isConversationTaskChange(item: OutputItem): boolean {
  return (
    item.type === "component" &&
    item.component === TASK_CHANGE_COMPONENT &&
    (item.data as { collectionId?: string } | undefined)?.collectionId === CONVERSATION_BOARD_COLLECTION
  );
}

/**
 * A failed read leaves the last one, or the feed's record, and is tried again while a task could be moving.
 * A read that shows a task moved reloads the Lab, so what the snapshot counts agrees with the card.
 */
function LiveBoard({ flow, sessionId, boardRef, children }: { flow: string; sessionId: string; boardRef: string; children: ReactNode }) {
  const { client, snapshot, refresh } = useLab();
  const readAt = snapshot !== undefined && "readAt" in snapshot ? snapshot.readAt : undefined;
  const [read, setRead] = useState<{ sessionId: string; tasks: ReadonlyMap<string, ConversationTask> } | undefined>(undefined);
  const [polls, setPolls] = useState(0);
  // Whether the last read left a task that can still move; before any read lands, assume one can.
  const moving = useRef(true);
  // Each task and where it stood at the last read.
  const standing = useRef<string | undefined>(undefined);
  useEffect(() => {
    moving.current = true;
    standing.current = undefined;
  }, [flow, sessionId]);

  useEffect(() => {
    let closed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    readConversationTasks(client, flow, sessionId)
      .then((tasks) => {
        if (closed) return;
        setRead({ sessionId, tasks: new Map(tasks.map((task) => [task.id, task])) });
        const now = tasks.map((task) => `${task.id}:${task.status}`).join(",");
        if (standing.current !== undefined && standing.current !== now) void refresh();
        standing.current = now;
        moving.current = tasks.some(isOpen);
        if (moving.current) next = setTimeout(() => setPolls((n) => n + 1), TASKS_POLL_MS);
      })
      .catch(() => {
        if (!closed && moving.current) next = setTimeout(() => setPolls((n) => n + 1), TASKS_POLL_MS);
      });
    return () => {
      closed = true;
      if (next !== undefined) clearTimeout(next);
    };
  }, [client, refresh, flow, sessionId, readAt, polls]);

  const board = useMemo(() => ({ boardRef, read: read?.sessionId === sessionId ? read.tasks : undefined }), [boardRef, read, sessionId]);
  return <BoardContext.Provider value={board}>{children}</BoardContext.Provider>;
}

export function TaskBoardMeta({ item }: { item: ComponentItem }) {
  const { boardRef, read } = useContext(BoardContext);
  const collectionId = (item.data as { collectionId?: string } | undefined)?.collectionId;
  if (collectionId === undefined) return null;
  // Only the conversation's own ledger is a board this route opens; another collection's task ids name nothing there.
  if (boardRef === undefined || collectionId !== CONVERSATION_BOARD_COLLECTION) {
    return <TaskPlan collectionId={collectionId} requestId={item.requestId} />;
  }
  return <FiledTasks requestId={item.requestId} boardRef={boardRef} read={read} />;
}

function FiledTasks({ requestId, boardRef, read }: { requestId: string; boardRef: string; read?: ReadonlyMap<string, ConversationTask> }) {
  const items = useSessionItems();
  const entries = useMemo(
    () => extractTaskPlanState(items.filter((item) => item.requestId === requestId), CONVERSATION_BOARD_COLLECTION).tasks,
    [items, requestId],
  );
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col">
      {entries.map(({ task }) => (
        <TaskCard key={task.id} task={read?.get(task.id) ?? task} boardRef={boardRef} />
      ))}
    </div>
  );
}

const STATUS_WORD: Record<string, string> = { pending: "queued", in_progress: "running" };

function TaskCard({ task, boardRef }: { task: Pick<ConversationTask, "id" | "goal" | "title" | "status" | "assignee">; boardRef: string }) {
  const status = task.status;
  const name = task.title || task.goal;
  return (
    <div className="group/task flex flex-wrap items-center gap-2 py-0.5 text-sm" data-testid="task-card" data-task-id={task.id} data-status={status}>
      <StateSquare state={STATE_OF_COLUMN[columnFor(status)]} />
      <span className="min-w-0 truncate">{name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {task.assignee == null ? "unassigned" : workerLabel(task.assignee)} ·{" "}
        <span className={status === "errored" ? "text-destructive" : undefined}>{STATUS_WORD[status] ?? status}</span>
      </span>
      <button
        type="button"
        className="shrink-0 text-xs text-muted-foreground opacity-60 hover:text-foreground hover:opacity-100 focus-visible:opacity-100 group-hover/task:opacity-100"
        data-testid="task-open"
        aria-label={`Open ${name}`}
        onClick={() => navigate({ level: "task", boardRef, taskId: task.id, tab: "session" })}
      >
        Open ›
      </button>
      {status === "cancelled" ? <CancelledNote taskId={task.id} /> : null}
    </div>
  );
}

/**
 * Under a cancelled task: a cancel isn't reported, so a user who cancelled
 * because something went wrong tells the Error Reporter, naming the task.
 * Drawn only when the Lab's inventory has an Error Reporter.
 */
function CancelledNote({ taskId }: { taskId: string }) {
  const { snapshot } = useLab();
  const loaded = snapshot !== undefined && "inventory" in snapshot ? snapshot : undefined;
  const reporter = loaded?.inventory?.ok ? loaded.inventory.value.workers.find((worker) => worker.kind === ERROR_REPORTER_FLOW) : undefined;
  const sessionId = useConversationSession(reporter, loaded?.sessions ?? []);
  if (reporter === undefined) return null;
  const name = reporter.name || "the Error Reporter";
  return (
    <p className="basis-full text-xs text-muted-foreground" data-testid="task-cancelled-note">
      Cancelled because something went wrong? Tell{" "}
      {sessionId === null ? (
        name
      ) : (
        <button
          type="button"
          className="underline hover:text-foreground"
          data-testid="task-cancelled-report"
          onClick={() => navigate({ level: "session", sessionId })}
        >
          {name}
        </button>
      )}{" "}
      what happened, and name this task ({taskId}).
    </p>
  );
}
