/**
 * One open task: its row, the run the row's link names, and that run's state.
 * Held once for the task screen and its inspector, so the centre and the right
 * panel always read the same row and the same run.
 *
 * **The row.** From the snapshot, then from one board's re-read. While the row
 * is not on the board yet, or is `in_progress` with no run linked, it is
 * re-read every 2 s, at most 30 times (BR-3): the run writes its link as it
 * starts, and nothing pushes that to a view following another session. Once
 * the linked run settles on a row still queued or running, it is re-read the
 * same way, in a fresh window, until the row links the next attempt; the
 * screen then follows that run. A row in any other state is not re-read.
 * Retry reads the board once, now, and starts one more window. A board whose
 * read failed shows that failure, never "no such task".
 *
 * **The run.** Bound to the session and request the row's link names, and the
 * flow that session records as its owner. The flow is read once per open, and
 * again only when the link names a new session. A tab switch never re-reads
 * anything here.
 *
 * **Its state.** The run's request record, read through the run's flow, is
 * the only thing that moves the run's state on screen. Interrupt aborts that
 * request and draws *interrupted* only once the record reads `aborted`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RequestStatus } from "@flow-state-dev/core/types";
import { readStatus } from "./columns";
import { allRows, type LoadedSnapshot } from "./derive";
import { useLab } from "./lab-data";
import { describeFailure, type BoardRow, type Failure } from "./reads";
import { interruptRun, readRunStatus, resolveRunFlow, RunReadError, type OpenRun } from "./run";

/** How often, and how many times, a task screen re-reads its row. */
export const REREAD_EVERY_MS = 2_000;
export const REREAD_AT_MOST = 30;

/** The channel a board ref belongs to: everything before its last dot. */
export function channelOf(boardRef: string): string {
  const dot = boardRef.lastIndexOf(".");
  return dot > 0 ? boardRef.slice(0, dot) : boardRef;
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
  row: BoardRow | undefined;
  /** Every row on this task's board, from the same read as `row`. */
  boardRows: BoardRow[];
  rowFailure: Failure | undefined;
  /** The row is being re-read while its link is awaited. */
  waiting: boolean;
  /** The re-read window ran out with no link. */
  gaveUp: boolean;
  retryRow(): void;
  run: RunState;
  retryRun(): void;
  /** The run's request status, as its record last read. */
  status: RequestStatus | undefined;
  /** The request record moved (from the live stream or a read). */
  reportStatus(status: string): void;
  interrupt: InterruptState;
  requestInterrupt(): Promise<void>;
  devtoolUrl: string | undefined;
};

const TaskContext = createContext<TaskView | null>(null);

/** The open task's view. Throws outside a {@link TaskProvider}. */
export function useTask(): TaskView {
  const value = useContext(TaskContext);
  if (value === null) throw new Error("useTask: no TaskProvider above this component");
  return value;
}

/** Whether the row should be re-read while the screen waits (BR-3). */
function awaitingLink(row: BoardRow | undefined): boolean {
  return row === undefined || (readStatus(row.status) === "in_progress" && row.run === null);
}

/** A row the board may still hand to a run: queued or running, not finished, parked or failed. */
function isOpen(row: BoardRow): boolean {
  const status = readStatus(row.status);
  return status === "pending" || status === "in_progress";
}

/** Hold one open task. */
export function TaskProvider({
  snapshot,
  boardRef,
  taskId,
  devtoolUrl,
  children,
}: {
  snapshot: LoadedSnapshot;
  boardRef: string;
  taskId: string;
  devtoolUrl?: string;
  children: ReactNode;
}) {
  const { clients, reader } = useLab();
  const fromSnapshot = useMemo(() => allRows(snapshot).filter((r) => r.boardRef === boardRef), [snapshot, boardRef]);
  const [boardRows, setBoardRows] = useState<BoardRow[]>(fromSnapshot);
  const [rowFailure, setRowFailure] = useState<Failure | undefined>(undefined);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    setBoardRows(fromSnapshot);
    setReads(0);
  }, [fromSnapshot, taskId]);

  const row = boardRows.find((r) => r.id === taskId);
  // A board the Lab doesn't attach is named at once, with no read (BR-2). A
  // task missing from a board it does attach may have just been filed, so it
  // gets the same bounded re-read as a row waiting for its link. A board whose
  // read failed is neither: the screen shows that failure, with Retry, rather
  // than calling the task missing.
  const channelBoards = snapshot.boards[channelOf(boardRef)];
  const [boardRead, setBoardRead] = useState(false);
  const boardKnown = boardRead || (channelBoards?.ok === true && channelBoards.value.refs.includes(boardRef));
  const boardFailure = rowFailure ?? (!boardRead && channelBoards?.ok === false ? channelBoards.failure : undefined);

  /** One read of this task's board. Every read, polled or not, lands its rows or its failure the same way. */
  const readBoardNow = useCallback(
    () =>
      reader
        .readBoard(channelOf(boardRef), boardRef)
        .then((rows) => {
          setBoardRows(rows);
          setBoardRead(true);
          setRowFailure(undefined);
        })
        .catch((error: unknown) => setRowFailure(describeFailure(error))),
    [reader, boardRef],
  );

  // ---- the run: the link's session and request, and the flow its session names.
  const link = row?.run ?? null;
  const [flow, setFlow] = useState<{ sessionId: string; flowId: string } | { sessionId: string; failure: Failure } | undefined>();
  const [retries, setRetries] = useState(0);
  const linkedSession = link?.sessionId;
  useEffect(() => {
    if (linkedSession === undefined) return;
    let live = true;
    setFlow(undefined);
    resolveRunFlow(clients, linkedSession)
      .then((flowId) => {
        if (live) setFlow({ sessionId: linkedSession, flowId });
      })
      .catch((error: unknown) => {
        if (live) setFlow({ sessionId: linkedSession, failure: error instanceof RunReadError ? error.failure : describeFailure(error) });
      });
    return () => {
      live = false;
    };
  }, [clients, linkedSession, retries]);

  const [status, setStatus] = useState<{ requestId: string; status: RequestStatus } | { requestId: string; failure: Failure } | undefined>();
  const flowId = flow !== undefined && "flowId" in flow && flow.sessionId === link?.sessionId ? flow.flowId : undefined;
  const linkedRequest = link?.requestId;
  const linkedAttempt = link?.attempt;
  const openRun = useMemo<OpenRun | undefined>(
    () =>
      linkedSession === undefined || linkedRequest === undefined || linkedAttempt === undefined || flowId === undefined
        ? undefined
        : { sessionId: linkedSession, requestId: linkedRequest, attempt: linkedAttempt, flowId },
    [linkedSession, linkedRequest, linkedAttempt, flowId],
  );

  // The request record, once per run opened: it decides whether the run is open at all.
  useEffect(() => {
    if (openRun === undefined) return;
    let live = true;
    setStatus(undefined);
    readRunStatus(clients, openRun)
      .then((s) => {
        if (live) setStatus({ requestId: openRun.requestId, status: s });
      })
      .catch((error: unknown) => {
        if (live) setStatus({ requestId: openRun.requestId, failure: error instanceof RunReadError ? error.failure : describeFailure(error) });
      });
    return () => {
      live = false;
    };
  }, [clients, openRun, retries]);

  const run: RunState = useMemo(() => {
    if (link === null) return { kind: "none" };
    if (flow !== undefined && "failure" in flow && flow.sessionId === link.sessionId) return { kind: "failed", failure: flow.failure };
    if (openRun === undefined || status === undefined || status.requestId !== openRun.requestId) return { kind: "resolving" };
    if ("failure" in status) return { kind: "failed", failure: status.failure };
    return { kind: "open", run: openRun };
  }, [link, flow, openRun, status]);

  const currentStatus = status !== undefined && "status" in status && status.requestId === link?.requestId ? status.status : undefined;

  // BR-3's bounded re-read: while the row has no run linked yet, or while the
  // run it links has settled on a row the board may still hand on, until the
  // row links the next attempt (a retry or a reclaim writes a new link). Each
  // settled link starts a fresh window. A failed re-read stops it and shows Retry.
  const linkSettled = currentStatus !== undefined && currentStatus !== "in_progress";
  useEffect(() => {
    if (linkSettled) setReads(0);
  }, [linkSettled, link?.requestId]);
  const awaitingNextRun = row !== undefined && row.run !== null && linkSettled && isOpen(row);
  const waiting = boardKnown && (awaitingLink(row) || awaitingNextRun) && boardFailure === undefined && reads < REREAD_AT_MOST;
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      void readBoardNow().finally(() => setReads((n) => n + 1));
    }, REREAD_EVERY_MS);
    return () => clearTimeout(timer);
  }, [waiting, reads, readBoardNow]);

  const settledOnce = useRef<string | null>(null);
  const reportStatus = useCallback(
    (next: string) => {
      if (openRun === undefined) return;
      setStatus((held) =>
        held !== undefined && held.requestId === openRun.requestId && "status" in held && held.status === next
          ? held
          : { requestId: openRun.requestId, status: next as RequestStatus },
      );
      if (next !== "in_progress" && settledOnce.current !== openRun.requestId) {
        settledOnce.current = openRun.requestId;
        // Read the row once now, to show what the board did next.
        void readBoardNow();
      }
    },
    [openRun, readBoardNow],
  );

  // ---- Interrupt: the one write this screen makes.
  const [interrupt, setInterrupt] = useState<InterruptState>({ kind: "idle" });
  useEffect(() => setInterrupt({ kind: "idle" }), [openRun?.requestId]);
  // Aborted when the task screen closes, so an Interrupt's wait for the record stops with it.
  const mounted = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    mounted.current = controller;
    return () => controller.abort();
  }, []);
  const requestInterrupt = useCallback(async () => {
    if (openRun === undefined || interrupt.kind === "pending") return;
    const signal = mounted.current?.signal;
    setInterrupt({ kind: "pending" });
    try {
      const outcome = await interruptRun(clients, openRun, signal === undefined ? {} : { signal });
      reportStatus(outcome.kind === "aborted" ? "aborted" : outcome.status);
      setInterrupt({ kind: "idle" });
    } catch (error) {
      if (signal?.aborted === true) return;
      setInterrupt({ kind: "refused", message: error instanceof Error ? error.message : String(error) });
    }
  }, [clients, openRun, interrupt.kind, reportStatus]);

  const value: TaskView = {
    boardRef,
    taskId,
    row,
    boardRows,
    rowFailure: boardFailure,
    waiting,
    gaveUp: boardKnown && awaitingLink(row) && boardFailure === undefined && reads >= REREAD_AT_MOST,
    // A read now, then a fresh re-read window if the row is still waiting.
    retryRow: () => {
      setReads(0);
      void readBoardNow();
    },
    run,
    retryRun: () => setRetries((n) => n + 1),
    status: currentStatus,
    reportStatus,
    interrupt,
    requestInterrupt,
    devtoolUrl,
  };
  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}
