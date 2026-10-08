/**
 * The names the worker model pins: where a user's workers are stored, the
 * session-state field that binds a session to its worker, the roster flow's
 * kind, and the accessors a flow declares the two worker collections under.
 *
 * A leaf module with no imports, so the browser entry, the client and the
 * server half share one spelling of each.
 */

/**
 * Where a user's own workers are stored, one row per worker, at user scope
 * (per organization). **Pinned**: persisted, and read by FIX-1791 and FIX-1795.
 */
export const WORKERS_PATTERN = "workforce/workers/*";

/** {@link WORKERS_PATTERN}'s prefix, without its wildcard. */
export const WORKERS_PREFIX = "workforce/workers/";

/**
 * The accessor a flow declares the user's worker collection under. A worker
 * flow's create check reads the creating user's row through it, and a turn
 * loads the session's worker through it.
 */
export const WORKERS_RESOURCE = "workforceWorkers";

/** Where the standard workers are projected from the installation's files. */
export const STANDARD_WORKERS_PATTERN = "workforce/standard-workers/*";

/** The accessor a flow declares the standard-worker projection under. */
export const STANDARD_WORKERS_RESOURCE = "workforceStandardWorkers";

/**
 * The session-state field that names a session's worker. A worker flow
 * declares it `.readonly()`, so it is set when the session is created, checked
 * there, and never changes. **Pinned**: persisted, and FIX-1789's
 * `writtenBy.workerId` names the same worker.
 */
export const WORKER_ID_STATE_KEY = "workerId";

/**
 * The session-state field that names the conversation a worker session was
 * opened for: a coordinator's delivery sets it on the delegate's session, from
 * the coordinator conversation's id and incarnation. Readonly, like
 * {@link WORKER_ID_STATE_KEY}, so a lookup can filter by it. **Pinned**: the
 * criteria key `findWorkerSession` and `ensureWorkerSession` take.
 */
export const FILING_SESSION_STATE_KEY = "filingSessionId";

/**
 * The roster flow's kind: a flow that runs no worker and declares the two
 * worker collections, so a client can read a user's roster through a session
 * of its own. Its own kind, so a listing of a worker flow's sessions never
 * shows a roster session.
 */
export const ROSTER_FLOW_KIND = "workforce-roster";

/** The prefix every derived worker-session id starts with. */
export const DERIVED_WORKER_SESSION_PREFIX = "wks_";
