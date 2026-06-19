/**
 * Reconciliation between the live SSE stream's view of a request's status and
 * the session-requests snapshot from the store (FIX-811).
 *
 * The snapshot only refetches on terminal / refresh, so a mid-flight transition
 * the watched request makes (in_progress → suspended) is visible on the stream
 * before the list row catches up. But the stream's React state persists after
 * the wire closes — a suspended-run stream freezes at `suspended` — so once the
 * stream settles it must not mask a fresher status the store already holds (e.g.
 * after a same-request resume completed server-side). The lifecycle rank below
 * lets callers pick whichever side is furthest along.
 */

/**
 * How far along the request lifecycle each status sits. In-flight states rank
 * lowest, paused/recoverable states next, terminal states highest. Unknown
 * statuses rank as in-flight (0) so they never spuriously win.
 */
export const REQUEST_STATUS_RANK: Record<string, number> = {
  created: 0,
  in_progress: 0,
  suspended: 1,
  interrupted: 1,
  completed: 2,
  incomplete: 2,
  failed: 2,
  aborted: 2,
};

/**
 * Pick whichever of the live-stream / store status is furthest along the
 * lifecycle. Ties resolve to the stream, which is the more immediate source for
 * a request currently being watched.
 */
export function pickFurthestStatus(streamStatus: string, storeStatus: string): string {
  const stream = REQUEST_STATUS_RANK[streamStatus] ?? 0;
  const store = REQUEST_STATUS_RANK[storeStatus] ?? 0;
  return stream >= store ? streamStatus : storeStatus;
}
