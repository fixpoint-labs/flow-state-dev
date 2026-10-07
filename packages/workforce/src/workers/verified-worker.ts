/**
 * The worker each running request's turn was verified to run as, by the
 * session handle its blocks share. A leaf module, so attribution
 * (`writeShared`) reads it without importing the worker model.
 */

const verified = new WeakMap<object, string>();

/**
 * Record that this request's turn runs as `workerId`: the session's worker,
 * as `resolveWorker` loaded and checked it.
 *
 * @param session The block context's `session` handle, the same object for
 *   every block of one request.
 */
export function markVerifiedWorker(session: object, workerId: string): void {
  verified.set(session, workerId);
}

/**
 * The worker this request's turn was verified to run as, or `undefined` when
 * no worker was resolved, which is the case on every flow that isn't a worker
 * flow. Attribution reads this, never the session's state directly: a flow
 * that isn't a worker flow can hold a `workerId` a caller wrote.
 *
 * @param session The block context's `session` handle.
 */
export function verifiedWorkerOf(session: object): string | undefined {
  return verified.get(session);
}
