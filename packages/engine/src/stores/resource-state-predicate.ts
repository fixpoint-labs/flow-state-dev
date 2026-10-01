/**
 * The in-code write predicate behind the memory and filesystem
 * `ResourceStateStore` adapters.
 *
 * All four adapters answer the same question before a write — "does
 * `expectedVersion` admit this write against the row that is there now?" — and
 * they must answer it identically, or the contract means something different
 * depending on which store a deployment happens to use.
 *
 * The rest of the rule — the guards that refuse a version a verb cannot act
 * on, and the conflict a losing write reports — has one implementation, in
 * `@flow-state-dev/contracts` (reached through `@flow-state-dev/core/helpers`),
 * which all four adapters call. This module re-exports it so engine code keeps
 * one import site.
 *
 * The SQL adapters express {@link checkWriteVersion} a second time, as a
 * `WHERE` clause, because there the compare and the swap have to be one
 * statement to be atomic. This function is the reference those predicates
 * mirror; the shared conformance suite pins them against it.
 */
import {
  assertDeleteExpectedVersion,
  assertSetExpectedVersion,
  resourceStateConflict,
  type VersionConflict,
  type VersionedRow
} from "@flow-state-dev/core/helpers";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { ExpectedVersion } from "./types";

export { assertDeleteExpectedVersion, assertSetExpectedVersion, resourceStateConflict };

/** A stored row as every adapter models it internally. */
export type ResourceStateRow = VersionedRow<JsonObject>;

/** The conflict half of a `SetResult`, which is all this predicate can produce. */
export type ResourceStateConflict = VersionConflict<JsonObject>;

/**
 * Shared write predicate: returns a conflict `SetResult` when `expectedVersion`
 * does not admit a write against `row`, or `undefined` when it does.
 *
 * Assumes `expectedVersion` has already passed the assertion for its verb
 * ({@link assertSetExpectedVersion} / {@link assertDeleteExpectedVersion}).
 * The assertion is not folded in here because `delete` answers an absent or
 * already-tombstoned key without ever consulting the version — a check behind
 * this one would leave those paths unguarded.
 */
export function checkWriteVersion(
  row: ResourceStateRow | undefined,
  expectedVersion: ExpectedVersion
): ResourceStateConflict | undefined {
  if (expectedVersion === "any") return undefined;

  const isLive = row !== undefined && row.lifecycle === "live";

  // `"absent"` means "no row at all". A tombstone is a row — that is the whole
  // point of retaining it — so it refuses one, and the conflict it builds
  // carries `currentValue: undefined`, which the CAS driver reads as "deleted"
  // and stops on. This is the only expectation that can tell a never-written
  // key from a deleted one, and the reason `delete` means delete for a writer
  // that started out believing the key was never there.
  if (expectedVersion === "absent") {
    return row === undefined ? undefined : resourceStateConflict(row);
  }

  // `0` is the weaker "no live row" — create-if-absent, satisfied by a
  // tombstone as well as a key that never existed. Explicit recreation after a
  // delete rides on exactly this (FIX-992).
  if (expectedVersion === 0) return isLive ? resourceStateConflict(row) : undefined;

  // A positive version requires a live row at exactly that version. A
  // tombstone retaining the same number must still be refused, or the delete
  // never happened.
  return isLive && row.version === expectedVersion
    ? undefined
    : resourceStateConflict(row);
}

