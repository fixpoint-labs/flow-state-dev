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
 * Refuse an `expectedVersion` that cannot name a version, before any adapter
 * acts on it.
 *
 * `ExpectedVersion` is `number | "any" | "absent"`, so the type admits values
 * the contract has no meaning for: `0` means "no live row" and real versions
 * start at `1`, so a negative, fractional, `NaN` or infinite version is a
 * programming error at the call site — not a lost race. It is thrown rather
 * than returned as a conflict for that reason: a `SetResult` conflict reports a
 * concurrency outcome the store never observed, and sends the caller into a
 * retry loop that can never converge.
 *
 * `"absent"` is refused here for the same reason, and deliberately **not**
 * aliased onto this store's `0`. The two would agree on `set` — but not on
 * `delete`, where `0` has a coherent meaning ("no live row, so the requested
 * terminal state already holds") and "delete only if absent" has none. An
 * alias would give one sentinel a second, verb-dependent meaning on the
 * subtlest predicate in these adapters. Scope stores, whose `0` is a real
 * version, are where `"absent"` is spelled and honoured.
 *
 * The assertion signature carries the refusal into the type system: after this
 * runs, `expectedVersion` narrows to `number | "any"`, so every downstream body
 * that does arithmetic on it or binds it to a SQL parameter is checked rather
 * than trusted. Adding a fourth member to `ExpectedVersion` will surface as a
 * compile error in each of those bodies instead of a silent wrong answer —
 * `"absent" !== 5` is, after all, a perfectly good comparison.
 *
 * The rule is stated here and mirrored in the two SQL adapters, which cannot
 * import runtime engine code (see {@link resourceStateConflict}); the shared
 * conformance suite pins it against all four.
 *
 * `-1` is the value this exists for. Both SQL adapters carry it as the in-band
 * `"any"` sentinel inside the delete predicate, which is sound over the versions
 * the store *produces* and says nothing about what a caller may *pass*. This
 * closes the input domain so the sentinel is unreachable from outside.
 */
export function assertExpectedVersion(
  expectedVersion: ExpectedVersion
): asserts expectedVersion is number | "any" {
  if (expectedVersion === "any") return;
  if (expectedVersion === "absent") {
    throw new TypeError(
      'expectedVersion "absent" is not supported by ResourceStateStore; use 0, which means "no live row" here'
    );
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new TypeError(
      `expectedVersion must be a non-negative integer or "any", received ${String(expectedVersion)}`
    );
  }
}

/**
 * Shared write predicate: returns a conflict `SetResult` when `expectedVersion`
 * does not admit a write against `row`, or `undefined` when it does.
 *
 * Assumes `expectedVersion` has already passed {@link assertExpectedVersion}.
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

  // `0` means "no live row" — create-if-absent, satisfied by a tombstone as
  // well as a key that never existed.
  if (expectedVersion === 0) return isLive ? resourceStateConflict(row) : undefined;

  // A positive version requires a live row at exactly that version. A
  // tombstone retaining the same number must still be refused, or the delete
  // never happened.
  return isLive && row.version === expectedVersion
    ? undefined
    : resourceStateConflict(row);
}

