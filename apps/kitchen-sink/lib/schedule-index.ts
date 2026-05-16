/**
 * Standalone schedule-index proxy.
 *
 * Sits in its own module to break the cyclic import between
 * `lib/server.ts` (which builds the real `ScheduleIndex` against the pg
 * pool) and `flows/weekly-digest/flow.ts` (which hands the proxy to
 * `defineScheduleCollection`). Both sides import from here; neither
 * imports the other for this binding.
 *
 * The proxy is no-op until `setScheduleIndexImpl` is called from
 * `createStores()` once the pool exists. Before that, mutations match
 * `defineScheduleCollection`'s documented "no index → no row mirrored"
 * semantics.
 */

import type { ScheduleIndex, ScheduleIndexRow } from "@flow-state-dev/scheduled";

let impl: ScheduleIndex | null = null;

/** Install the backing implementation. Called once by `createStores()`. */
export function setScheduleIndexImpl(next: ScheduleIndex): void {
  impl = next;
}

/**
 * Stable proxy whose methods delegate to the installed implementation.
 * Safe to import from anywhere at module-init time; calls before the
 * impl is installed are no-ops.
 */
export const scheduleIndex: ScheduleIndex = {
  async upsert(row: ScheduleIndexRow) {
    if (impl) return impl.upsert(row);
  },
  async claimDue(now: number, limit?: number) {
    if (!impl) return [];
    return impl.claimDue(now, limit);
  },
  async remove(userId: string, key: string) {
    if (impl) return impl.remove(userId, key);
  },
};
