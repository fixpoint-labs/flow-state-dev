/**
 * PostgreSQL-backed resource state store.
 *
 * Stores resource state (single-resource and collection-instance alike)
 * addressed by (scope_type, scope_id, resource_key). State is stored as JSONB
 * in a dedicated `resource_state` table, parallel to `resource_content` and
 * separate from the scope record JSONB.
 *
 * Concurrency is compare-and-swap, not last-write-wins: each row carries a
 * monotonic `version` and a `lifecycle`, deletes tombstone rather than remove,
 * and tombstones are retained. See `ResourceStateStore` for the semantics all
 * four adapters share.
 *
 * The CAS is a single conditional statement — the write predicates on the
 * current version and lifecycle in its `WHERE` clause, so the compare and the
 * swap are one atomic operation under the row lock. `rowCount === 0` means the
 * predicate did not match, which is the conflict signal; the current row is
 * then re-read to report it.
 */

import type { JsonObject } from "@flow-state-dev/core/types";
import type {
  ResourceStateStore,
  StorageScopeType,
  ExpectedVersion,
  ResourceStateRow,
  SetResult,
  VersionedResourceState
} from "@flow-state-dev/engine";
import type { QueryExecutor } from "./types";

/** A row as Postgres hands it back, before coercion and lifecycle narrowing. */
type RawRow = { state: JsonObject; version: number | string; lifecycle: string };

export function createPostgresResourceStateStore(executor: QueryExecutor): ResourceStateStore {
  /** Read the row and parse it into the shape the shared contract logic takes. */
  const readRow = async (
    scopeType: StorageScopeType,
    scopeId: string,
    resourceKey: string
  ): Promise<ResourceStateRow | undefined> => {
    const result = await executor.query(
      "SELECT state, version, lifecycle FROM resource_state " +
        "WHERE scope_type = $1 AND scope_id = $2 AND resource_key = $3",
      [scopeType, scopeId, resourceKey]
    );
    const row = result.rows[0] as RawRow | undefined;
    if (row === undefined) return undefined;
    return {
      state: row.state,
      // node-pg returns BIGINT as a string, so coerce rather than letting a
      // string version silently fail every `===` comparison downstream.
      version: Number(row.version),
      lifecycle: row.lifecycle === "live" ? "live" : "deleted"
    };
  };

  /**
   * Refuse an `expectedVersion` that cannot name a version.
   *
   * Mirrors `assertVersionNumber` in the engine's
   * `stores/resource-state-predicate` module — restated for the same reason as
   * {@link conflictFrom} below, and pinned across all four adapters by the
   * shared conformance suite. `0` means "no live row" and real versions start
   * at `1`, so a negative, fractional, `NaN` or infinite version is refused
   * loudly: that is a programming error and not a lost race, and reporting it
   * as a conflict would name a concurrency outcome this store never observed.
   *
   * This is what keeps the `-1` sentinel in `delete` sound. `-1` is safe over
   * the versions the store *produces*; it says nothing about what a caller may
   * *pass*, and without this guard `delete(…, -1)` matched the sentinel branch
   * and tombstoned any live row.
   */
  const assertVersionNumber = (expectedVersion: unknown): void => {
    if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 0) {
      throw new TypeError(
        `expectedVersion must be a non-negative integer or "any", received ${String(expectedVersion)}`
      );
    }
  };

  /**
   * `set` honours all three members of the union, and the two non-numeric ones
   * are not interchangeable: `0` is "no live row" (create-if-absent, a
   * tombstone satisfies it) and `"absent"` is the stricter "no row at all" (a
   * tombstone is a row and refuses it). Mirrors `assertSetExpectedVersion` in
   * the engine module.
   *
   * The assertion signature lets the arithmetic and the numeric binds further
   * down rely on the narrowing without restating the check — which is also
   * what keeps a string out of a numeric bind parameter, where it would fail
   * silently rather than loudly. The narrowing is a promise the compiler takes
   * on trust, so the check is an allowlist: `Number.isInteger` plus the two
   * string early-returns refuse every other value, including members this
   * union does not have yet.
   */
  const assertSetExpectedVersion: (
    expectedVersion: ExpectedVersion
  ) => asserts expectedVersion is number | "any" | "absent" = (expectedVersion) => {
    if (expectedVersion === "any" || expectedVersion === "absent") return;
    assertVersionNumber(expectedVersion);
  };

  /**
   * `delete` refuses `"absent"`: "delete only if the row does not exist" states
   * no condition a delete could act on, since `0` already covers "no live row,
   * so the terminal state already holds." Mirrors
   * `assertDeleteExpectedVersion` in the engine module. Keeping the refusal on
   * this verb only is what lets `set` honour the word without it meaning two
   * things.
   */
  const assertDeleteExpectedVersion: (
    expectedVersion: ExpectedVersion
  ) => asserts expectedVersion is number | "any" = (expectedVersion) => {
    if (expectedVersion === "any") return;
    if (expectedVersion === "absent") {
      throw new TypeError(
        'expectedVersion "absent" is not supported by ResourceStateStore.delete; use 0, which means "no live row" here'
      );
    }
    assertVersionNumber(expectedVersion);
  };

  /**
   * Build the conflict result from whatever is stored right now.
   *
   * This mirrors `resourceStateConflict` in the engine's
   * `stores/resource-state-predicate` module, which is the reference for what a
   * conflict reports. It is restated rather than imported because a store
   * adapter's dependency on `@flow-state-dev/engine` is **type-only** by
   * package boundary (`scripts/validate-package-boundaries.mjs`), and that
   * module is runtime code. What is shared is `ResourceStateRow`, above: both
   * SQL adapters parse into the same shape, so the two bodies are the same
   * three lines, and the shared conformance suite pins the rule for all four
   * adapters — a semantic tweak that misses one shows up as a failing case
   * rather than as silent divergence.
   */
  const conflictFrom = (row: ResourceStateRow | undefined): SetResult<JsonObject> => {
    const isLive = row !== undefined && row.lifecycle === "live";
    return {
      ok: false,
      conflict: {
        currentValue: isLive ? row.state : undefined,
        currentVersion: row?.version ?? 0
      }
    };
  };

  return {
    async get(
      scopeType: StorageScopeType,
      scopeId: string,
      resourceKey: string
    ): Promise<VersionedResourceState | undefined> {
      const row = await readRow(scopeType, scopeId, resourceKey);
      if (row === undefined || row.lifecycle !== "live") return undefined;
      return { state: row.state, version: row.version };
    },

    async set(
      scopeType: StorageScopeType,
      scopeId: string,
      resourceKey: string,
      state: JsonObject,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<JsonObject>> {
      assertSetExpectedVersion(expectedVersion);
      const payload = JSON.stringify(state);

      if (expectedVersion === "any") {
        // The bump happens IN the statement, not from a prior read: a
        // read-then-write here is not atomic, and two concurrent `"any"`
        // writers would both compute the same next version and both commit it.
        // The loser would then hold a version naming the winner's row, and its
        // next CAS write would sail through and clobber it — the exact lost
        // update this store exists to stop, on the one path every caller uses
        // until the registry driver lands.
        const written = await executor.query(
          `INSERT INTO resource_state (scope_type, scope_id, resource_key, state, version, lifecycle)
           VALUES ($1, $2, $3, $4::jsonb, 1, 'live')
           ON CONFLICT (scope_type, scope_id, resource_key) DO UPDATE SET
             state = EXCLUDED.state,
             version = resource_state.version + 1,
             lifecycle = 'live'
           RETURNING version`,
          [scopeType, scopeId, resourceKey, payload]
        );
        return { ok: true, version: Number(written.rows[0]!.version) };
      }

      if (expectedVersion === "absent") {
        // "No row at all" is the insert, and nothing else: the PK arbitrates,
        // and `DO NOTHING` turns any existing row — live OR tombstoned — into
        // zero rows. That is the whole difference from the `0` branch below,
        // which goes on to revive a tombstone. Deliberately one statement: a
        // read-then-insert would let a delete land in between and put the
        // write back on the resurrection path this exists to close.
        const inserted = await executor.query(
          `INSERT INTO resource_state (scope_type, scope_id, resource_key, state, version, lifecycle)
           VALUES ($1, $2, $3, $4::jsonb, 1, 'live')
           ON CONFLICT (scope_type, scope_id, resource_key) DO NOTHING`,
          [scopeType, scopeId, resourceKey, payload]
        );
        if ((inserted.rowCount ?? 0) > 0) return { ok: true, version: 1 };
        return conflictFrom(await readRow(scopeType, scopeId, resourceKey));
      }

      if (expectedVersion === 0) {
        // No row at all: a plain insert at version 1. `DO NOTHING` makes a lost
        // race report zero rows rather than overwriting the winner.
        const inserted = await executor.query(
          `INSERT INTO resource_state (scope_type, scope_id, resource_key, state, version, lifecycle)
           VALUES ($1, $2, $3, $4::jsonb, 1, 'live')
           ON CONFLICT (scope_type, scope_id, resource_key) DO NOTHING`,
          [scopeType, scopeId, resourceKey, payload]
        );
        if ((inserted.rowCount ?? 0) > 0) return { ok: true, version: 1 };

        // A row exists. Recreating over a tombstone continues from its version,
        // so a version is never reused; a live row is a conflict.
        const current = await readRow(scopeType, scopeId, resourceKey);
        if (current === undefined || current.lifecycle === "live") {
          return conflictFrom(current);
        }
        const nextVersion = current.version + 1;
        // Fence on the tombstone version this call actually observed. Without
        // it the predicate says only "still not live", so a revive that raced
        // another revive-plus-delete would write a version the other
        // generation already used — reusing a version is precisely what the
        // retained tombstone exists to prevent.
        const revived = await executor.query(
          `UPDATE resource_state SET state = $1::jsonb, version = $2, lifecycle = 'live'
           WHERE scope_type = $3 AND scope_id = $4 AND resource_key = $5
             AND lifecycle <> 'live' AND version = $6`,
          [payload, nextVersion, scopeType, scopeId, resourceKey, current.version]
        );
        if ((revived.rowCount ?? 0) === 0) {
          return conflictFrom(await readRow(scopeType, scopeId, resourceKey));
        }
        return { ok: true, version: nextVersion };
      }

      const nextVersion = expectedVersion + 1;
      const updated = await executor.query(
        `UPDATE resource_state SET state = $1::jsonb, version = $2, lifecycle = 'live'
         WHERE scope_type = $3 AND scope_id = $4 AND resource_key = $5
           AND version = $6 AND lifecycle = 'live'`,
        [payload, nextVersion, scopeType, scopeId, resourceKey, expectedVersion]
      );
      if ((updated.rowCount ?? 0) === 0) {
        return conflictFrom(await readRow(scopeType, scopeId, resourceKey));
      }
      return { ok: true, version: nextVersion };
    },

    async delete(
      scopeType: StorageScopeType,
      scopeId: string,
      resourceKey: string,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<JsonObject>> {
      // The statement goes first, with no pre-read short-circuit ahead of it.
      // A short-circuit would answer "already tombstoned" on its own path,
      // leaving the zero-row branch reachable only under a real race — which
      // is how two concurrent deletes of one live row ended up reporting a
      // conflict to the loser while the sequential idempotence test passed.
      // One path means the contract is decided in one place for every caller,
      // raced or not, and the conformance suite exercises it every run.
      //
      // `-1` is the "any" sentinel. What makes it safe is not that a real
      // version is always >= 1 — that is a fact about the versions the store
      // produces, and the guard sits on the input side. It is safe because
      // `assertDeleteExpectedVersion` has already refused every negative, so no
      // caller-supplied value can reach the sentinel branch.
      assertDeleteExpectedVersion(expectedVersion);
      const guard = expectedVersion === "any" ? -1 : expectedVersion;
      const marked = await executor.query(
        `UPDATE resource_state SET state = '{}'::jsonb, lifecycle = 'deleted'
         WHERE scope_type = $1 AND scope_id = $2 AND resource_key = $3
           AND lifecycle = 'live' AND ($4 = -1 OR version = $4)
         RETURNING version`,
        [scopeType, scopeId, resourceKey, guard]
      );
      // Read the retained version off the statement, not off a prior read:
      // under `"any"` a concurrent writer can advance the row between the two.
      if ((marked.rowCount ?? 0) > 0) {
        return { ok: true, version: Number(marked.rows[0]!.version) };
      }

      // Nothing matched. Re-read to tell the two reasons apart.
      const current = await readRow(scopeType, scopeId, resourceKey);
      // Nothing live to remove — absent, or already a tombstone (whether it was
      // tombstoned an hour ago or by the delete that just beat us). The
      // requested terminal state holds, so this is an idempotent success. No
      // tombstone is minted for a key that never existed: there is no observer
      // to fence.
      if (current === undefined) return { ok: true, version: 0 };
      if (current.lifecycle !== "live") return { ok: true, version: current.version };

      // A live row, after a statement that matched nothing. What that means
      // depends on what the caller asserted, and the two cases are NOT the
      // same — flattening them either way loses a real answer.
      //
      // `"any"` asserts nothing about versions, and its `-1` guard matches
      // every one of them, so a zero-row UPDATE can only mean there was no
      // live row when it ran. That is exactly the question a blind delete
      // asks, already answered: the call linearizes at the UPDATE, and the row
      // visible now was recreated after it. Reporting a conflict would name a
      // concurrency failure that did not affect this request.
      //
      // Version `0` and not `current.version`. `0` is this contract's "no live
      // row", which is what the UPDATE observed, and it is deliberately not a
      // version any row holds. `current.version` names the recreated row —
      // live, and something this delete never removed — so handing it back as
      // though it were a tombstone's retained version is the one genuinely
      // unsafe answer here: a caller could carry it forward into a write
      // against a generation it has never seen.
      if (expectedVersion === "any") return { ok: true, version: 0 };

      // A positive `expectedVersion` DID assert one, and at that same
      // linearization point the assertion did not hold — the row was live at
      // another version, or not live at all. That is a genuine conflict on its
      // own terms, whatever happened afterwards, and it carries the version
      // now stored so the caller can retry against it.
      return conflictFrom(current);
    },

    async getAll(
      scopeType: StorageScopeType,
      scopeId: string
    ): Promise<Record<string, VersionedResourceState>> {
      const result = await executor.query(
        "SELECT resource_key, state, version FROM resource_state " +
          "WHERE scope_type = $1 AND scope_id = $2 AND lifecycle = 'live'",
        [scopeType, scopeId]
      );
      const entries: Record<string, VersionedResourceState> = {};
      for (const row of result.rows) {
        entries[row.resource_key as string] = {
          state: row.state as JsonObject,
          version: Number(row.version)
        };
      }
      return entries;
    },

    async getByPrefix(
      scopeType: StorageScopeType,
      scopeId: string,
      keyPrefix: string
    ): Promise<Record<string, VersionedResourceState>> {
      // Prefix match via LEFT(...) = prefix rather than LIKE — sidesteps
      // LIKE wildcard escaping (`%`/`_` are legal in resource keys). An
      // empty prefix matches every key (LEFT(key, 0) = '').
      const result = await executor.query(
        "SELECT resource_key, state, version FROM resource_state " +
          "WHERE scope_type = $1 AND scope_id = $2 AND lifecycle = 'live' " +
          "AND LEFT(resource_key, char_length($3)) = $3",
        [scopeType, scopeId, keyPrefix]
      );
      const entries: Record<string, VersionedResourceState> = {};
      for (const row of result.rows) {
        entries[row.resource_key as string] = {
          state: row.state as JsonObject,
          version: Number(row.version)
        };
      }
      return entries;
    },

    async deleteAll(scopeType: StorageScopeType, scopeId: string): Promise<void> {
      // Scope purge: one bulk lifecycle mark, retaining every version. Not a
      // DELETE — the retained versions are what stop a straggler from the
      // previous generation matching a row in the next one.
      await executor.query(
        `UPDATE resource_state SET state = '{}'::jsonb, lifecycle = 'deleted'
         WHERE scope_type = $1 AND scope_id = $2 AND lifecycle = 'live'`,
        [scopeType, scopeId]
      );
    },

    async purgeTombstones(scopeType: StorageScopeType, scopeId: string): Promise<void> {
      // Scope re-creation: a real DELETE of the dead rows only, so the new
      // incarnation of a reused scope id inherits no tombstone. The inverse of
      // `deleteAll` above — same scope predicate, opposite lifecycle — and
      // deliberately not reachable from teardown. See `purgeTombstones` on
      // `ResourceStateStore` for what giving those versions back costs.
      await executor.query(
        `DELETE FROM resource_state
         WHERE scope_type = $1 AND scope_id = $2 AND lifecycle = 'deleted'`,
        [scopeType, scopeId]
      );
    }
  };
}
