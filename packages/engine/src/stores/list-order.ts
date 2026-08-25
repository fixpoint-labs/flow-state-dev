/**
 * Comparators for the in-process store listings (memory and filesystem), one
 * per list-option sort key.
 *
 * Shared rather than inlined per adapter for the same reason the filter
 * predicates in `scope-keys.ts` are: two adapters implementing "the same"
 * ordering separately is how they drift, and the SQL adapters mirror these in
 * their `ORDER BY` builders because they cannot import across the type-only
 * package boundary.
 */
import type {
  RequestListOptions,
  RequestRecord,
  SessionListOptions,
  SessionRecord
} from "./types";

/**
 * Descending compare of two ids. Only ever a tie-break — it supplies a total
 * order where a timestamp ties, and carries no chronology of its own (request
 * ids are caller-supplied when the caller provides one).
 *
 * Adapters are internally consistent and that is all the contract requires;
 * two adapters may legitimately resolve the same tie differently, because a
 * JavaScript comparator, SQLite's binary order and Postgres' text collation
 * genuinely disagree on non-ASCII ids.
 */
function compareIdDesc(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

/**
 * Session listing order (FIX-1010).
 *
 * `"createdAt"` sorts on `(createdAt, id)` descending — both immutable, so a
 * record written during a caller's walk cannot reorder the pages under them.
 * Anything else keeps the shipped `updatedAt DESC`.
 */
export function compareSessionsForListing(
  left: SessionRecord,
  right: SessionRecord,
  options: SessionListOptions | undefined
): number {
  if (options?.orderBy === "createdAt") {
    const byCreatedAt = right.createdAt - left.createdAt;
    return byCreatedAt !== 0 ? byCreatedAt : compareIdDesc(left.id, right.id);
  }
  return right.updatedAt - left.updatedAt;
}

/**
 * Request listing order.
 *
 * `"startedAtMs"` sorts on `(startedAtMs, id)` descending — the `id`
 * tie-break makes "the most recent run" a total order, so a `limit: 1` read
 * resolves an exact same-millisecond tie deterministically instead of
 * arbitrarily. `"none"` is handled by the caller (it skips sorting entirely)
 * and never reaches here.
 */
export function compareRequestsForListing(
  left: RequestRecord,
  right: RequestRecord,
  options: RequestListOptions | undefined
): number {
  if (options?.orderBy === "startedAtMs") {
    const byStartedAt = right.startedAtMs - left.startedAtMs;
    return byStartedAt !== 0 ? byStartedAt : compareIdDesc(left.id, right.id);
  }
  return right.updatedAt - left.updatedAt;
}
