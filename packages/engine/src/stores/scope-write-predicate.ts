/**
 * Shared write predicate for the **scope** stores — `SessionStore`,
 * `RequestStore`, `UserStore`, `OrgStore`.
 *
 * These four share one CAS contract and four implementations, with no compiler
 * to enforce that they agree. This module is the single statement of how an
 * {@link ExpectedVersion} is read on that side, so the two in-repo adapters
 * (memory, filesystem) decide it in one place rather than two.
 *
 * The SQL adapters restate it instead of importing it: `@flow-state-dev/store-
 * sqlite` and `store-postgres` depend on `@flow-state-dev/engine` **type-only**
 * (`scripts/validate-package-boundaries.mjs`), and their predicate has to be a
 * single atomic statement anyway rather than a read followed by a decision.
 * The scope-store conformance suite (`stores/testing/scope-store-conformance`)
 * is what keeps all four honest — it is the reason this arrangement is safe,
 * and it mirrors how `resource-state-predicate.ts` relates to its own two SQL
 * copies.
 *
 * ## What `0` means here, and why `"absent"` exists
 *
 * Scope records are **created at version `0`**, so `0` is a real, live version
 * on this side and `expectedVersion: 0` means "the stored version is exactly
 * 0." That is the opposite of `ResourceStateStore`, which starts its versions
 * at `1` and spends its `0` on create-if-absent.
 *
 * So create-if-absent could not be spelled `0` here without breaking the first
 * CAS write of every new scope record. It is spelled `"absent"` — a value that
 * is not a number, cannot collide with a version, and means the same thing in
 * both store families. `ResourceStateStore` refuses it rather than aliasing it
 * (`assertExpectedVersion`), so the sentinel never acquires a second meaning.
 */

import type { ExpectedVersion } from "./types";

/**
 * Decide whether a scope write may proceed against the record that is
 * currently stored.
 *
 * Returns `undefined` when the write is admitted, or the version to report in
 * the conflict when it is refused. The caller supplies `current` because each
 * adapter reads it differently (a `Map` lookup, a file read) and owns building
 * the `SetResult` around this answer.
 *
 * | `expectedVersion` | Admitted when |
 * |---|---|
 * | `"any"` | Always — unconditional write |
 * | `"absent"` | No record exists. An existing record at **any** version, `0` included, conflicts |
 * | a number | The stored version equals it. An absent record reads as version `0`, which is why `0` alone cannot express "must not exist" |
 *
 * The absent-reads-as-`0` rule in the numeric branch is load-bearing and
 * deliberately preserved: `set(id, record, 0)` creating a record is the path
 * every new session, user and org takes today.
 */
export function checkScopeWriteVersion<TRecord extends { version: number }>(
  current: TRecord | undefined,
  expectedVersion: ExpectedVersion
): { currentVersion: number } | undefined {
  if (expectedVersion === "any") return undefined;

  if (expectedVersion === "absent") {
    return current === undefined ? undefined : { currentVersion: current.version };
  }

  // An absent record reads as version 0 — the pinned behaviour that leaves `0`
  // unable to mean "must not exist".
  const currentVersion = current?.version ?? 0;
  return currentVersion === expectedVersion ? undefined : { currentVersion };
}

/**
 * Refuse `"absent"` on a CAS delta verb (`patchField`, `incField`,
 * `pushToArray`, `deleteField`).
 *
 * Every delta verb read-modify-writes an **existing** record, so "only if this
 * record does not exist" is unsatisfiable by construction rather than a race
 * that might go the caller's way. It throws for the same reason
 * `assertExpectedVersion` throws on a negative version: returning a conflict
 * would report a concurrency outcome the store never observed and send the
 * caller into a retry loop that can never converge. `set(id, record,
 * "absent")` is how a record gets created.
 *
 * Mirrored in both SQL adapters' delta paths and pinned across all four by the
 * scope-store conformance suite.
 *
 * The assertion signature carries the refusal into the type system: after this
 * runs, `expectedVersion` narrows to `number | "any"`, so the `expectedVersion
 * + 1` in every delta path is checked rather than trusted. That arithmetic is
 * where `"absent"` would otherwise have become the version string `"absent1"`
 * — silently, since nothing about it is a type error on its own.
 */
export function assertDeltaExpectedVersion(
  expectedVersion: ExpectedVersion,
  verb: string
): asserts expectedVersion is number | "any" {
  if (expectedVersion === "absent") {
    throw new TypeError(
      `${verb} cannot take expectedVersion "absent": delta verbs update an existing record. Use set(id, record, "absent") to create one.`
    );
  }
}
