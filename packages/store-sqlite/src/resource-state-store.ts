/**
 * SQLite-backed resource state store for the SQLite adapter package.
 *
 * State — single-resource and collection-instance alike — is addressed by
 * (scope_type, scope_id, resource_key) and stored durably in the
 * `resource_state` table. SQLite has no JSONB type, so state is JSON stored as
 * TEXT: `JSON.stringify` on write, `JSON.parse` on read. Defined locally so
 * store-sqlite keeps a type-only dependency on the server package.
 *
 * Concurrency is compare-and-swap, not last-write-wins: each row carries a
 * monotonic `version` and a `lifecycle`, deletes tombstone rather than remove,
 * and tombstones are retained. See `ResourceStateStore` for the semantics all
 * four adapters share.
 *
 * The CAS itself is a single conditional statement — the write predicates on
 * the current version and lifecycle in its `WHERE` clause, so the compare and
 * the swap are one atomic operation under SQLite's row locking. `changes === 0`
 * means the predicate did not match, which is the conflict signal; the current
 * row is then re-read to report it.
 */
import type Database from "better-sqlite3";
import type { JsonObject } from "@flow-state-dev/core/types";
import type {
  ResourceStateStore,
  ContentScopeType,
  ExpectedVersion,
  SetResult,
  VersionedResourceState
} from "@flow-state-dev/engine";

/** A row as stored, before lifecycle filtering. */
type StoredRow = { state: string; version: number; lifecycle: string };

/**
 * Create a SQLite-backed `ResourceStateStore` over the provided database
 * handle.
 */
export function createSQLiteResourceStateStore(
  db: Database.Database
): ResourceStateStore {
  const getRowStmt = db.prepare(
    "SELECT state, version, lifecycle FROM resource_state " +
      "WHERE scope_type = ? AND scope_id = ? AND resource_key = ?"
  );
  // Insert only when no row exists at all. Losing this race is a terminal
  // already-exists, never a retry-overwrite — the PK does the arbitration.
  const insertStmt = db.prepare(
    "INSERT INTO resource_state (scope_type, scope_id, resource_key, state, version, lifecycle) " +
      "VALUES (?, ?, ?, ?, ?, 'live') " +
      "ON CONFLICT (scope_type, scope_id, resource_key) DO NOTHING"
  );
  // Conditional update: the predicate is the compare, the SET is the swap.
  const updateIfVersionStmt = db.prepare(
    "UPDATE resource_state SET state = ?, version = ?, lifecycle = 'live' " +
      "WHERE scope_type = ? AND scope_id = ? AND resource_key = ? " +
      "AND version = ? AND lifecycle = 'live'"
  );
  // Recreate over a tombstone: only when the row is NOT live.
  const reviveIfDeletedStmt = db.prepare(
    "UPDATE resource_state SET state = ?, version = ?, lifecycle = 'live' " +
      "WHERE scope_type = ? AND scope_id = ? AND resource_key = ? AND lifecycle != 'live'"
  );
  // Unconditional write for the `"any"` opt-out.
  const upsertStmt = db.prepare(
    "INSERT INTO resource_state (scope_type, scope_id, resource_key, state, version, lifecycle) " +
      "VALUES (?, ?, ?, ?, ?, 'live') " +
      "ON CONFLICT (scope_type, scope_id, resource_key) DO UPDATE SET " +
      "state = excluded.state, version = excluded.version, lifecycle = 'live'"
  );
  // Tombstone: retain the version, drop the payload. `-1` is the "any"
  // sentinel, safe because a real version is always >= 1.
  const tombstoneIfVersionStmt = db.prepare(
    "UPDATE resource_state SET state = '{}', lifecycle = 'deleted' " +
      "WHERE scope_type = ? AND scope_id = ? AND resource_key = ? " +
      "AND lifecycle = 'live' AND (? = -1 OR version = ?)"
  );
  const getAllStmt = db.prepare(
    "SELECT resource_key, state, version FROM resource_state " +
      "WHERE scope_type = ? AND scope_id = ? AND lifecycle = 'live'"
  );
  // Prefix match via substr(...) rather than LIKE — sidesteps LIKE wildcard
  // escaping (`%`/`_` are legal in resource keys). An empty prefix matches
  // every key in scope (substr(key, 1, 0) = '').
  const getByPrefixStmt = db.prepare(
    "SELECT resource_key, state, version FROM resource_state " +
      "WHERE scope_type = ? AND scope_id = ? AND lifecycle = 'live' " +
      "AND substr(resource_key, 1, length(?)) = ?"
  );
  // Scope purge: one bulk lifecycle mark, retaining every version. Not a
  // DELETE — the retained versions are what stop a straggler from the previous
  // generation matching a row in the next one.
  const deleteAllStmt = db.prepare(
    "UPDATE resource_state SET state = '{}', lifecycle = 'deleted' " +
      "WHERE scope_type = ? AND scope_id = ? AND lifecycle = 'live'"
  );

  const readRow = (
    scopeType: ContentScopeType,
    scopeId: string,
    resourceKey: string
  ): StoredRow | undefined =>
    getRowStmt.get(scopeType, scopeId, resourceKey) as StoredRow | undefined;

  /** Build the conflict result from whatever is stored right now. */
  const conflictFrom = (row: StoredRow | undefined): SetResult<JsonObject> => ({
    ok: false,
    conflict: {
      currentValue:
        row !== undefined && row.lifecycle === "live"
          ? (JSON.parse(row.state) as JsonObject)
          : undefined,
      currentVersion: row?.version ?? 0
    }
  });

  return {
    async get(
      scopeType: ContentScopeType,
      scopeId: string,
      resourceKey: string
    ): Promise<VersionedResourceState | undefined> {
      const row = readRow(scopeType, scopeId, resourceKey);
      if (row === undefined || row.lifecycle !== "live") return undefined;
      return { state: JSON.parse(row.state) as JsonObject, version: row.version };
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
        const current = readRow(scopeType, scopeId, resourceKey);
        const nextVersion = (current?.version ?? 0) + 1;
        upsertStmt.run(scopeType, scopeId, resourceKey, payload, nextVersion);
        return { ok: true, version: nextVersion };
      }

      if (expectedVersion === 0) {
        // No row at all: a plain insert at version 1. `DO NOTHING` makes a
        // lost race report zero changes rather than overwriting the winner.
        const inserted = insertStmt.run(scopeType, scopeId, resourceKey, payload, 1);
        if (inserted.changes > 0) return { ok: true, version: 1 };

        // A row exists. Recreating over a tombstone continues from its
        // version, so a version is never reused; a live row is a conflict.
        const current = readRow(scopeType, scopeId, resourceKey);
        if (current === undefined || current.lifecycle === "live") {
          return conflictFrom(current);
        }
        const nextVersion = current.version + 1;
        const revived = reviveIfDeletedStmt.run(
          payload,
          nextVersion,
          scopeType,
          scopeId,
          resourceKey
        );
        if (revived.changes === 0) {
          return conflictFrom(readRow(scopeType, scopeId, resourceKey));
        }
        return { ok: true, version: nextVersion };
      }

      const nextVersion = expectedVersion + 1;
      const updated = updateIfVersionStmt.run(
        payload,
        nextVersion,
        scopeType,
        scopeId,
        resourceKey,
        expectedVersion
      );
      if (updated.changes === 0) {
        return conflictFrom(readRow(scopeType, scopeId, resourceKey));
      }
      return { ok: true, version: nextVersion };
    },

    async delete(
      scopeType: ContentScopeType,
      scopeId: string,
      resourceKey: string,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<JsonObject>> {
      const current = readRow(scopeType, scopeId, resourceKey);
      // Nothing live to remove: idempotent, and no tombstone is minted for a
      // key that never existed — there is no observer to fence.
      if (current === undefined) return { ok: true, version: 0 };
      if (current.lifecycle !== "live") return { ok: true, version: current.version };

      const guard = expectedVersion === "any" ? -1 : expectedVersion;
      const marked = tombstoneIfVersionStmt.run(
        scopeType,
        scopeId,
        resourceKey,
        guard,
        guard
      );
      if (marked.changes === 0) {
        return conflictFrom(readRow(scopeType, scopeId, resourceKey));
      }
      return { ok: true, version: current.version };
    },

    async getAll(
      scopeType: ContentScopeType,
      scopeId: string
    ): Promise<Record<string, VersionedResourceState>> {
      const rows = getAllStmt.all(scopeType, scopeId) as Array<{
        resource_key: string;
        state: string;
        version: number;
      }>;
      const result: Record<string, VersionedResourceState> = {};
      for (const row of rows) {
        result[row.resource_key] = {
          state: JSON.parse(row.state) as JsonObject,
          version: row.version
        };
      }
      return result;
    },

    async getByPrefix(
      scopeType: ContentScopeType,
      scopeId: string,
      keyPrefix: string
    ): Promise<Record<string, VersionedResourceState>> {
      const rows = getByPrefixStmt.all(
        scopeType,
        scopeId,
        keyPrefix,
        keyPrefix
      ) as Array<{ resource_key: string; state: string; version: number }>;
      const result: Record<string, VersionedResourceState> = {};
      for (const row of rows) {
        result[row.resource_key] = {
          state: JSON.parse(row.state) as JsonObject,
          version: row.version
        };
      }
      return result;
    },

    async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
      deleteAllStmt.run(scopeType, scopeId);
    }
  };
}
