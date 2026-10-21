/**
 * Where the dispatch endpoint keeps each schedule's fired record: the latest
 * scheduled time it fired, one row per schedule, in the user cell of the
 * principal the schedule runs as. Engine-free, so a flow that deletes a
 * schedule can delete its record with it, through a collection over
 * {@link FIRED_RECORDS_PATTERN}.
 */

/** The resource pattern the fired records live under, at user scope: a key holds `/`, so any depth. */
export const FIRED_RECORDS_PATTERN = "scheduled-fires/**";

/** {@link FIRED_RECORDS_PATTERN}'s prefix, without its wildcard. */
const FIRED_RECORDS_PREFIX = "scheduled-fires/";

/**
 * A schedule's fired-record key within {@link FIRED_RECORDS_PATTERN}: the
 * flow the schedule is dispatched on, then its dispatch id.
 */
export function firedRecordCollectionKey(flowKind: string, scheduleId: string): string {
  return `${flowKind}/${scheduleId}`;
}

/** A schedule's fired-record resource key, prefix included. */
export function firedRecordKey(flowKind: string, scheduleId: string): string {
  return `${FIRED_RECORDS_PREFIX}${firedRecordCollectionKey(flowKind, scheduleId)}`;
}
