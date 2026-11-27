/**
 * The one interpretation of a stored request record with no session.
 *
 * Every run names its session from its first write, but a store written
 * before that was required holds request records (and their suspensions)
 * with no session: a one-off run whose session the engine made up after the
 * record existed. Those rows are history. They still load, list and stop
 * (`pendingGatesOf` skips its session filter for them), and they are never
 * rewritten or given a session: their gates and park keys were written with
 * none, so a new id would hide them.
 *
 * So, as for an unattributed organization (`org-attribution.ts`): **decode is
 * permissive, re-entry is strict.** Every path that would run such a record
 * again — a resume, a continuation, a crash-recovery retry, a queued job that
 * never started — refuses or settles it with the reason
 * `legacy-sessionless-request`, and never runs it in a new session.
 */

/** The session fact a re-entered record carries. */
export type SessionNamedRecord = {
  // BP-030.
  /** `null` and `undefined` both mean "recorded before every request named its session". */
  readonly sessionId?: string | null;
};

/** The reason a legacy session-less record is refused, shared with the route layer's 409 body. */
export const LEGACY_SESSIONLESS_REQUEST = "legacy-sessionless-request" as const;

/**
 * Raised when a stored request with no session would run again. Its own error
 * so a log tells "this is a pre-upgrade row" apart from a failed run; the
 * record is preserved unchanged.
 */
export class LegacySessionlessRequestError extends Error {
  readonly reason = LEGACY_SESSIONLESS_REQUEST;
  readonly seam: string;

  constructor(seam: string) {
    super(
      `${LEGACY_SESSIONLESS_REQUEST}: this request was recorded before every request named its session, so ${seam} ` +
        `cannot run it again: it is kept as history and can still be read and stopped. ` +
        `Send a new request in a session instead.`
    );
    this.name = "LegacySessionlessRequestError";
    this.seam = seam;
  }
}

/** Whether `record` names its session. */
export function namesSession(record: SessionNamedRecord): record is { readonly sessionId: string } {
  return typeof record.sessionId === "string" && record.sessionId.length > 0;
}

/**
 * The record's session, or the legacy refusal. The gate every re-entry path
 * calls, where there is one record in question and skipping it silently would
 * look like success.
 */
export function requireRecordSession(record: SessionNamedRecord, seam: string): string {
  if (!namesSession(record)) throw new LegacySessionlessRequestError(seam);
  return record.sessionId;
}
