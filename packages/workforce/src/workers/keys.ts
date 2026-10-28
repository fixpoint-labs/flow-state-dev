/**
 * The names the worker model pins: where a user's workers are stored, the
 * session-state field that binds a session to its worker, the roster flow's
 * flow kind, and the accessors a flow declares the two worker collections under.
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
 * The session-state field that names the workstream a worker session leads:
 * the workstream's project address plus its id, as `workstreamRef` writes it
 * (`<visibility>/<projectId>/<workstreamId>`). Set when a workstream's open
 * creates its lead's session; readonly, and checked at create against the
 * creating user's own entry. **Pinned**: the criteria key `findWorkerSession`
 * and `ensureWorkerSession` take (FIX-1793).
 */
export const WORKSTREAM_STATE_KEY = "workstreamId";

/**
 * The session-state field that names the conversation whose routed task a
 * session that conversation doesn't own works (FIX-2083): a workstream's
 * session, which a project coordinator's routed task targets by id. The
 * `work` entry writes it from the claim the board's gate verified when it
 * starts such a task, so the requests that follow (a piece's ending, a
 * message) find the task on that conversation's board, as a delegate's
 * session finds its tasks by {@link FILING_SESSION_STATE_KEY}. Server-owned,
 * never a caller's to seed; absent on a session no routed task has targeted.
 */
export const ROUTED_FROM_STATE_KEY = "routedFrom";

/**
 * The session-state field that links a worker session to one project: the
 * project's address, as `projectRef` writes it (`<visibility>/<projectId>`).
 * Set when the session is created, only on a session of the standard
 * coordinator the installation names as every project's coordinator, and
 * checked at create: the creator must be able to read the project. Readonly.
 * **Pinned**: the criteria key `findWorkerSession` and `ensureWorkerSession`
 * take (FIX-1793).
 */
export const PROJECT_STATE_KEY = "projectId";

/**
 * The session-state field that names the project a user's own conversation
 * with a worker works in (FIX-2161): a new session of the worker, or the
 * worker's one default conversation. `projectRef` form,
 * `<visibility>/<projectId>`. Written only by the {@link SET_WORK_PROJECT_ACTION}
 * action, which checks the user is a member of the project, and declared
 * server-owned, so no create can seed it. Not readonly: the user can set
 * another project later, and the tasks already filed keep the one they were
 * filed in. Never on a project coordinator's, a task's, a delegate's or a
 * workstream lead's session, which take their project from where they were
 * created, filed or opened.
 */
export const WORK_PROJECT_STATE_KEY = "workProjectId";

/** The action that sets {@link WORK_PROJECT_STATE_KEY} on the session it runs in. Every worker flow declares it. */
export const SET_WORK_PROJECT_ACTION = "setWorkProject";

/**
 * The session-state field that names the workstream a task session works
 * for: the one its filer leads, or its filer's own, carried down at each
 * hand-over from the session that filed the task (`workstreamRef` form). Set
 * only by the hand-over, like {@link TASK_ID_STATE_KEY}, so a coding run in a
 * task session finds its project through the workstream it was filed from
 * (FIX-1793 S6). Readonly.
 */
export const FILING_WORKSTREAM_STATE_KEY = "filingWorkstreamId";

/**
 * The session-state field that names the project a task session was filed
 * from: its filer's {@link PROJECT_STATE_KEY} (a project conversation), or its
 * filer's own filing project, carried down at each hand-over (`projectRef`
 * form, `<visibility>/<projectId>`). Set only by the hand-over, like
 * {@link FILING_WORKSTREAM_STATE_KEY}, so a coding run in the task session
 * works in the project its conversation belongs to. Readonly.
 */
export const FILING_PROJECT_STATE_KEY = "filingProjectId";

/**
 * The session-state field that names the task a worker session was opened
 * for: set when a conversation's board hands the task over, beside the
 * worker and the filing conversation's `filingSessionId`, so the task's
 * session is found within the conversation that filed it. Readonly, and set
 * only by the hand-over: the installation's create check refuses a create on
 * any other path that names it. **Pinned**: the criteria key
 * `findWorkerSession` takes (FIX-1794).
 */
export const TASK_ID_STATE_KEY = "taskId";

/**
 * The roster flow's flow kind: a flow that runs no worker and declares the two
 * worker collections, so a client can read a user's roster through a session
 * of its own. Its own kind, so a listing of a worker flow's sessions never
 * shows a roster session.
 */
export const ROSTER_FLOW = "workforce-roster";

/**
 * The session-state field that names the flow a task session's filer runs
 * on: set when a session's board hands a task over, beside
 * {@link TASK_ID_STATE_KEY}, so the task's notice reaches the filing session
 * on its own flow, whichever flow that is (FIX-1802). Readonly, and set only
 * by the hand-over: the installation's create check refuses a create on any
 * other path that names it.
 */
export const FILING_FLOW_STATE_KEY = "filingFlow";

/**
 * Session-state field naming the worker that filed the work a task's or a
 * delegate's session runs: the filing session's worker, set by the hand-over
 * beside {@link FILING_SESSION_STATE_KEY}, so a message from here to that
 * worker lands in the session that filed it (FIX-2238). Readonly, and set
 * only by the hand-over.
 */
export const FILING_WORKER_STATE_KEY = "filingWorkerId";

/** The prefix every derived worker-session id starts with. */
export const DERIVED_WORKER_SESSION_PREFIX = "wks_";

/**
 * The session-state field that places a task session in its chain of split
 * tasks (FIX-1802 S5): the board its task is on (the top's is the first) and
 * the chain's top task, as `{ depth, top: { partition, taskId } }`. Set by
 * the hand-over at the session's birth, from the filing session's own; read
 * when the session files pieces. Readonly, and set only by the hand-over: the
 * installation's create check refuses a create on any other path that names
 * it.
 */
export const TASK_CHAIN_STATE_KEY = "taskChain";

/**
 * The session-state field that names the flow a task session runs on, as the
 * hand-over named it at the session's birth: where the session that filed
 * its task reaches it again, to settle a split or cancel its pieces
 * (FIX-1802 S4). Readonly, and set only by the hand-over.
 */
export const TASK_FLOW_STATE_KEY = "taskFlow";
