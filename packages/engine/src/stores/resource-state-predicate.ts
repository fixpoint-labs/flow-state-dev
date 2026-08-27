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
import { cloneValue } from "@flow-state-dev/core/helpers";
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
 * Build the conflict a caller sees for `row`.
 *
 * A conflict reports the current **live** value, or `undefined` when the row is
 * a tombstone or absent — the distinction a caller needs in order to treat a
 * deleted resource as terminal rather than refreshing from a stale cache.
 *
 * This is the **reference** for that rule. Memory and filesystem reach it
 * through {@link checkWriteVersion}. The two SQL adapters restate it in three
 * lines instead — a store-adapter package's dependency on the engine is
 * type-only by package boundary (`scripts/validate-package-boundaries.mjs`), so
 * they can share {@link ResourceStateRow} but not runtime code. What keeps the
 * four from drifting is the shared conformance suite, which pins the rule
 * against every adapter.
 *
 * `currentValue` is deep-copied out of the row. A conflict exists to tell the
 * losing writer what is actually stored, so handing it a live reference into
 * the row would let the loser mutate the winner's value without touching the
 * winner's version — the same aliasing bug as on the read path, on the error
 * path. The in-memory adapter is the caller that makes this load-bearing: it
 * passes its retained row straight in. The filesystem adapter passes a leaf it
 * just parsed off disk, so the copy is redundant there but costs one small
 * clone on an already-failed write. The SQL adapters restate this function and
 * need no copy of their own — they build the conflict from a row parsed for
 * that one query and never retained.
 */
export function resourceStateConflict(
  row: ResourceStateRow | undefined
): ResourceStateConflict {
  const isLive = row !== undefined && row.lifecycle === "live";
  return {
    ok: false,
    conflict: {
      currentValue: isLive ? cloneValue(row.state) : undefined,
      currentVersion: row?.version ?? 0
    }
  };
}

/**
 * Refuse a numeric `expectedVersion` that cannot name a version.
 *
 * `0` means "no live row" and real versions start at `1`, so a negative,
 * fractional, `NaN` or infinite version is a programming error at the call site
 * — not a lost race. It is thrown rather than returned as a conflict for that
 * reason: a `SetResult` conflict reports a concurrency outcome the store never
 * observed, and sends the caller into a retry loop that can never converge.
 *
 * `-1` is the value this exists for. Both SQL adapters carry it as the in-band
 * `"any"` sentinel inside the delete predicate, which is sound over the versions
 * the store *produces* and says nothing about what a caller may *pass*. This
 * closes the input domain so the sentinel is unreachable from outside.
 */
function assertVersionNumber(expectedVersion: unknown): void {
  if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 0) {
    throw new TypeError(
      `expectedVersion must be a non-negative integer or "any", received ${String(expectedVersion)}`
    );
  }
}

/**
 * Refuse an `expectedVersion` `set` cannot act on, before any adapter does.
 *
 * `set` honours all three members of the union, and the two non-numeric ones
 * are **not** interchangeable on this side:
 *
 * - `0` — "no live row." Create-if-absent, satisfied by a tombstone as well as
 *   a key that never existed. This is what an explicit `create()` writes at,
 *   and recreating a deleted resource is intentional (FIX-992).
 * - `"absent"` — "no row at all." A tombstone **is** a row, so it conflicts.
 *   This is the stricter of the two, and it is what a read-modify-write that
 *   began from the absent-row seed writes at, so a delete cannot be undone by
 *   a mutation that never knew the resource was there (FIX-1258).
 *
 * `"absent"` means the same thing here as it does in `checkScopeWriteVersion`
 * — "no record exists" — which is why it is spelled the same. What it is not
 * is an alias for this store's `0`: aliasing them would collapse exactly the
 * distinction this predicate now draws. `delete` still refuses the word
 * outright ({@link assertDeleteExpectedVersion}), so it never acquires a
 * second, verb-dependent meaning.
 *
 * The assertion signature carries the refusal into the type system, so every
 * downstream body that does arithmetic on the value or binds it to a SQL
 * parameter can narrow on it without restating the check.
 *
 * The narrowing is a promise the compiler takes on trust, which is why the
 * check is an allowlist: `Number.isInteger` plus the two string early-returns
 * refuse every other value, including members this union does not have yet. A
 * guard that named only the members it knew would narrow a future member away
 * silently and hand it to that arithmetic. `"absent" !== 5` is, after all, a
 * perfectly good comparison.
 *
 * The rule is stated here and mirrored in the two SQL adapters, which cannot
 * import runtime engine code (see {@link resourceStateConflict}); the shared
 * conformance suite pins it against all four.
 */
export function assertSetExpectedVersion(
  expectedVersion: ExpectedVersion
): asserts expectedVersion is number | "any" | "absent" {
  if (expectedVersion === "any" || expectedVersion === "absent") return;
  assertVersionNumber(expectedVersion);
}

/**
 * Refuse an `expectedVersion` `delete` cannot act on.
 *
 * Same numeric domain as {@link assertSetExpectedVersion}, and `"absent"` on
 * top of it. "Delete only if the row does not exist" states no condition a
 * delete could act on: `0` already covers "no live row, so the requested
 * terminal state already holds," and there is nothing left for the stricter
 * word to ask. Refusing it here is the same call `assertDeltaExpectedVersion`
 * makes on the scope side, for the same reason — the verb read-modify-writes
 * something that has to be there.
 *
 * Keeping the refusal on this verb only is what lets `set` honour the word
 * without it meaning two things.
 */
export function assertDeleteExpectedVersion(
  expectedVersion: ExpectedVersion
): asserts expectedVersion is number | "any" {
  if (expectedVersion === "any") return;
  // Named ahead of the numeric check purely for the message: `Number.isInteger`
  // already refuses it, but "must be a non-negative integer" is unhelpful
  // advice for a caller who reached for the create-if-absent sentinel.
  if (expectedVersion === "absent") {
    throw new TypeError(
      'expectedVersion "absent" is not supported by ResourceStateStore.delete; use 0, which means "no live row" here'
    );
  }
  assertVersionNumber(expectedVersion);
}

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

