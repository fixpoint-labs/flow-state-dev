/**
 * A conversation's `filingSessionId`: its id plus its incarnation, from data
 * only the server writes. One function, because three things must agree on it:
 * the delegate sessions a conversation's deliveries open (FIX-1791), the
 * partition its task board keeps its rows in, and the task sessions its board
 * hands work to (FIX-1794). Any two spellings would drift.
 */

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
