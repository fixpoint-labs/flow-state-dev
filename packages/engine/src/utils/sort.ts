/**
 * Shared sort comparators used across stores and route handlers.
 */
import { compareItemOrder, type OutputItem } from "@flow-state-dev/core/items";

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
 * Sort items in display order: `ts`, then `itemIndex`, then request id, then
 * item id (`compareItemOrder`, the comparator a client merging streamed items
 * uses). Ties across requests never fall back to the order a store lists them.
 */
export function sortItemsChronologically(items: OutputItem[]): OutputItem[] {
  return [...items].sort(compareItemOrder);
}
