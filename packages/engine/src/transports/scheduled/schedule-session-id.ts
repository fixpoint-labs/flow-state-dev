// FIX-2886 D1.
/**
 * Schedule session ids: the session every fire of a `per-schedule` schedule
 * runs in, the prefix that reserves it, and the check for one. A leaf module,
 * so the host, the routes and the request host can each refuse the prefix
 * without importing the scheduled endpoint.
 *
 * The id is derived, never written: the org and user a fire runs as, the flow
 * instance, and the schedule id. Anyone who knows those can compute it, so
 * the prefix is reserved and only a scheduled dispatch may create the session
 * or run in it. Its owner still lists and reads it, unlike a write session.
 *
 * Colon-free on purpose. The session storage key is `${tenant}:${sessionId}`
 * with the tenant from a request header, so a colon-joined id could be split
 * across the header and the body to land on another caller's key. The parts
 * are base64url, which has no `:`, as a write session id's are.
 */

/** Every schedule session id starts with this; only a scheduled dispatch may name one. */
export const SCHEDULE_SESSION_PREFIX = "fsd-schedule.";

/** What a schedule session is for: who its fires run as, on which flow instance, for which schedule. */
export interface ScheduleSessionParts {
  readonly orgId: string;
  readonly userId: string;
  /** The flow instance's id. */
  readonly flowId: string;
  readonly scheduleId: string;
}

/** The session every fire of one `per-schedule` schedule runs in, for one principal and flow instance. */
export function scheduleSessionId(parts: ScheduleSessionParts): string {
  const encoded = Buffer.from(
    JSON.stringify([parts.orgId, parts.userId, parts.flowId, parts.scheduleId]),
    "utf8"
  ).toString("base64url");
  return `${SCHEDULE_SESSION_PREFIX}${encoded}`;
}

/** Whether `id` (bare, or tenant-namespaced as `tenant:id`) is a schedule session's. */
export function isScheduleSessionId(id: string): boolean {
  return id.startsWith(SCHEDULE_SESSION_PREFIX) || id.includes(`:${SCHEDULE_SESSION_PREFIX}`);
}

/** A dispatch or a client named a schedule session: only the scheduled transport runs in one. */
export class ScheduleSessionIdError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session "${sessionId}" is a schedule session, the scheduled dispatch's to create and run in: nothing else can name one.`);
    this.name = "ScheduleSessionIdError";
  }
}
