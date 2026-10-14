/**
 * One of the user's sessions with a worker, opened by id (FIX-1989): where
 * a link from Messages lands, on either side of a message. Drawn as that
 * worker's conversation, the session pinned, so a line typed here goes into
 * this session and no other.
 *
 * The worker is the one the session names. Its door comes from the
 * inventory; a worker the inventory doesn't register (one of the user's own)
 * is drawn read-only, since Shift Manager can't name its door.
 */
import { Conversation } from "../components/Conversation";
import { EmptyState } from "../components/ui";
import type { Gaps } from "../gaps";
import { workerLabel, type LoadedSnapshot } from "../lib/derive";
import { workerOf, type Worker } from "../lib/reads";

export function SessionView({ snapshot, sessionId, gaps }: { snapshot: LoadedSnapshot; sessionId: string; gaps: Gaps }) {
  const session = snapshot.sessions.find((s) => s.id === sessionId);
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
      sessions={snapshot.sessions}
      gaps={gaps}
      name={workerLabel(workerId)}
      startAtEnd
    />
  );
}
