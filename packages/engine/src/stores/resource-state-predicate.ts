/**
 * The shared write predicate behind every `ResourceStateStore` adapter.
 *
 * All four adapters answer the same question before a write — "does
 * `expectedVersion` admit this write against the row that is there now?" — and
 * they must answer it identically, or the contract means something different
 * depending on which store a deployment happens to use. It lives here rather
 * than in whichever adapter defined it first.
 *
 * The SQL adapters express the same rules a second time, as a `WHERE` clause,
 * because there the compare and the swap have to be one statement to be
 * atomic. This function is the reference those predicates mirror.
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import type { ExpectedVersion } from "./types";

/** A stored row as every adapter models it internally. */
export type ResourceStateRow = {
  state: JsonObject;
  version: number;
  lifecycle: "live" | "deleted";
};

/** The conflict half of a `SetResult`, which is all this predicate can produce. */
export type ResourceStateConflict = {
  ok: false;
  conflict: { currentValue: JsonObject | undefined; currentVersion: number };
};

/**
 * Shared write predicate: returns a conflict `SetResult` when `expectedVersion`
 * does not admit a write against `row`, or `undefined` when it does.
 *
 * A conflict reports the current **live** value, or `undefined` when the row
 * is a tombstone — the distinction a caller needs in order to treat a deleted
 * resource as terminal rather than refreshing from a stale cache.
 */
export function checkWriteVersion(
  row: ResourceStateRow | undefined,
  expectedVersion: ExpectedVersion
): ResourceStateConflict | undefined {
  if (expectedVersion === "any") return undefined;

  const isLive = row !== undefined && row.lifecycle === "live";
  const conflict = {
    ok: false as const,
    conflict: {
      currentValue: isLive ? row.state : undefined,
      currentVersion: row?.version ?? 0
    }
  };

  // `0` means "no live row" — create-if-absent, satisfied by a tombstone as
  // well as a key that never existed.
  if (expectedVersion === 0) return isLive ? conflict : undefined;

  // A positive version requires a live row at exactly that version. A
  // tombstone retaining the same number must still be refused, or the delete
  // never happened.
  return isLive && row.version === expectedVersion ? undefined : conflict;
}

