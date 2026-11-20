/**
 * Your sessions and what each one's main thread shows: the worker sessions
 * view per mode's worker, less your dismissals, and a session's items on its
 * feed with its turns from workforce's session turns view.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { useView, type LineTurn } from "@flow-state-dev/react";
import { sessionTurnsViewRef, WORK_PROJECT_STATE_KEY, workerSessionsViewRef } from "@flow-state-dev/workforce/browser";
import { MODES } from "../modes";
import { dismissalKey } from "../lib/columns";
import { useAppContext } from "./provider";
import { THREAD_ITEMS, useFeed, type ConnectionState } from "./feed";
import { useDismissed } from "./marks";

/** One row of the sessions list: the worker sessions view's row, with what waits on you less your dismissals. */
export interface AppSession {
  id: string;
  title: string;
  /** The session's main worker; its mode is read from it (`modeOfWorker`). */
  worker: string;
  /** When the session last changed, in ms. */
  updatedAt: number;
  running: boolean;
  /** How many of its tasks wait on you: the view's waiting tasks, less the failures you dismissed. */
  waiting: number;
  /** The project the session was opened from, or null when it has none and must ask. */
  projectId: string | null;
}

/** What a thread shows now. */
export interface ThreadView {
  /** The session's items its lines are drawn from, in order. */
  items: OutputItem[];
  /** The session's turns as the lines read them: how each ended and whether the engine retries it. A turn you stopped stays stopped once it leaves the turns read. */
  turns: LineTurn[];
  running: boolean;
  connection?: ConnectionState;
  /** When the running turn started, in ms. */
  turnStartedAt?: number;
  /** The running turn's request. */
  requestId?: string;
  /** From a Stop until every turn it aborted has ended. */
  stopping: boolean;
  /** The session's unfinished runs as the session stream names them; `null` until it has. */
  backgroundRunning: number | null;
  /** Present while the thread holds items older than its first entry. */
  loadEarlier?: () => Promise<void>;
}

/** Your sessions with each mode's worker, newest first, from the worker sessions view. */
export function useSessions(): AppSession[] | undefined {
  const { client, pollIntervalMs } = useAppContext();
  const dismissed = useDismissed();
  // One watch per mode: the modes are the app's fixed config.
  const reads = MODES.map((mode) => useView(workerSessionsViewRef(), { worker: mode.worker }, { client, pollIntervalMs }));
  const values = reads.map((read) => read.value);
  return useMemo(() => {
    if (values.some((value) => value === undefined)) return undefined;
    const gone = new Set(dismissed ?? []);
    return values
      .flatMap((listed) => listed!)
      .map((session): AppSession => {
        const project = session.state[WORK_PROJECT_STATE_KEY];
        return {
          id: session.id,
          title: session.title,
          worker: session.worker,
          updatedAt: session.updatedAt,
          running: session.running,
          waiting: session.waiting.filter((task) => !gone.has(dismissalKey({ id: task.taskId, attempts: task.attempt }))).length,
          projectId: typeof project === "string" ? project : null,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...values, dismissed]);
}

/** What a session's main thread shows: its items on the session feed, its turns from the session turns view. */
export function useThread(sessionId: string): ThreadView | undefined {
  const { client, pollIntervalMs, stops, threadFeeds } = useAppContext();
  const feed = useFeed(client, sessionId, THREAD_ITEMS);
  const follow = feed?.followResponse;
  useEffect(() => {
    if (follow === undefined) return;
    threadFeeds.set(sessionId, follow);
    return () => {
      if (threadFeeds.get(sessionId) === follow) threadFeeds.delete(sessionId);
    };
  }, [threadFeeds, sessionId, follow]);
  const turns = useView(sessionTurnsViewRef(), { sessionId }, { client, pollIntervalMs }).value;
  useSyncExternalStore(stops.subscribe, stops.snapshot);
  // A stopped line stays once its turn leaves the turns read.
  const [stoppedSeen] = useState(() => new Set<string>());
  const lineTurns = useMemo(() => {
    if (turns === undefined) return undefined;
    for (const turn of turns) if (turn.status === "aborted") stoppedSeen.add(turn.id);
    const read = new Set(turns.map((turn) => turn.id));
    return [...turns, ...[...stoppedSeen].filter((id) => !read.has(id)).map((id) => ({ id, status: "aborted" }))];
  }, [turns, stoppedSeen]);
  const stop = stops.get(sessionId);
  const ended = stop?.ids != null && turns !== undefined && [...stop.ids].every((id) => turns.some((turn) => turn.id === id && turn.status !== "in_progress"));
  useEffect(() => {
    if (ended && stops.get(sessionId) === stop) stops.set(sessionId, undefined);
  }, [ended, stop, stops, sessionId]);
  if (feed?.items === undefined || turns === undefined || lineTurns === undefined) return undefined;
  const turn = turns.find((t) => t.status === "in_progress");
  return {
    items: feed.items,
    turns: lineTurns,
    running: turn !== undefined,
    stopping: stop !== undefined && !ended,
    backgroundRunning: feed.runs,
    ...(feed.connection === undefined ? {} : { connection: feed.connection }),
    ...(turn === undefined ? {} : { turnStartedAt: turn.startedAt, requestId: turn.id }),
    ...(feed.loadEarlier === undefined ? {} : { loadEarlier: feed.loadEarlier }),
  };
}
