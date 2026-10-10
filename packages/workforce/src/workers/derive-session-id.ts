/**
 * The derived worker-session id: one id per (user, organization, flow,
 * criteria), computed the same way by the client that creates the session
 * and by the create check that guards it.
 *
 * Why an id is derived at all: two `ensureWorkerSession` calls racing for the
 * same worker must end on one session. Both compute the same id, the store's
 * create-if-absent lets one of them write it, and the other reads the winner
 * back from its 409.
 *
 * Why the check recomputes it: a derived id names its owner. Bob creating a
 * session at the id Alice's first `ensureWorkerSession` will use would hold
 * her session before she does, so a create at an id carrying the derived
 * prefix is refused unless it is the creating user's own derivation.
 *
 * Isomorphic: Web Crypto's SHA-256, which browsers and Node 22 both carry.
 */
import {
  parseProjectRef,
  parseWorkstreamRef,
  projectRef,
  workstreamRef,
  type ProjectAddressRef,
  type WorkstreamAddress
} from "../projects/workstream-ref";
import {
  DERIVED_WORKER_SESSION_PREFIX,
  FILING_SESSION_STATE_KEY,
  PROJECT_STATE_KEY,
  TASK_ID_STATE_KEY,
  WORKER_ID_STATE_KEY,
  WORKSTREAM_STATE_KEY
} from "./keys";

/**
 * What a worker session is looked up and created by. FIX-1788 defines
 * `worker`; later issues add their own keys (a task, a workstream, a
 * coordinator's conversation), each pinned by its issue and each a readonly
 * session-state field. FIX-1791 defines `filingSessionId`; FIX-1793
 * `workstreamId` and `projectId`; FIX-1794 `taskId`.
 */
export type WorkerSessionCriteria = {
  /** The worker the session runs: a worker id on the user's roster, or a standard one. */
  worker: string;
  /**
   * The conversation the session was opened for: a coordinator conversation's
   * `filingSessionId`, as its `listDelegates` returns it. Named, the lookup
   * returns that conversation's delegate session; omitted, it never returns a
   * session that carries one.
   */
  filingSessionId?: string;
  /**
   * The workstream the session leads: its project's address and its id, the
   * owner being the user asking. Named, the lookup returns the lead's
   * workstream session; omitted, it never returns one. A workstream's open
   * creates that session; a create naming a workstream the user has no entry
   * for, or one its entry doesn't name this worker to lead, is refused.
   */
  workstreamId?: WorkstreamAddress;
  /**
   * The project the session is linked to: its address. Named, the lookup
   * returns the user's coordinator for that project; omitted, it never
   * returns one. Only a session of the coordinator the installation names
   * as every project's coordinator carries it, one per user per project, and
   * a create naming a project its user can't read is refused.
   */
  projectId?: ProjectAddressRef;
  /**
   * The task the session was opened for, on the board of the conversation
   * `filingSessionId` names: a task session, which a conversation's board
   * opens when it hands the task over. Named, the lookup returns that task's
   * session within that conversation; omitted, it never returns a task
   * session. `ensureWorkerSession` never creates one.
   */
  taskId?: string;
};

/**
 * The criteria as the readonly session-state fields they name, each a string:
 * what a lookup filters on, what a create starts the session with, and what a
 * derived id is computed from.
 */
export function criteriaState(criteria: WorkerSessionCriteria): Record<string, string> {
  const state: Record<string, string> = { [WORKER_ID_STATE_KEY]: criteria.worker };
  if (criteria.filingSessionId !== undefined) state[FILING_SESSION_STATE_KEY] = criteria.filingSessionId;
  if (criteria.workstreamId !== undefined) state[WORKSTREAM_STATE_KEY] = workstreamRef(criteria.workstreamId);
  if (criteria.projectId !== undefined) state[PROJECT_STATE_KEY] = projectRef(criteria.projectId);
  if (criteria.taskId !== undefined) state[TASK_ID_STATE_KEY] = criteria.taskId;
  return state;
}

/**
 * The criteria a session's starting state names, read back from its readonly
 * fields: what the create check recomputes a derived id from. A field that is
 * missing, not a string or not readable is left out.
 */
export function criteriaOfState(workerId: string, state: Readonly<Record<string, unknown>>): WorkerSessionCriteria {
  const filing = state[FILING_SESSION_STATE_KEY];
  const workstream = state[WORKSTREAM_STATE_KEY];
  const address = typeof workstream === "string" ? parseWorkstreamRef(workstream) : undefined;
  const linked = state[PROJECT_STATE_KEY];
  const project = typeof linked === "string" ? parseProjectRef(linked) : undefined;
  const task = state[TASK_ID_STATE_KEY];
  return {
    worker: workerId,
    ...(typeof filing === "string" ? { filingSessionId: filing } : {}),
    ...(address !== undefined ? { workstreamId: address } : {}),
    ...(project !== undefined ? { projectId: project } : {}),
    ...(typeof task === "string" ? { taskId: task } : {})
  };
}

/** The session-state fields a criteria key can name, by key. A lookup returns only sessions carrying none it didn't name. */
export const CRITERIA_STATE_KEYS: readonly string[] = [
  WORKER_ID_STATE_KEY,
  FILING_SESSION_STATE_KEY,
  WORKSTREAM_STATE_KEY,
  PROJECT_STATE_KEY,
  TASK_ID_STATE_KEY
];

/** The inputs a derived id is computed from. */
export type DeriveWorkerSessionIdInput = {
  /** The user the session belongs to. */
  userId: string;
  /** The organization it is created in. */
  orgId: string;
  /** The flow the session runs on: the worker's flow. */
  flow: string;
  /** What the session is for. */
  criteria: WorkerSessionCriteria;
};

/** Hex of the first 20 bytes of the SHA-256 of `text`. */
async function digest(text: string): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle === undefined) {
    throw new Error(
      "A derived worker-session id needs Web Crypto (globalThis.crypto.subtle), which this runtime " +
        "doesn't provide."
    );
  }
  const bytes = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let hex = "";
  for (const byte of bytes.subarray(0, 20)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * The derived id for one worker session.
 *
 * Every criteria key is part of it, sorted by name, so two lookups that name
 * different criteria never share an id. A workstream and a project are taken
 * in their one-string forms, so an object's key order can't change the id.
 *
 * @param input The user, organization, flow and criteria.
 * @returns An id starting with {@link DERIVED_WORKER_SESSION_PREFIX}.
 */
export async function deriveWorkerSessionId(input: DeriveWorkerSessionIdInput): Promise<string> {
  const criteria = Object.entries(input.criteria as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) =>
      key === "workstreamId"
        ? ([key, workstreamRef(value as WorkstreamAddress)] as const)
        : key === "projectId"
          ? ([key, projectRef(value as ProjectAddressRef)] as const)
          : ([key, value] as const)
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonical = JSON.stringify(["worker-session/1", input.userId, input.orgId, input.flow, criteria]);
  return `${DERIVED_WORKER_SESSION_PREFIX}${await digest(canonical)}`;
}

/**
 * Whether `sessionId` has the shape of a derived worker-session id. A create
 * at such an id must be the creating user's own derivation.
 */
export function isDerivedWorkerSessionId(sessionId: string): boolean {
  return sessionId.startsWith(DERIVED_WORKER_SESSION_PREFIX);
}
