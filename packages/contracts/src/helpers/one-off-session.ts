/**
 * The id of a one-off session: the session a request sent with no session id
 * runs in, such as one webhook delivery. The engine mints it; a reader (the
 * flow navigator) folds these sessions together. Declared once here, a
 * zero-dependency leaf, so the mint and the reader share one prefix.
 *
 * Display only. A caller can send a session id that starts with this prefix,
 * so the prefix never proves how a session was made.
 */

/** The prefix the engine puts on a one-off session's id. Stored ids carry it, so it never changes. */
export const ONE_OFF_SESSION_PREFIX = "ephemeral_";

/** Whether `sessionId` has the one-off prefix. */
export function isOneOffSessionId(sessionId: string): boolean {
  return sessionId.startsWith(ONE_OFF_SESSION_PREFIX);
}
