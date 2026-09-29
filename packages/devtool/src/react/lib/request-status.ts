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
 * Whether a request can still change on its own: running, or suspended and
 * waiting for someone to resume it. A row reads such a request as pending and
 * keeps re-reading it until it ends.
 */
export function isRequestOpen(status: string): boolean {
  return status === "in_progress" || status === "suspended";
}

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

/**
 * Should a request's polled item log replace what a live stream cached for it?
 *
 * A stream the panel has moved off (a second dispatch takes the one stream
 * slot) leaves a partial log in the live cache. Once the store has the request
 * finished, its polled log is complete, so it wins. Not while a stream is open
 * on the request, not from `suspended` or `interrupted` (a resume or Continue
 * streams from there, so the live side is the newer one), and not when the
 * poll brought no items.
 *
 * @param storeStatus The request's status in the polled list.
 * @param storeItems Its polled item log, when the list carried one.
 * @param streamOpen Whether a live stream is currently open on this request.
 */
export function snapshotSupersedesLive(
  storeStatus: string,
  storeItems: readonly unknown[] | undefined,
  streamOpen: boolean
): boolean {
  if (streamOpen) return false;
  if (storeItems === undefined || storeItems.length === 0) return false;
  return REQUEST_STATUS_RANK[storeStatus] === 2;
}

/**
 * A finished request's raw log for reading its outcome: the polled log, plus
 * any item only its stream saw.
 *
 * A transient block's traces (an action's root among them, when its block is
 * transient) stream live and are never persisted, so the polled log lacks
 * them. The polled entry wins for an item both carry; stream-only items are
 * appended in the order the stream saw them.
 *
 * @param polled The request's polled raw log.
 * @param streamed What a stream delivered for the same request, if any.
 */
export function mergeRawItems<T extends { id: string }>(polled: T[], streamed: readonly T[] | undefined): T[] {
  if (streamed === undefined || streamed.length === 0) return polled;
  const seen = new Set(polled.map((item) => item.id));
  const extra = streamed.filter((item) => !seen.has(item.id));
  return extra.length === 0 ? polled : [...polled, ...extra];
}
