// FIX-2725.
/**
 * The client's handles on the worker sessions and session turns views: the
 * roster flow's address and each view's name, typed by the view through a
 * type import. Hold no block, so they are safe in a browser bundle.
 */
import { viewRef } from "@flow-state-dev/client";
import { ROSTER_FLOW, SESSION_TURNS_VIEW, WORKER_SESSIONS_VIEW } from "./keys";
import type { SessionTurnsView, WorkerSessionsView } from "./session-views";

/** A user's conversations with a worker: `useView(workerSessionsViewRef(), { worker })`. */
export const workerSessionsViewRef = () => viewRef<WorkerSessionsView>(ROSTER_FLOW, WORKER_SESSIONS_VIEW);

/** One session's turns, by status: `useView(sessionTurnsViewRef(), { sessionId })`. */
export const sessionTurnsViewRef = () => viewRef<SessionTurnsView>(ROSTER_FLOW, SESSION_TURNS_VIEW);
