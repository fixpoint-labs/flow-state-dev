/**
 * The feed's task board. On the conversation's own board, each turn that
 * filed a task draws one card for it: its title, its worker, where it stands,
 * and Open, which goes to that task's session. The conversation's whole list
 * is the rail's (`TasksPanel`), so the feed doesn't repeat it.
 *
 * Where a task stands comes from the board, not the feed. A delegate settles
 * the task in its own session, so the conversation's feed only ever holds the
 * task as it was filed. {@link SessionScope} reads the conversation's
 * `listTasks` while a task on it can still move, and again each time the Lab
 * is read, and the cards draw that read.
 *
 * Any other board (a plan a worker runs in its own turn) is drawn whole by
 * `flow-state/task-plan.tsx`, the registry's copy, which stays byte-equal to
 * it and knows no router. This swaps in for the `task-board-meta` renderer in
 * {@link shiftManagerRenderers}.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ComponentItem, OutputItem } from "@flow-state-dev/core/items";
import { SessionItemsProvider, useSessionItems } from "./flow-state/session-items-context";
import { TaskPlan } from "./flow-state/task-plan";
import { extractTaskPlanState, TASK_CHANGE_COMPONENT } from "./flow-state/task-plan-state";
import { isOpen, TASKS_POLL_MS } from "./TasksPanel";
import { STATE_OF_COLUMN, StateSquare } from "./ui";
import { columnFor, readStatus } from "../lib/columns";
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
 *
 * With the session's `flow`, and once the feed holds a task on that board,
 * the board is read for where its tasks stand. One read serves every card.
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
 * Reads the conversation's board when the feed opens and each time the Lab is
 * read, and every {@link TASKS_POLL_MS} while a task on it is queued or
 * running. A read that fails leaves the last one, or the feed's record, standing.
 */
function LiveBoard({ flow, sessionId, boardRef, children }: { flow: string; sessionId: string; boardRef: string; children: ReactNode }) {
  const { clients, snapshot } = useLab();
  const readAt = snapshot !== undefined && "readAt" in snapshot ? snapshot.readAt : undefined;
  const [read, setRead] = useState<{ sessionId: string; tasks: ReadonlyMap<string, ConversationTask> } | undefined>(undefined);
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    let closed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    readConversationTasks(clients, flow, sessionId)
      .then((tasks) => {
        if (closed) return;
        setRead({ sessionId, tasks: new Map(tasks.map((task) => [task.id, task])) });
        if (tasks.some(isOpen)) next = setTimeout(() => setPolls((n) => n + 1), TASKS_POLL_MS);
      })
      .catch(() => undefined);
    return () => {
      closed = true;
      if (next !== undefined) clearTimeout(next);
    };
  }, [clients, flow, sessionId, readAt, polls]);

  // Another conversation's read never stands for this one.
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

/** One card per task the turn `requestId` filed or moved, as the board last read it. */
function FiledTasks({ requestId, boardRef, read }: { requestId: string; boardRef: string; read?: ReadonlyMap<string, ConversationTask> }) {
  const items = useSessionItems();
  const entries = useMemo(
    () => extractTaskPlanState(items.filter((item) => item.requestId === requestId), CONVERSATION_BOARD_COLLECTION).tasks,
    [items, requestId],
  );
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(({ task }) => (
        <TaskCard key={task.id} task={read?.get(task.id) ?? task} boardRef={boardRef} />
      ))}
    </div>
  );
}

/** What the card says a status is, where the stored word isn't one a reader uses. */
const STATUS_WORD: Record<string, string> = { pending: "queued", in_progress: "running", parked: "needs you" };

function TaskCard({ task, boardRef }: { task: Pick<ConversationTask, "id" | "goal" | "title" | "status" | "assignee">; boardRef: string }) {
  const status = readStatus(task.status);
  const name = task.title || task.goal;
  return (
    <div className="flex items-center gap-2.5 border px-3 py-2 text-sm" data-testid="task-card" data-task-id={task.id} data-status={status}>
      <StateSquare state={STATE_OF_COLUMN[columnFor(status)]} />
      <div className="min-w-0 flex-1">
        <p className="truncate">{name}</p>
        <p className="text-xs text-muted-foreground">
          {task.assignee == null ? "unassigned" : workerLabel(task.assignee)} ·{" "}
          <span className={status === "errored" ? "text-destructive" : undefined}>{STATUS_WORD[status] ?? status}</span>
        </p>
      </div>
      <button
        type="button"
        className="shrink-0 text-xs text-muted-foreground underline hover:text-foreground"
        data-testid="task-open"
        aria-label={`Open ${name}`}
        onClick={() => navigate({ level: "task", boardRef, taskId: task.id, tab: "session" })}
      >
        Open
      </button>
    </div>
  );
}
