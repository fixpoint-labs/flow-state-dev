/**
 * Shared sort comparators used across stores and route handlers.
 */
import type { OutputItem } from "@flow-state-dev/core/items";

/**
 * Sort records by updatedAt descending (most recently updated first).
 */
export function sortByUpdatedAtDesc<TRecord extends { updatedAt: number }>(
  left: TRecord,
  right: TRecord
): number {
  return right.updatedAt - left.updatedAt;
}

/**
 * Sort items chronologically by timestamp, with itemIndex as tiebreaker.
 */
export function sortItemsChronologically(items: OutputItem[]): OutputItem[] {
  return [...items].sort((left, right) => {
    const tsDiff = left.ts - right.ts;
    if (tsDiff !== 0) {
      return tsDiff;
    }

    return left.itemIndex - right.itemIndex;
  });
}
