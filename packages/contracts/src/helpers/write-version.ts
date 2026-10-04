/**
 * The write-version rule every `ResourceStateStore` adapter shares.
 *
 * Before a write lands, each adapter answers two questions the same way: is
 * the `expectedVersion` one this verb can act on at all (the guards below),
 * and, when a write loses, what does the conflict report (the builder)? Those
 * answers are stated once, here, and every adapter — memory, filesystem,
 * SQLite, Postgres, and any custom one — calls them rather than restating
 * them. `@flow-state-dev/core/helpers` re-exports them.
 *
 * The decision "does this version admit a write against this row" is not
 * here. In-process stores make it in the engine (`checkWriteVersion`); the SQL
 * stores make it inside their write statements, where the compare and the swap
 * have to be one statement to be atomic. That SQL compare is the one second
 * statement of this rule, kept honest by the shared conformance suite.
 *
 * Zero dependencies, like the rest of contracts: the row type is generic over
 * its state, so no JSON type from `core` is needed here.
 */
import { cloneValue } from "./clone";

/**
 * The version a write expects to find, on every versioned store.
 *
 * - A whole number `n >= 1`: the live row must be at exactly version `n`.
 * - `0`: no live row (never written, or deleted).
 * - `"absent"`: no row at all. On a resource store a tombstone is a row, so
 *   this is the stricter of the two create expectations.
 * - `"any"`: write unconditionally.
 *
 * The engine re-exports this as `ExpectedVersion` and documents what each
 * store family does with it.
 */
export type ExpectedVersion = number | "any" | "absent";

/**
 * A stored row as every resource-state adapter models it internally, generic
 * over the state it carries (`JsonObject` for `ResourceStateStore`).
 */
export type VersionedRow<TState> = {
  state: TState;
  version: number;
  lifecycle: "live" | "deleted";
};

/** The conflict half of a `SetResult`, which is all this rule can produce. */
export type VersionConflict<TState> = {
  ok: false;
  conflict: { currentValue: TState | undefined; currentVersion: number };
};

/**
 * Build the conflict a caller sees for `row`.
 *
 * A conflict reports the current **live** value, or `undefined` when the row is
 * a tombstone or absent — the distinction a caller needs in order to treat a
 * deleted resource as terminal rather than refreshing from a stale cache. The
 * version is the row's, or `0` when there is no row.
 *
 * `currentValue` is deep-copied out of the row. A conflict exists to tell the
 * losing writer what is actually stored, so handing it a live reference into
 * the row would let the loser mutate the winner's value without touching the
 * winner's version. The in-memory adapter is the caller that makes this
 * load-bearing: it passes its retained row straight in. Adapters that pass a
 * row parsed for that one query pay one small clone on an already-failed
 * write.
 */
export function resourceStateConflict<TState>(
  row: VersionedRow<TState> | undefined
): VersionConflict<TState> {
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
 * reason: a conflict reports a concurrency outcome the store never observed,
 * and sends the caller into a retry loop that can never converge.
 *
 * **Two SQL stores depend on the refusal of `-1`.** Both the SQLite and the
 * Postgres adapter carry `-1` as the in-band `"any"` sentinel inside their
 * delete statement, which is sound only because no caller-supplied value can
 * reach it. Loosening this check to admit a negative number would let
 * `delete(…, -1)` tombstone any live row on those two stores while the
 * in-process stores kept behaving — so a change here is a change to their SQL
 * too.
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
 * are **not** interchangeable:
 *
 * - `0` — "no live row." Create-if-absent, satisfied by a tombstone as well as
 *   a key that never existed. Recreating a deleted resource rides on this.
 * - `"absent"` — "no row at all." A tombstone **is** a row, so it conflicts.
 *   This is what a read-modify-write that began from the absent-row seed
 *   writes at, so a delete cannot be undone by a mutation that never knew the
 *   resource was there.
 *
 * `delete` refuses the word outright ({@link assertDeleteExpectedVersion}), so
 * it never acquires a second, verb-dependent meaning.
 *
 * The assertion signature carries the refusal into the type system, so every
 * downstream body that does arithmetic on the value or binds it to a SQL
 * parameter can narrow on it without restating the check. The narrowing is a
 * promise the compiler takes on trust, which is why the check is an allowlist:
 * `Number.isInteger` plus the two string early-returns refuse every other
 * value, including members this union does not have yet.
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
 * word to ask.
 *
 * Call it before any early answer (a key that never existed, one already
 * deleted). Those paths never consult the version, so a guard placed after
 * them would leave them unguarded — and `-1` could reach the SQL stores'
 * sentinel (see {@link assertVersionNumber}).
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
