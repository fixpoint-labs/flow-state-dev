// FIX-2942; BP-030; BP-031.
/**
 * Which sessions a machine created, and so own nothing but themselves.
 *
 * Two principals name a machine, not a person: the gateway a schedule fires
 * as (the scheduler's bearer principal, which fronts webhooks too) and the
 * system user. Two schedules on one of them must never reach each other's
 * sessions, and neither may a later run in such a session: a wake after a
 * settle, a task, an internal run. Those runs replace the fire's metadata, so a
 * per-run stamp dies with the first of them.
 *
 * So the classification is written on the session record once, at birth
 * (`SessionRecord.machineOwned`, set by `birthSession`), and read from the
 * caller's own session record on every named reach. The scheduled route's
 * `machinePrincipal` stamp is only the input that tells the birth a fire's
 * creator is a machine.
 */
import { SCHEDULED_SOURCE } from "../execution/transport-sources";
import type { SessionRecord } from "../stores/types";

/** The system principal's user (`ScheduleConfig.principal`): a machine. */
export const SYSTEM_USER_ID = "system";

/**
 * Whether a run's principal is a machine's that owns nothing: a scheduled run
 * the scheduled route stamped `machinePrincipal` (its effective principal is
 * the gateway's, or the system user's). Read only under the scheduled source,
 * whose metadata the scheduled route sets, so a caller's metadata can't claim
 * or shed it. The input a session's birth reads, never an admission.
 */
export function principalOwnsNothing(source: string | undefined, metadata: unknown): boolean {
  if (source !== SCHEDULED_SOURCE) return false;
  const schedule = (metadata as { schedule?: { machinePrincipal?: unknown } } | undefined)?.schedule;
  if (schedule === undefined || schedule === null || typeof schedule !== "object") return false;
  return schedule.machinePrincipal === true;
}

/**
 * Whether the runs in `session` own nothing but it: a session a machine
 * created, a record from before the classification existed (fail closed), or
 * no record at all.
 */
export function sessionOwnsNothing(session: Pick<SessionRecord, "machineOwned"> | undefined): boolean {
  return session?.machineOwned !== false;
}
