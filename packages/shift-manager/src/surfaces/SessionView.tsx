/**
 * One session with a worker, opened by id from Messages, pinned so a line
 * typed here stays in it. A worker the inventory doesn't register is drawn
 * read-only: its door isn't known.
 * A session the snapshot doesn't list yet (one a message opened after the
 * last Lab read) is looked up in a fresh listing first.
 */
import { useEffect, useState } from "react";
import type { SessionSummary } from "@flow-state-dev/client";
import { Conversation } from "../components/Conversation";
import { EmptyState } from "../components/ui";
import type { Gaps } from "../gaps";
import { workerLabel, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { workerOf, type Worker } from "../lib/reads";

export function SessionView({ snapshot, sessionId, gaps }: { snapshot: LoadedSnapshot; sessionId: string; gaps: Gaps }) {
  const { clients } = useLab();
  const listed = snapshot.sessions.find((s) => s.id === sessionId);
  // `undefined` while the fresh listing is read; `null` when it doesn't hold the session either.
  const [fresh, setFresh] = useState<{ sessionId: string; session: SessionSummary | null } | undefined>(undefined);
  useEffect(() => {
    if (listed !== undefined) return;
    let closed = false;
    clients.sessions
      .listSessions({ userId: clients.userId, include: "dispatch-runs" })
      .then(
        (sessions) => !closed && setFresh({ sessionId, session: sessions.find((s) => s.id === sessionId) ?? null }),
        () => !closed && setFresh({ sessionId, session: null })
      );
    return () => {
      closed = true;
    };
  }, [clients, sessionId, listed]);
  const looked = fresh?.sessionId === sessionId ? fresh.session : undefined;
  const session = listed ?? looked ?? undefined;
  if (session === undefined && looked === undefined) {
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
  const registered = snapshot.inventory.ok ? snapshot.inventory.value.workers.find((w) => w.id === workerId) : undefined;
  const worker: Worker =
    registered !== undefined && registered.kind === session.flowKind
      ? registered
      : { id: workerId, kind: session.flowKind, door: null, rules: false, team: "", name: workerId };
  return (
    <Conversation
      key={sessionId}
      testId="session"
      worker={worker}
      session={sessionId}
      sessions={listed === undefined ? [...snapshot.sessions, session] : snapshot.sessions}
      gaps={gaps}
      name={workerLabel(workerId)}
      startAtEnd
    />
  );
}
