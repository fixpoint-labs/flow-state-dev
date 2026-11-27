/**
 * The order and the page size the entries route and `useResource` share.
 *
 * Message ids are random, so storage-key order is not time order. Newest is
 * each entry's `at`. One comparison, so a merged entry lands where the route
 * would have paged it.
 */

/** The most keys one manifest page of the entries route returns. A value page stays at 200. */
export const COLLECTION_MANIFEST_PAGE = 10_000;

/** How many changed entries a resync reads at once. */
export const COLLECTION_RESYNC_READS = 20;

/** A finite `at` on a stored or projected value, or `null` when the entry has none. */
export function sentAtOf(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const at = (value as { at?: unknown }).at;
  return typeof at === "number" && Number.isFinite(at) ? at : null;
}

/** One place in newest order: a later `at` first, then the storage key. */
export type NewestPlace = { storageKey: string; at: number | null };

/**
 * Newest first. A later finite `at` comes first. An entry with no `at` comes
 * after every dated entry. The storage key breaks a tie, ascending.
 */
export function compareNewest(left: NewestPlace, right: NewestPlace): number {
  if (left.at !== null && right.at !== null && left.at !== right.at) return right.at - left.at;
  if (left.at !== null && right.at === null) return -1;
  if (left.at === null && right.at !== null) return 1;
  return left.storageKey < right.storageKey ? -1 : left.storageKey > right.storageKey ? 1 : 0;
}

/** Whether `entry` comes strictly after `mark` in {@link compareNewest} order. */
export function isAfterNewest(entry: NewestPlace, mark: NewestPlace): boolean {
  return compareNewest(mark, entry) < 0;
}
