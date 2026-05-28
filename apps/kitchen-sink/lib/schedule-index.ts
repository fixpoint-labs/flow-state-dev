/**
 * Standalone schedule-index proxy.
 *
 * Sits in its own module to break the cyclic import between
 * `lib/flowstate.ts` (which installs the real `ScheduleIndex` from
 * `vercelPostgresStores().scheduleIndex`) and `flows/weekly-digest/flow.ts`
 * (which hands the proxy to `defineScheduleCollection`). Both sides import
 * from here; neither imports the other for this binding.
 *
 * Starts as a no-op `ScheduleIndex` so callers can invoke methods
 * before the active store profile resolves its pool, without null-checks.
 * `setScheduleIndexImpl` swaps in the real implementation. The no-op
 * default matches `defineScheduleCollection`'s documented "no index →
 * no row mirrored" semantics.
 */

import type { ScheduleIndex, ScheduleIndexRow } from "@flow-state-dev/scheduled";

let impl: ScheduleIndex = {
  async upsert() {},
  async claimDue() { return []; },
  async remove() {},
};

/** Install the backing implementation. Called once by `lib/flowstate.ts`. */
export function setScheduleIndexImpl(next: ScheduleIndex): void {
  impl = next;
}

/**
 * Stable proxy whose methods delegate to the installed implementation.
 * Safe to import from anywhere at module-init time.
 */
export const scheduleIndex: ScheduleIndex = {
  upsert: (row: ScheduleIndexRow) => impl.upsert(row),
  claimDue: (now: number, limit?: number) => impl.claimDue(now, limit),
  remove: (userId: string, key: string) => impl.remove(userId, key),
};
