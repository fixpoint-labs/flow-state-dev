/**
 * SQLite-backed resource state store for the SQLite adapter package.
 *
 * The state-layer twin of the SQLite content store (FIX-689 created the
 * `ResourceStateStore` abstraction and punted the durable SQLite table to
 * FIX-687). State — single-resource and collection-instance alike — is
 * addressed by (scope_type, scope_id, resource_key) and stored durably in the
 * `resource_state` table. SQLite has no JSONB type, so state is JSON stored as
 * TEXT: `JSON.stringify` on write, `JSON.parse` on read. Defined locally so
 * store-sqlite keeps a type-only dependency on the server package.
 */
import type Database from "better-sqlite3";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { ResourceStateStore, ContentScopeType } from "@flow-state-dev/server";

/**
 * Create a SQLite-backed `ResourceStateStore` over the provided database
 * handle. Last-write-wins per key (no CAS/versioning), matching the interface
 * contract and the Postgres reference.
 */
export function createSQLiteResourceStateStore(
  db: Database.Database
): ResourceStateStore {
  const getStmt = db.prepare(
    "SELECT state FROM resource_state WHERE scope_type = ? AND scope_id = ? AND resource_key = ?"
  );
  const setStmt = db.prepare(
    "INSERT INTO resource_state (scope_type, scope_id, resource_key, state) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT (scope_type, scope_id, resource_key) DO UPDATE SET state = excluded.state"
  );
  const deleteStmt = db.prepare(
    "DELETE FROM resource_state WHERE scope_type = ? AND scope_id = ? AND resource_key = ?"
  );
  const getAllStmt = db.prepare(
    "SELECT resource_key, state FROM resource_state WHERE scope_type = ? AND scope_id = ?"
  );
  // Prefix match via substr(...) rather than LIKE — sidesteps LIKE wildcard
  // escaping (`%`/`_` are legal in resource keys). An empty prefix matches
  // every key in scope (substr(key, 1, 0) = '').
  const getByPrefixStmt = db.prepare(
    "SELECT resource_key, state FROM resource_state " +
      "WHERE scope_type = ? AND scope_id = ? AND substr(resource_key, 1, length(?)) = ?"
  );
  const deleteAllStmt = db.prepare(
    "DELETE FROM resource_state WHERE scope_type = ? AND scope_id = ?"
  );

  return {
    async get(
      scopeType: ContentScopeType,
      scopeId: string,
      resourceKey: string
    ): Promise<JsonObject | undefined> {
      const row = getStmt.get(scopeType, scopeId, resourceKey) as
        | { state: string }
        | undefined;
      return row === undefined ? undefined : (JSON.parse(row.state) as JsonObject);
    },

    async set(
      scopeType: ContentScopeType,
      scopeId: string,
      resourceKey: string,
      state: JsonObject
    ): Promise<void> {
      setStmt.run(scopeType, scopeId, resourceKey, JSON.stringify(state));
    },

    async delete(
      scopeType: ContentScopeType,
      scopeId: string,
      resourceKey: string
    ): Promise<void> {
      deleteStmt.run(scopeType, scopeId, resourceKey);
    },

    async getAll(
      scopeType: ContentScopeType,
      scopeId: string
    ): Promise<Record<string, JsonObject>> {
      const rows = getAllStmt.all(scopeType, scopeId) as Array<{
        resource_key: string;
        state: string;
      }>;
      const result: Record<string, JsonObject> = {};
      for (const row of rows) result[row.resource_key] = JSON.parse(row.state) as JsonObject;
      return result;
    },

    async getByPrefix(
      scopeType: ContentScopeType,
      scopeId: string,
      keyPrefix: string
    ): Promise<Record<string, JsonObject>> {
      const rows = getByPrefixStmt.all(
        scopeType,
        scopeId,
        keyPrefix,
        keyPrefix
      ) as Array<{ resource_key: string; state: string }>;
      const result: Record<string, JsonObject> = {};
      for (const row of rows) result[row.resource_key] = JSON.parse(row.state) as JsonObject;
      return result;
    },

    async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
      deleteAllStmt.run(scopeType, scopeId);
    }
  };
}
