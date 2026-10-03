/**
 * The person's conversation with the chief of staff (S6, BR-14 to BR-17).
 *
 * The conversation is an ordinary session of the chief of staff's seat: the
 * person's newest one on that seat's flow that nothing else started. A session
 * a channel post or another run opened has a parent and is never it. With
 * none, the first line opens one through the seat's door.
 *
 * Lines go in through {@link sendTurn}, the one send path, so *delivered*
 * means what it means everywhere else. The Lab's answer to an action sent with
 * no session doesn't name the session it opened, so a first line goes to a
 * fresh session id minted here ({@link newConversationId}), and the door's
 * request opens that session. What the screen draws is what the
 * session stores, read back after each line; nothing is drawn in the seat's
 * voice that its session doesn't hold.
 */
import type { SessionSummary } from "@flow-state-dev/client";
import type { LabClients } from "./connection";
import { newSessionId } from "./ids";
import { readSessionItems, type SessionItems } from "./run";
import { sendTurn } from "./send";

/**
 * The id of the person's conversation with the seat `seatId`: their newest
 * session on that seat's flow with no parent session, or `null` when they have
 * none. A store that nulls absent keys hands back `null` for a parent, so the
 * guard is `== null`.
 */
export function conversationSession(sessions: readonly SessionSummary[], seatId: string): string | null {
  let newest: SessionSummary | undefined;
  for (const session of sessions) {
    if (session.flowId !== seatId || session.parentSessionId != null) continue;
    if (newest === undefined || session.createdAt > newest.createdAt) newest = session;
  }
  return newest?.id ?? null;
}

/**
 * The conversation the view is on: `opened`, the session a first line opened
 * here, until the listing holds it; from then on the newest direct session
 * the listing names, which may be one started elsewhere.
 */
export function currentConversation(sessions: readonly SessionSummary[], seatId: string, opened: string | null): string | null {
  if (opened !== null && !sessions.some((session) => session.id === opened)) return opened;
  return conversationSession(sessions, seatId);
}

/** A fresh session id for a new conversation ({@link newSessionId}). */
export function newConversationId(): string {
  return newSessionId("cos", "_");
}

/** Every item the conversation's session holds, in stored order. */
export function readConversation(clients: LabClients, sessionId: string): Promise<SessionItems> {
  return readSessionItems(clients, sessionId);
}

/**
 * Send a line to the chief of staff through its door, into `sessionId`: the
 * conversation's, or a {@link newConversationId} the door's request opens.
 * Resolves once the line is delivered; rejects as {@link sendTurn} does.
 */
export async function sendToChiefOfStaff(
  clients: LabClients,
  target: { seatId: string; door: string; sessionId: string },
  message: string,
): Promise<void> {
  await sendTurn(clients, { sessionId: target.sessionId, flowId: target.seatId, door: target.door }, message);
}
