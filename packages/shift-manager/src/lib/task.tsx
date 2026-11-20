// BR-3; FIX-2776.
/**
 * One open task: its row, the run the row's link names, that run's state, and
 * the asks it waits on. Held once for the task screen and its inspector, so
 * the centre and the right panel always read the same row and the same run.
 *
 * **The row.** From orchestration's task-list view on the conversation that
 * holds the board (`taskListViewRef`, through `useConversationTasks`), kept
 * live by the server: a row filed, linked, moved or settled in any session,
 * on any process, reaches the screen with no re-read of its own. While the
 * row is not on the board yet, or is `in_progress` with no run linked, or its
 * linked run settled on a row the board may still hand on, the screen says it
 * waits. A task the board doesn't hold (a stale link, a deleted task, a
 * mistyped address) waits the same way for {@link MISSING_FOR_MS} at most,
 * counted from the view's first answer, then is called missing. A view whose
 * read failed shows that failure, never "no such task".
 *
 * **The run.** Bound to the session and request the row's link names, and the
 * flow that session records as its owner, read once per open, and again only
 * when the link names a new session.
 *
 * **Its state.** The run's own request stream (react's `useRequestStream`,
 * through the run's flow) is the only thing that moves the run's state on
 * screen, with when it ended. Interrupt stops that one request through
 * workforce's `stopRun` and draws *interrupted* only once the stream reads
 * `aborted` (the run's record decides).
 *
 * A task's asks are not read here: the screens read them from the Inbox
 * view (`inbox.ts`).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { RequestStatus } from "@flow-state-dev/core/types";
import type { BoardActions } from "@flow-state-dev/orchestration/inbox";
import { useRequestStream } from "@flow-state-dev/react";
import { useConversationTasks, type ConversationTask } from "./conversation-tasks";
import { useLab } from "./lab-data";
import { useSessions } from "./directory";
import { useBoardActions } from "./inbox";
import { describeFailure, type Failure } from "./failure";
import { useWorkforce } from "./workforce";
import { resolveRunFlow } from "./task-items";

/**
 * How long a task the board doesn't hold is waited for before the screen says
 * so, counted from the view's first answer. Filing it is a row write, which
 * the view hears, so the wait needs no reads of its own, only this deadline.
 */
export const MISSING_FOR_MS = 10_000;

/** How long an Interrupt waits for the run's stream to say it ended. */
const STOP_TIMEOUT_MS = 30_000;

/** The board id every conversation's board goes by: `<sessionId>.tasks` names it. */
const CONVERSATION_BOARD = "tasks";

/** The session a board ref names as its holder: everything before its last dot. */
function holderSessionOf(boardRef: string): string {
  const dot = boardRef.lastIndexOf(".");
  return dot > 0 ? boardRef.slice(0, dot) : boardRef;
}

/** Whether `boardRef` names a conversation's board (`<sessionId>.tasks`), the only boards there are. */
function isConversationBoard(boardRef: string): boolean {
  return boardRef === `${holderSessionOf(boardRef)}.${CONVERSATION_BOARD}`;
}

/** A run the screen can open: the row's link, and the flow its session names. */
export type OpenRun = { sessionId: string; requestId: string; attempt: number; flowId: string };

/**
 * One row as the task screen draws it: the task-list view's row, on its
 * board, with each field it may leave out read as none.
 */
export type OpenTask = Omit<ConversationTask, "title" | "assignee" | "run" | "startedAt" | "error" | "deps" | "attachments" | "holds"> & {
  boardRef: string;
  title: string;
  assignee: string | null;
  run: { sessionId: string; requestId: string; attempt: number } | null;
  startedAt: number | null;
  error: string | null;
  deps: string[];
  attachments: NonNullable<ConversationTask["attachments"]>;
  holds: NonNullable<ConversationTask["holds"]>;
};

/** `task` as the screen draws it, on `boardRef`. */
function rowOf(boardRef: string, task: ConversationTask): OpenTask {
  return {
    ...task,
    boardRef,
    title: task.title ?? task.goal,
    assignee: task.assignee ?? null,
    run: task.run == null ? null : { sessionId: task.run.sessionId, requestId: task.run.requestId, attempt: task.run.attempt },
    startedAt: task.startedAt ?? null,
    error: task.error ?? null,
    deps: task.deps ?? [],
    attachments: task.attachments ?? [],
    holds: task.holds ?? [],
  };
}

/** Where the run stands for the screen. */
export type RunState =
  | { kind: "none" }
  | { kind: "resolving" }
  | { kind: "open"; run: OpenRun }
  | { kind: "failed"; failure: Failure };

/** Where an Interrupt stands. */
export type InterruptState = { kind: "idle" } | { kind: "pending" } | { kind: "refused"; message: string };

/** Everything the task screen and its inspector read. */
export type TaskView = {
  boardRef: string;
  taskId: string;
  row: OpenTask | undefined;
  /** Every row on this task's board, from the same view as `row`. */
  boardRows: OpenTask[];
  rowFailure: Failure | undefined;
  /** The screen waits for the row, or its run's link. */
  waiting: boolean;
  /** The board doesn't hold the task: its wait's deadline passed with no answer naming the row. */
  gaveUp: boolean;
  retryRow(): void;
  run: RunState;
  retryRun(): void;
  /** The run's request status, as its stream last said. */
  status: RequestStatus | undefined;
  interrupt: InterruptState;
  requestInterrupt(): Promise<void>;
  /** When an aborted run stopped, by its stream; `undefined` while it hasn't. */
  stoppedAt: number | undefined;
  devtoolUrl: string | undefined;
  /** The board's task actions, on the conversation that holds the board; `undefined` with no owner to run them. */
  board: BoardActions | undefined;
  // FIX-2009.
  /** Request ids this composer started, newest last, for this open task only: the Session follows each. */
  sent: readonly string[];
  noteSent(requestId: string): void;
};

const TaskContext = createContext<TaskView | null>(null);

/** The open task's view. Throws outside a {@link TaskProvider}. */
export function useTask(): TaskView {
  const value = useContext(TaskContext);
  if (value === null) throw new Error("useTask: no TaskProvider above this component");
  return value;
}

/** A row the board may still hand to a run: queued or running, not finished or failed. */
function isOpen(row: OpenTask): boolean {
  return row.status === "pending" || row.status === "in_progress";
}

/** Hold one open task. */
export function TaskProvider({ boardRef, taskId, devtoolUrl, children }: { boardRef: string; taskId: string; devtoolUrl?: string; children: ReactNode }) {
  const { client } = useLab();
  const sessions = useSessions().list;
  const workforce = useWorkforce();
  const holder = holderSessionOf(boardRef);
  const conversationBoard = isConversationBoard(boardRef);
  // The board's actions run on the conversation that holds it, through the
  // flow that conversation's session names as its owner. No owner, no actions.
  const holderFlowId = !conversationBoard ? undefined : (sessions?.find((session) => session.id === holder)?.flowId ?? undefined);
  const board = useBoardActions(holderFlowId === undefined ? undefined : { id: holder, flowId: holderFlowId });

  // ---- the row: the holding conversation's flow, read once, then its board's view.
  const [holderFlow, setHolderFlow] = useState<{ flow: string } | { failure: Failure } | undefined>(undefined);
  const [flowReads, setFlowReads] = useState(0);
  useEffect(() => {
    if (!conversationBoard) return;
    let live = true;
    setHolderFlow(undefined);
    client.sessions.get(holder).then(
      (session) => live && setHolderFlow({ flow: session.flowId ?? session.flowKind }),
      (error: unknown) => live && setHolderFlow({ failure: describeFailure(error) }),
    );
    return () => {
      live = false;
    };
  }, [client, holder, conversationBoard, flowReads]);
  const flow = holderFlow !== undefined && "flow" in holderFlow ? holderFlow.flow : null;
  const { tasks, stale } = useConversationTasks(flow, conversationBoard ? holder : null);
  const boardRows = useMemo(() => (tasks ?? []).map((task) => rowOf(boardRef, task)), [tasks, boardRef]);
  const row = boardRows.find((r) => r.id === taskId);
  const boardRead = tasks !== undefined;
  const rowFailure: Failure | undefined =
    holderFlow !== undefined && "failure" in holderFlow
      ? holderFlow.failure
      : stale && !boardRead
        ? { message: "This task's board didn't load. Shift Manager reads it again on its own." }
        : undefined;

  // The missing row's deadline: a timer only, from the view's first answer, and afresh from each Retry.
  const [missedOut, setMissedOut] = useState(false);
  const [rowRetries, setRowRetries] = useState(0);
  const missing = row === undefined;
  useEffect(() => {
    if (!missing) setMissedOut(false);
  }, [missing]);
  useEffect(() => {
    if (!missing || !boardRead || !conversationBoard) return;
    const timer = setTimeout(() => setMissedOut(true), MISSING_FOR_MS);
    return () => clearTimeout(timer);
  }, [missing, boardRead, conversationBoard, rowRetries]);

  // ---- the run: the link's session and request, and the flow its session names.
  const link = row?.run ?? null;
  const [runFlow, setRunFlow] = useState<{ sessionId: string; flowId: string } | { sessionId: string; failure: Failure } | undefined>();
  const [retries, setRetries] = useState(0);
  const linkedSession = link?.sessionId;
  useEffect(() => {
    if (linkedSession === undefined) return;
    let live = true;
    setRunFlow(undefined);
    resolveRunFlow(client, linkedSession).then(
      (flowId) => live && setRunFlow({ sessionId: linkedSession, flowId }),
      (error: unknown) => live && setRunFlow({ sessionId: linkedSession, failure: describeFailure(error) }),
    );
    return () => {
      live = false;
    };
  }, [client, linkedSession, retries]);
  const flowId = runFlow !== undefined && "flowId" in runFlow && runFlow.sessionId === link?.sessionId ? runFlow.flowId : undefined;
  const linkedRequest = link?.requestId;
  const linkedAttempt = link?.attempt;
  const openRun = useMemo<OpenRun | undefined>(
    () =>
      linkedSession === undefined || linkedRequest === undefined || linkedAttempt === undefined || flowId === undefined
        ? undefined
        : { sessionId: linkedSession, requestId: linkedRequest, attempt: linkedAttempt, flowId },
    [linkedSession, linkedRequest, linkedAttempt, flowId],
  );

  // The run's own stream: its status, and when it ended. Items come from the session's feed.
  const stream = useRequestStream({
    client,
    flowKind: openRun?.flowId ?? "-",
    source: { requestId: openRun?.requestId ?? "-" },
    filter: { itemTypes: [] },
    flush: "immediate",
    reconnect: true,
    reconnectToken: retries,
    enabled: openRun !== undefined,
  });
  // The stream reconnects on its own, and ends only on a 401, 403 or 404: one that ended while the
  // request still reads in progress is a request that isn't there, or isn't the user's.
  const unreadable = openRun !== undefined && !stream.isStreaming && stream.status === "in_progress";
  const status: RequestStatus | undefined = openRun === undefined || unreadable ? undefined : stream.status;

  const run: RunState = useMemo(() => {
    if (link === null) return { kind: "none" };
    if (runFlow !== undefined && "failure" in runFlow && runFlow.sessionId === link.sessionId) return { kind: "failed", failure: runFlow.failure };
    if (openRun === undefined) return { kind: "resolving" };
    if (unreadable) return { kind: "failed", failure: { message: "The run's request couldn't be read: it isn't there, or it isn't yours." } };
    return { kind: "open", run: openRun };
  }, [link, runFlow, openRun, unreadable]);

  const linkSettled = status !== undefined && status !== "in_progress";
  const awaitingNextRun = row !== undefined && row.run !== null && linkSettled && isOpen(row);
  const awaitingLink = row === undefined || (row.status === "in_progress" && row.run === null);
  const gaveUp = boardRead && missing && rowFailure === undefined && missedOut;
  // Until the view first answers, the screen waits for it too: nothing is known missing yet.
  const waiting = conversationBoard && (!boardRead || awaitingLink || awaitingNextRun) && rowFailure === undefined && !gaveUp;

  // ---- Interrupt: the one write this screen makes, besides the composer's line and the board's actions.
  const [interrupt, setInterrupt] = useState<InterruptState>({ kind: "idle" });
  useEffect(() => setInterrupt({ kind: "idle" }), [openRun?.requestId]);
  // The stream says how it ended: *interrupted* is drawn from there, never from the stop's answer.
  useEffect(() => {
    if (interrupt.kind === "pending" && status !== undefined && status !== "in_progress") setInterrupt({ kind: "idle" });
  }, [interrupt.kind, status]);
  useEffect(() => {
    if (interrupt.kind !== "pending") return;
    const timer = setTimeout(
      () => setInterrupt({ kind: "refused", message: "The abort was recorded, but the run has not stopped yet. It may still be running." }),
      STOP_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [interrupt.kind]);
  const requestInterrupt = useCallback(async () => {
    if (openRun === undefined || interrupt.kind === "pending") return;
    setInterrupt({ kind: "pending" });
    try {
      await workforce.stopRun(openRun.sessionId, openRun.requestId);
    } catch (error) {
      setInterrupt({ kind: "refused", message: describeFailure(error).message });
    }
  }, [workforce, openRun, interrupt.kind]);

  const [sent, setSent] = useState<string[]>([]);
  useEffect(() => setSent([]), [boardRef, taskId]);
  const noteSent = useCallback((requestId: string) => setSent((held) => (held.includes(requestId) ? held : [...held, requestId])), []);

  const value: TaskView = {
    boardRef,
    taskId,
    row,
    boardRows,
    rowFailure,
    waiting,
    gaveUp,
    // The view is live: Retry reads the holder's flow again when that failed, and waits a fresh deadline.
    retryRow: () => {
      setMissedOut(false);
      setRowRetries((n) => n + 1);
      if (holderFlow !== undefined && "failure" in holderFlow) setFlowReads((n) => n + 1);
    },
    run,
    retryRun: () => setRetries((n) => n + 1),
    status,
    interrupt,
    requestInterrupt,
    stoppedAt: status === "aborted" ? stream.completedAt : undefined,
    devtoolUrl,
    board,
    sent,
    noteSent,
  };
  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}
