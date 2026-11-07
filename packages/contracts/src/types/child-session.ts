/**
 * The wire contract of `GET /sessions/:sessionId/children`: one ChildSession per
 * entry. Declared once here, a zero-dependency leaf, so the client and anything
 * else reading the listing share one meaning; `@flow-state-dev/client` re-exports it.
 */

/**
 * How a ChildSession's runs ended, or that they have not ended. `"active"`
 * asserts only *not finished*. In a list read once, never gloss it as
 * "running" or "live": the read may be stale. A view that follows its session
 * (`useSession(id, { live: true })`) re-reads the list as runs start and
 * finish, so there `"active"` may read as "working", which clears when the run
 * ends. A paused or stopped run reads the same.
 *
 * See `docs/architecture/server-and-client.md` § Background work (ChildSessions)
 * for the full semantics, including why this is not `RequestStatus`.
 */
export type ChildSessionStatus =
  | "active"
  | "completed"
  | "failed"
  | "incomplete"
  | "aborted";

/**
 * One body of background work running under a conversation.
 *
 * A ChildSession is a child session that outlives the turn that started it, so
 * its history is read with `sessions.requests` — the
 * same call a conversation's own turns are read with.
 *
 * The wire sends a named field set rather than a whole session record, so this
 * stands on its own instead of extending the client's `SessionSummary`: the listing
 * carries no `flowKind`, `userId`, `title` or `metadata`, and declaring them
 * here would type fields the server never sends.
 */
export type ChildSessionSummary = {
  /** Bare child session id — the address for reading this ChildSession's requests. */
  id: string;
  /** Bare id of the conversation this work hangs off. */
  parentSessionId: string;
  createdAt: number;
  updatedAt: number;
  /**
   * The flow instance that owns the child — the address to read it through
   * when it was dispatched into another instance. Absent on a child written
   * before owners were recorded; guard with `== null` (BP-030).
   */
  flowId?: string;
  /** Display-only label for what body of work this is; guard with `== null` (BP-030). */
  topic?: string;
  /** Display-only label for which worker within the work; same absence rule as `topic`. */
  coordinate?: string;
  /** Absent when nothing has run yet — not a status to render a placeholder for. */
  status?: ChildSessionStatus;
};
