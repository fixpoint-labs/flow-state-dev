/**
 * SQLite-backed content store for the SQLite adapter package.
 *
 * Resource content is addressed by (scope_type, scope_id, resource_key) and
 * stored durably in the `resource_content` table, parallel to the Postgres
 * adapter. Reads are scoped via the `(scope_type, scope_id)` index — never a
 * process-wide scan. Defined locally so store-sqlite keeps a type-only
 * dependency on the server package.
 */
import type Database from "better-sqlite3";
import type { ContentStore, ContentScopeType } from "@flow-state-dev/engine";

/**
 * Create a SQLite-backed `ContentStore` over the provided database handle.
 * Last-write-wins per key (no CAS/versioning), matching the interface
 * contract and the Postgres reference.
 */
export function createSQLiteContentStore(db: Database.Database): ContentStore {
  const getStmt = db.prepare(
    "SELECT content FROM resource_content WHERE scope_type = ? AND scope_id = ? AND resource_key = ?"
  );
  const setStmt = db.prepare(
    "INSERT INTO resource_content (scope_type, scope_id, resource_key, content) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT (scope_type, scope_id, resource_key) DO UPDATE SET content = excluded.content"
  );
  const deleteStmt = db.prepare(
    "DELETE FROM resource_content WHERE scope_type = ? AND scope_id = ? AND resource_key = ?"
  );
  const getAllStmt = db.prepare(
    "SELECT resource_key, content FROM resource_content WHERE scope_type = ? AND scope_id = ?"
  );
  // Prefix match via substr(...) rather than LIKE — sidesteps LIKE wildcard
  // escaping (`%`/`_` are legal in resource keys). An empty prefix matches
  // every key in scope (substr(key, 1, 0) = '').
  const getByPrefixStmt = db.prepare(
    "SELECT resource_key, content FROM resource_content " +
      "WHERE scope_type = ? AND scope_id = ? AND substr(resource_key, 1, length(?)) = ?"
  );
  const deleteAllStmt = db.prepare(
    "DELETE FROM resource_content WHERE scope_type = ? AND scope_id = ?"
  );

  return {
    async get(
      scopeType: ContentScopeType,
      scopeId: string,
      resourceKey: string
    ): Promise<string | undefined> {
      const row = getStmt.get(scopeType, scopeId, resourceKey) as
        | { content: string }
        | undefined;
      return row?.content;
    },

    async set(
      scopeType: ContentScopeType,
      scopeId: string,
      resourceKey: string,
      content: string
    ): Promise<void> {
      setStmt.run(scopeType, scopeId, resourceKey, content);
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
    ): Promise<Record<string, string>> {
      const rows = getAllStmt.all(scopeType, scopeId) as Array<{
        resource_key: string;
        content: string;
      }>;
      const result: Record<string, string> = {};
      for (const row of rows) result[row.resource_key] = row.content;
      return result;
    },

    async getByPrefix(
      scopeType: ContentScopeType,
      scopeId: string,
      keyPrefix: string
    ): Promise<Record<string, string>> {
      const rows = getByPrefixStmt.all(
        scopeType,
        scopeId,
        keyPrefix,
        keyPrefix
      ) as Array<{ resource_key: string; content: string }>;
      const result: Record<string, string> = {};
      for (const row of rows) result[row.resource_key] = row.content;
      return result;
    },

    async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
      deleteAllStmt.run(scopeType, scopeId);
    }
  };
}
