/**
 * One person's conversation with one seat, read from the seat's session.
 *
 * The session is the newest direct one the snapshot lists for the seat, or the
 * one a first line just opened, until the snapshot lists it (BR-14). Its items
 * are read when the view opens and after each line, never on the snapshot's
 * refresh. Nothing is sent into a conversation the screen hasn't read; one a
 * line opened here holds nothing the person hasn't seen.
 *
 * Used by {@link Conversation} (and its feed and composer); a view that wants a
 * conversation with a seat calls this, or just draws that component.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionSummary } from "@flow-state-dev/client";
import { currentConversation, newConversationId, readConversation } from "./cos";
import { useLab } from "./lab-data";
import { describeFailure, type Failure, type Seat } from "./reads";
import { RunReadError, type SessionItems } from "./run";

export interface SeatConversation {
  /** The conversation's session, or `null` before a first line. */
  sessionId: string | null;
  /** The session a first line opened here, until the snapshot lists it. */
  opened: string | null;
  /** What the session stores, once read, for the session shown. */
  read: SessionItems | undefined;
  /** Why the last read failed; cleared by the next that succeeds. */
  failure: Failure | undefined;
  /** Read the session again. */
  reread(): void;
  /** The session a line goes to: the conversation's, or a fresh id kept until a send opens it. */
  target(): string;
  /** A line is held by `sessionId`: show it as the conversation, and by default read it back. */
  hold(sessionId: string, read?: boolean): void;
}

/** @param seat The seat the conversation is with. @param sessions The snapshot's sessions. */
export function useSeatConversation(seat: Seat, sessions: readonly SessionSummary[]): SeatConversation {
  const { clients } = useLab();
  const [opened, setOpened] = useState<string | null>(null);
  const sessionId = currentConversation(sessions, seat.id, opened);
  // The id a first line goes to, kept across a failed send so a retry lands in
  // the same session if the Lab already opened it.
  const fresh = useRef<string | null>(null);
  // The last read that succeeded, and whose session it read. A re-read keeps it
  // on screen until the new one lands.
  const [stored, setStored] = useState<{ sessionId: string; read: SessionItems } | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (sessionId === null) return;
    let closed = false;
    readConversation(clients, sessionId)
      .then((read) => {
        if (closed) return;
        setStored({ sessionId, read });
        setFailure(undefined);
      })
      .catch((error: unknown) => {
        if (!closed) setFailure(error instanceof RunReadError ? error.failure : describeFailure(error));
      });
    return () => {
      closed = true;
    };
  }, [clients, sessionId, reads]);

  const reread = useCallback(() => setReads((n) => n + 1), []);
  const hold = useCallback((id: string, read = true) => {
    setOpened(id);
    if (read) setReads((n) => n + 1);
  }, []);
  const target = useCallback(() => sessionId ?? (fresh.current ??= newConversationId()), [sessionId]);

  return { sessionId, opened, read: sessionId !== null && stored?.sessionId === sessionId ? stored.read : undefined, failure, reread, target, hold };
}
