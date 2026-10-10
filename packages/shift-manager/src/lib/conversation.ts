/**
 * One person's conversation with one seat, read from the seat's session.
 *
 * The session is the newest direct one the snapshot lists on the seat's flow
 * naming the seat's worker, or the one a first line just opened, until the
 * snapshot lists it (BR-14). Its items are read when the view opens and after
 * each line, never on the snapshot's refresh. Nothing is sent into a
 * conversation the screen hasn't read; one a line opened here holds nothing
 * the person hasn't seen.
 *
 * Used by `<Conversation>`; a view that wants a conversation with a seat draws
 * that component, and calls this only to build its own.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ClientHttpError, type SessionSummary } from "@flow-state-dev/client";
import { COORDINATOR_JUDGMENT, COORDINATOR_KIND, WORKER_ID_STATE_KEY } from "@flow-state-dev/workforce/browser";
import type { LabClients } from "./connection";
import { newSessionId } from "./ids";
import { useLab } from "./lab-data";
import { describeFailure, workerOf, type Failure, type Seat } from "./reads";
import { readSessionItems, RunReadError, type SessionItems } from "./run";

/** The flow a coordinator seat runs on, whose conversations carry its delegates' answers. */
export const COORDINATOR_FLOW = COORDINATOR_KIND;

/**
 * The delegate a message in a coordinator's conversation came from, by its
 * worker id, or `undefined` when the coordinator wrote it. A delegate's answer
 * lands in the coordinator's conversation under the delegate's name; the
 * coordinator's own turn stamps its messages with its answer generator's
 * name.
 */
export function delegateOf(seat: Pick<Seat, "kind">, item: { readonly agentName?: string }): string | undefined {
  if (seat.kind !== COORDINATOR_FLOW) return undefined;
  const author = item.agentName;
  return author === undefined || author.startsWith(COORDINATOR_JUDGMENT) ? undefined : author;
}

/**
 * The id of the person's conversation with `seat`: their newest session on
 * the seat's flow that names the seat's worker and has no parent session, or
 * `null` when they have none. A store that nulls absent keys hands back
 * `null` for a parent, so the guard is `== null`.
 */
export function conversationSession(sessions: readonly SessionSummary[], seat: Pick<Seat, "id" | "kind">): string | null {
  let newest: SessionSummary | undefined;
  for (const session of sessions) {
    if (session.flowKind !== seat.kind || workerOf(session) !== seat.id || session.parentSessionId != null) continue;
    if (newest === undefined || session.createdAt > newest.createdAt) newest = session;
  }
  return newest?.id ?? null;
}

/**
 * The conversation the view is on: `opened`, the session a first line opened
 * here, until the listing holds it; from then on the newest direct session
 * the listing names, which may be one started elsewhere.
 */
export function currentConversation(
  sessions: readonly SessionSummary[],
  seat: Pick<Seat, "id" | "kind">,
  opened: string | null,
): string | null {
  if (opened !== null && !sessions.some((session) => session.id === opened)) return opened;
  return conversationSession(sessions, seat);
}

/**
 * A fresh session id for a new conversation ({@link newSessionId}). A worker's
 * session names its worker from the moment it is created, so a first line goes
 * to an id minted here, opened by {@link openConversation} before the door's
 * request runs in it.
 */
export function newConversationId(): string {
  return newSessionId("conv", "_");
}

/**
 * Open `sessionId` on the seat's flow, naming the seat's worker in its
 * starting state. A session a failed earlier attempt already opened under that
 * id is the one the line goes to, so a conflict is not an error.
 */
export async function openConversation(clients: LabClients, seat: { id: string; kind: string }, sessionId: string): Promise<void> {
  try {
    await clients.sessions.createSession({
      flowKind: seat.kind,
      userId: clients.userId,
      sessionId,
      state: { [WORKER_ID_STATE_KEY]: seat.id },
    });
  } catch (error) {
    if (!(error instanceof ClientHttpError && error.status === 409)) throw error;
  }
}

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
  /** Make `sessionId` the conversation shown: the session a line was sent into, until the snapshot lists it. */
  open(sessionId: string): void;
}

/**
 * @param seat The seat the conversation is with.
 * @param sessions The snapshot's sessions.
 * @param pinned The session the conversation is, when the view found it: that one, whatever the snapshot lists.
 */
export function useSeatConversation(seat: Seat, sessions: readonly SessionSummary[], pinned?: string): SeatConversation {
  const { clients } = useLab();
  const [opened, setOpened] = useState<string | null>(null);
  const sessionId = pinned ?? currentConversation(sessions, seat, opened);
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
    readSessionItems(clients, sessionId)
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
  const open = useCallback((id: string) => setOpened(id), []);
  const target = useCallback(() => sessionId ?? (fresh.current ??= newConversationId()), [sessionId]);

  return { sessionId, opened, read: sessionId !== null && stored?.sessionId === sessionId ? stored.read : undefined, failure, reread, target, open };
}
