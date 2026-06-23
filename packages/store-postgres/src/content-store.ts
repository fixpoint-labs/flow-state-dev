/**
 * PostgreSQL-backed content store.
 *
 * Stores resource content addressed by (scope_type, scope_id, resource_key).
 * Content is stored as TEXT in a dedicated table, separate from scope record JSONB.
 */

import type { ContentStore, ContentScopeType } from "@flow-state-dev/engine";
import type { QueryExecutor } from "./types";

export function createPostgresContentStore(executor: QueryExecutor): ContentStore {
  return {
    async get(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<string | undefined> {
      const result = await executor.query(
        "SELECT content FROM resource_content WHERE scope_type = $1 AND scope_id = $2 AND resource_key = $3",
        [scopeType, scopeId, resourceKey]
      );
      return result.rows[0]?.content as string | undefined;
    },

    async set(scopeType: ContentScopeType, scopeId: string, resourceKey: string, content: string): Promise<void> {
      await executor.query(
        `INSERT INTO resource_content (scope_type, scope_id, resource_key, content)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (scope_type, scope_id, resource_key) DO UPDATE SET content = EXCLUDED.content`,
        [scopeType, scopeId, resourceKey, content]
      );
    },

    async delete(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<void> {
      await executor.query(
        "DELETE FROM resource_content WHERE scope_type = $1 AND scope_id = $2 AND resource_key = $3",
        [scopeType, scopeId, resourceKey]
      );
    },

    async getAll(scopeType: ContentScopeType, scopeId: string): Promise<Record<string, string>> {
      const result = await executor.query(
        "SELECT resource_key, content FROM resource_content WHERE scope_type = $1 AND scope_id = $2",
        [scopeType, scopeId]
      );
      const entries: Record<string, string> = {};
      for (const row of result.rows) {
        entries[row.resource_key as string] = row.content as string;
      }
      return entries;
    },

    async getByPrefix(
      scopeType: ContentScopeType,
      scopeId: string,
      keyPrefix: string
    ): Promise<Record<string, string>> {
      // Prefix match via LEFT(...) = prefix rather than LIKE — sidesteps
      // LIKE wildcard escaping (`%`/`_` are legal in resource keys). An
      // empty prefix matches every key (LEFT(key, 0) = '').
      const result = await executor.query(
        "SELECT resource_key, content FROM resource_content " +
          "WHERE scope_type = $1 AND scope_id = $2 AND LEFT(resource_key, char_length($3)) = $3",
        [scopeType, scopeId, keyPrefix]
      );
      const entries: Record<string, string> = {};
      for (const row of result.rows) {
        entries[row.resource_key as string] = row.content as string;
      }
      return entries;
    },

    async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
      await executor.query(
        "DELETE FROM resource_content WHERE scope_type = $1 AND scope_id = $2",
        [scopeType, scopeId]
      );
    }
  };
}
