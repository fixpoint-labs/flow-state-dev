/**
 * One session with a worker, opened by id from Messages, pinned so a line
 * typed here stays in it. A worker the inventory doesn't register is drawn
 * read-only: its door isn't known. So is a task's session or a delegate's session for another conversation,
 * whatever the worker: a line typed there would be task input.
 * A session the page's session list doesn't hold yet (one a message opened
 * a moment ago) is looked up in a fresh listing first.
 */
import { useEffect, useState } from "react";
import type { SessionSummary } from "@flow-state-dev/client";
import { FILING_SESSION_STATE_KEY, TASK_ID_STATE_KEY } from "@flow-state-dev/workforce/browser";
import { Conversation } from "../components/Conversation";
import { EmptyState } from "../components/ui";
import type { Gaps } from "../gaps";
import { workerLabel } from "../lib/shift";
import { useLab } from "../lib/lab-data";
import { useSessions, useWorkers } from "../lib/directory";
import { workerOf, type Worker } from "../lib/workers";

/** Why a line can't go to `session`, or `undefined` when it can: a task's session and a delegate's session for another conversation take task input only. */
function readOnlyReason(session: SessionSummary): string | undefined {
  const state = ((session as { state?: unknown }).state ?? {}) as Record<string, unknown>;
  if (typeof state[TASK_ID_STATE_KEY] === "string") return "This is a task's session. It is read here, not written to.";
  if (typeof state[FILING_SESSION_STATE_KEY] === "string") return "This session answers messages routed from another conversation. It is read here, not written to.";
  return undefined;
}

export function SessionView({ sessionId, gaps }: { sessionId: string; gaps: Gaps }) {
  const { client } = useLab();
  const { workers } = useWorkers();
  const sessions = useSessions().list;
  const listed = sessions?.find((s) => s.id === sessionId);
  // `undefined` while the fresh listing is read; `null` when it doesn't hold the session either.
  const [fresh, setFresh] = useState<{ sessionId: string; session: SessionSummary | null } | undefined>(undefined);
  useEffect(() => {
    if (sessions === undefined || listed !== undefined) return;
    let closed = false;
    client.sessions
      .list({ userId: client.userId, include: "dispatch-runs" })
      .then(
        (sessions) => !closed && setFresh({ sessionId, session: sessions.find((s) => s.id === sessionId) ?? null }),
        () => !closed && setFresh({ sessionId, session: null })
      );
    return () => {
      closed = true;
    };
  }, [client, sessionId, sessions, listed]);
  const looked = fresh?.sessionId === sessionId ? fresh.session : undefined;
  const session = listed ?? looked ?? undefined;
  if (sessions === undefined || (session === undefined && looked === undefined)) {
    return (
      <EmptyState title="Reading the session" testId="session-reading">
        Looking for this session…
      </EmptyState>
    );
  }
  const workerId = session === undefined ? null : workerOf(session);
  if (session === undefined || workerId === null) {
    return (
      <EmptyState title="Session not found" testId="session-missing">
        None of your sessions with a worker has this id.
      </EmptyState>
    );
  }
  const registered = workers.find((w) => w.id === workerId);
  const worker: Worker =
    registered !== undefined && registered.kind === session.flowKind
      ? registered
      : { id: workerId, kind: session.flowKind, door: null, rules: false, doorTakesTask: false, team: "", teamName: "", name: workerId, displayName: workerId };
  return (
    <Conversation
      key={sessionId}
      testId="session"
      worker={worker}
      session={sessionId}
      sessions={listed === undefined ? [...sessions, session] : sessions}
      gaps={gaps}
      name={workerLabel(workerId)}
      readOnly={readOnlyReason(session)}
      startAtEnd
    />
  );
}
