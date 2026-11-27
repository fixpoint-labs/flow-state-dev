/**
 * Put every user's routines back into the schedule indexes their writes
 * mirror into: the clock routines' (`routines.index`) and the polls'
 * (`routines.poll.index`). An index is written only when a schedule is, so one
 * that lost rows (a deleted or reset index file) leaves enabled routines that
 * never fire. The workforce kit runs this once the app serves (its
 * `onStarted`). Reads the schedules, writes none: a poll's cursor stays where
 * it was.
 */
import type { KitStartedHost } from "@flow-state-dev/core";
import { reassertSchedules, type ScheduleIndex } from "@flow-state-dev/scheduled/collection";
import { SCHEDULES_PATTERN } from "../schedules/keys";
import { SUBSCRIPTION_POLLS_PATTERN } from "../subscriptions/keys";

/** The indexes to put back, as `hireWorkforce`'s `routines.index` and `routines.poll.index`. */
export interface RoutineIndexes {
  readonly index: ScheduleIndex | undefined;
  readonly pollIndex: ScheduleIndex | undefined;
}

/**
 * Assert an index row for each enabled clock routine and poll schedule in
 * every user cell the store holds. A row the index still holds is kept as it
 * is (`ensure`), so nothing duplicates and no due fire moves. Resolves to how
 * many rows each index got, across cells.
 */
export async function reassertRoutineIndexes(host: KitStartedHost, indexes: RoutineIndexes): Promise<{ clock: number; poll: number }> {
  const asserted = { clock: 0, poll: 0 };
  if (indexes.index === undefined && indexes.pollIndex === undefined) return asserted;
  // Both collections are shared across flows (`flowIsolation: false`): one cell per user and organization.
  for (const { userId, orgId, cell } of await host.userCells()) {
    const reassert = async (index: ScheduleIndex | undefined, pattern: string) => {
      if (index === undefined) return 0;
      const schedules = await host.readUserResources(cell, pattern.slice(0, pattern.indexOf("*")));
      return reassertSchedules({ index, pattern, cell, userId, orgId, schedules });
    };
    asserted.clock += await reassert(indexes.index, SCHEDULES_PATTERN);
    asserted.poll += await reassert(indexes.pollIndex, SUBSCRIPTION_POLLS_PATTERN);
  }
  return asserted;
}
