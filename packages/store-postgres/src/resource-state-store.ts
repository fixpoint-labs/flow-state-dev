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
  ContentScopeType,
  ExpectedVersion,
  SetResult,
  VersionedResourceState
} from "@flow-state-dev/engine";
import type { QueryExecutor } from "./types";

/** A row as stored, before lifecycle filtering. */
type StoredRow = { state: JsonObject; version: number; lifecycle: string };

export function createPostgresResourceStateStore(executor: QueryExecutor): ResourceStateStore {
  const readRow = async (
    scopeType: ContentScopeType,
    scopeId: string,
    resourceKey: string
  ): Promise<StoredRow | undefined> => {
    const result = await executor.query(
      "SELECT state, version, lifecycle FROM resource_state " +
        "WHERE scope_type = $1 AND scope_id = $2 AND resource_key = $3",
      [scopeType, scopeId, resourceKey]
    );
    const row = result.rows[0] as StoredRow | undefined;
    if (row === undefined) return undefined;
    // node-pg returns BIGINT as a string, so coerce rather than letting a
    // string version silently fail every `===` comparison downstream.
    return { ...row, version: Number(row.version) };
  };

  /** Build the conflict result from whatever is stored right now. */
  const conflictFrom = (row: StoredRow | undefined): SetResult<JsonObject> => ({
    ok: false,
    conflict: {
      currentValue: row !== undefined && row.lifecycle === "live" ? row.state : undefined,
      currentVersion: row?.version ?? 0
    }
  });

  return {
    async get(
      scopeType: ContentScopeType,
      scopeId: string,
      resourceKey: string
    ): Promise<VersionedResourceState | undefined> {
      const row = await readRow(scopeType, scopeId, resourceKey);
      if (row === undefined || row.lifecycle !== "live") return undefined;
      return { state: row.state, version: row.version };
    },

    async set(
      scopeType: ContentScopeType,
      scopeId: string,
      resourceKey: string,
      state: JsonObject,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<JsonObject>> {
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
      scopeType: ContentScopeType,
      scopeId: string,
      resourceKey: string,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<JsonObject>> {
      const current = await readRow(scopeType, scopeId, resourceKey);
      // Nothing live to remove: idempotent, and no tombstone is minted for a
      // key that never existed — there is no observer to fence.
      if (current === undefined) return { ok: true, version: 0 };
      if (current.lifecycle !== "live") return { ok: true, version: current.version };

      // `-1` is the "any" sentinel, safe because a real version is always >= 1.
      const guard = expectedVersion === "any" ? -1 : expectedVersion;
      const marked = await executor.query(
        `UPDATE resource_state SET state = '{}'::jsonb, lifecycle = 'deleted'
         WHERE scope_type = $1 AND scope_id = $2 AND resource_key = $3
           AND lifecycle = 'live' AND ($4 = -1 OR version = $4)
         RETURNING version`,
        [scopeType, scopeId, resourceKey, guard]
      );
      if ((marked.rowCount ?? 0) === 0) {
        return conflictFrom(await readRow(scopeType, scopeId, resourceKey));
      }
      // Read the retained version off the statement, not off the pre-read:
      // under `"any"` a concurrent writer can advance the row between the two.
      return { ok: true, version: Number(marked.rows[0]!.version) };
    },

    async getAll(
      scopeType: ContentScopeType,
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
      scopeType: ContentScopeType,
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

    async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
      // Scope purge: one bulk lifecycle mark, retaining every version. Not a
      // DELETE — the retained versions are what stop a straggler from the
      // previous generation matching a row in the next one.
      await executor.query(
        `UPDATE resource_state SET state = '{}'::jsonb, lifecycle = 'deleted'
         WHERE scope_type = $1 AND scope_id = $2 AND lifecycle = 'live'`,
        [scopeType, scopeId]
      );
    }
  };
}
