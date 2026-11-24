/**
 * The id of a one-off session: the session a run that belongs to no
 * conversation lands in, such as one webhook delivery or one scheduled fire.
 * The entry point that starts such a run makes the id with
 * {@link oneOffSessionId} before it writes anything; a reader (the flow
 * navigator) folds these sessions together. Declared once here, a
 * zero-dependency leaf, so the maker and the reader share one prefix.
 *
 * Display only. A caller can send a session id that starts with this prefix,
 * so the prefix never proves how a session was made.
 */

/** The prefix put on a one-off session's id. Stored ids carry it, so it never changes. */
export const ONE_OFF_SESSION_PREFIX = "ephemeral_";

/** Whether `sessionId` has the one-off prefix. */
export function isOneOffSessionId(sessionId: string): boolean {
  return sessionId.startsWith(ONE_OFF_SESSION_PREFIX);
}

/**
 * A fresh one-off session id: the only place such an id is made. Browser-safe.
 * A caller sending a one-shot action passes it as the run's session id; the
 * session is born on the run's first write, and the navigator folds it as a
 * one-off.
 */
export function oneOffSessionId(): string {
  return `${ONE_OFF_SESSION_PREFIX}${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
