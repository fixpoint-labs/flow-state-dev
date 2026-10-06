/**
 * Control `queued-shown`: Tasks treats no row as queued.
 *
 * Built into the control page in place of `src/lib/tasks.ts`. Everything is
 * the real module except `isQueued`, which says no for every row, so the
 * Queued toggle hides nothing and counts nothing. The goal must fail at
 * "Tasks equals the store's open rows" on a Lab holding a queued row.
 */
export * from "../../../../packages/shift-manager/src/lib/tasks.ts";

/** No row is queued. */
export function isQueued(): boolean {
  return false;
}
