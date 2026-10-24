/**
 * Request lifecycle status and projection types shared between client and
 * server. Lives in `core` so the server's read-only status route and the
 * client's `getRequestStatus` helper agree on the wire shape without
 * crossing the server↔client package boundary.
 */

// `RequestStatus` is a pure leaf type consumed by the item/stream taxonomy, so
// its declaration lives in the zero-dependency `@flow-state-dev/contracts`
// layer. Re-exported here to preserve this path's surface; the
// `RequestStatusSnapshot` projection below still references it locally.
import type { RequestStatus } from "@flow-state-dev/contracts";
export type { RequestStatus };

/**
 * Read-only snapshot of a request's lifecycle state, returned by
 * `GET /api/flows/:flowKind/requests/:requestId/status`. Callable when no
 * SSE stream is connected — useful for the client-side dismiss path that
 * needs to confirm a request is terminal after a stuck-request banner is
 * shown.
 */
export type RequestStatusSnapshot = {
  /** The request's identifier. */
  id: string;
  /** Current lifecycle status. */
  status: RequestStatus;
  /** Wall-clock time the request started, in ms since epoch. */
  startedAtMs: number;
  /** Wall-clock time the request reached a terminal status, if any. */
  completedAtMs?: number;
  /**
   * Most recent registry heartbeat, in ms since epoch. Populated while the
   * registry holds a live run of the request: one `in_progress`, or one
   * just continued or resumed that still shows the status it was carried
   * on from until it gets its turn. Absent once the run settles and its
   * entry is removed.
   */
  lastHeartbeatAt?: number;
  /** Convenience: `Date.now() - startedAtMs` at the time of the read. */
  ageMs: number;
  /**
   * The session the request runs in. Absent for a request sent without a
   * session. Lets a caller holding only a request id continue or retry it,
   * since those routes are addressed by session.
   */
  sessionId?: string;
};
