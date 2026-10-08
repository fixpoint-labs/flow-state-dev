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
import { DERIVED_WORKER_SESSION_PREFIX } from "./keys";

/**
 * What a worker session is looked up and created by. FIX-1788 defines
 * `worker`; later issues add their own keys (a task, a workstream, a
 * coordinator's conversation), each pinned by its issue and each a readonly
 * session-state field. FIX-1791 defines `filingSessionId`.
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
};

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
 * different criteria never share an id.
 *
 * @param input The user, organization, flow and criteria.
 * @returns An id starting with {@link DERIVED_WORKER_SESSION_PREFIX}.
 */
export async function deriveWorkerSessionId(input: DeriveWorkerSessionIdInput): Promise<string> {
  const criteria = Object.entries(input.criteria as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
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
