/**
 * A conversation's `filingSessionId`: its id plus its incarnation, from data
 * only the server writes. One function, because three things must agree on it:
 * the delegate sessions a conversation's deliveries open (FIX-1791), the
 * partition its task board keeps its rows in, and the task sessions its board
 * hands work to (FIX-1794). Any two spellings would drift.
 *
 * And the workstream a session works for, and the project, which a task
 * session's hand-over carries down from the session that filed it (FIX-1793
 * S6, FIX-1866 S5).
 */
import {
  FILING_PROJECT_STATE_KEY,
  FILING_WORKSTREAM_STATE_KEY,
  PROJECT_STATE_KEY,
  WORK_PROJECT_STATE_KEY,
  WORKSTREAM_STATE_KEY
} from "../workers/keys";
import { parseProjectRef, parseWorkstreamRef, type ProjectAddressRef } from "../projects/workstream-ref";

/**
 * The workstream a session works for, from its server-written fields: the one
 * it leads (`workstreamId`), else the one it was filed from
 * (`filingWorkstreamId`), in `workstreamRef` form. `undefined` for neither.
 */
export function filingWorkstreamOf(state: unknown): string | undefined {
  const fields = state as Record<string, unknown> | undefined;
  const led = fields?.[WORKSTREAM_STATE_KEY];
  if (typeof led === "string") return led;
  const filed = fields?.[FILING_WORKSTREAM_STATE_KEY];
  return typeof filed === "string" ? filed : undefined;
}

/**
 * The project a session works in, from its server-written fields: the one it
 * is the coordinator conversation of (`projectId`), else the one its user
 * set it to work in (`workProjectId`, FIX-2161), else the one it was filed
 * from (`filingProjectId`), in `projectRef` form. `undefined` for none. The
 * work-project action refuses a session carrying either of the others, so no
 * two meet on one session.
 */
export function filingProjectOf(state: unknown): string | undefined {
  const fields = state as Record<string, unknown> | undefined;
  const own = fields?.[PROJECT_STATE_KEY];
  if (typeof own === "string") return own;
  const set = fields?.[WORK_PROJECT_STATE_KEY];
  if (typeof set === "string") return set;
  const filed = fields?.[FILING_PROJECT_STATE_KEY];
  return typeof filed === "string" ? filed : undefined;
}

/**
 * A session's state as it stood before a user could set the project it works
 * in (`workProjectId`, FIX-2161): the state a row filed before rows carried
 * the project stamp was filed from.
 */
export function stateBeforeWorkProject(state: unknown): Record<string, unknown> {
  const { [WORK_PROJECT_STATE_KEY]: _set, ...before } = (state ?? {}) as Record<string, unknown>;
  return before;
}

/**
 * The session's project, in the run's order: its workstream's, else its own.
 * The board writes it on the tasks the session files; the run source checks
 * them against it.
 */
export function filingProjectAddressOf(state: unknown): ProjectAddressRef | undefined {
  const workstream = filingWorkstreamOf(state);
  if (workstream !== undefined) return parseWorkstreamRef(workstream)?.project;
  const project = filingProjectOf(state);
  return project === undefined ? undefined : parseProjectRef(project);
}

/** Hex of the first 8 bytes of the SHA-256 of `text`. */
async function shortDigest(text: string): Promise<string> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let hex = "";
  for (const byte of bytes.subarray(0, 8)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * A conversation's `filingSessionId`: its id plus its incarnation, read from
 * the server-written session record, never from a caller. A conversation
 * deleted and created again under the same id gets a new lineage, so a new
 * value. The lineage id itself stays server-side; the value carries a digest
 * of it.
 *
 * @param session The session's id and the lineage id its record was born with.
 * @throws When the session has no lineage id: without it a recreated
 *   conversation would inherit its predecessor's delegates and tasks.
 */
export async function filingSessionIdOf(session: { identity: { id: string }; lineageId?: string }): Promise<string> {
  if (session.lineageId === undefined) {
    throw new Error(
      `Session "${session.identity.id}" has no lineageId, so the coordinator refuses it. ` +
        "Each delegate's session is filed under its conversation's id and lineageId; without the lineageId, " +
        "a conversation deleted and created again under this id would pick up its predecessor's delegates. " +
        "Sessions without one aren't supported: run the conversation on a host that sets ctx.session.lineageId."
    );
  }
  return `${session.identity.id}~${await shortDigest(session.lineageId)}`;
}

/**
 * The session id a `filingSessionId` was made from: everything before its
 * last `~`. The value is server-written ({@link filingSessionIdOf}), so this
 * reads no caller's input.
 */
export function sessionIdOfFiling(filingSessionId: string): string {
  const at = filingSessionId.lastIndexOf("~");
  return at < 0 ? filingSessionId : filingSessionId.slice(0, at);
}
