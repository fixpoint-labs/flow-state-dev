/**
 * PostgreSQL-backed resource state store.
 *
 * Stores resource state (single-resource and collection-instance alike)
 * addressed by (scope_type, scope_id, resource_key). State is stored as JSONB
 * in a dedicated `resource_state` table, parallel to `resource_content` and
 * separate from the scope record JSONB.
 */

import type { JsonObject } from "@flow-state-dev/core/types";
import type { ResourceStateStore, ContentScopeType } from "@flow-state-dev/server";
import type { QueryExecutor } from "./types";

export function createPostgresResourceStateStore(executor: QueryExecutor): ResourceStateStore {
  return {
    async get(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<JsonObject | undefined> {
      const result = await executor.query(
        "SELECT state FROM resource_state WHERE scope_type = $1 AND scope_id = $2 AND resource_key = $3",
        [scopeType, scopeId, resourceKey]
      );
      return result.rows[0]?.state as JsonObject | undefined;
    },

    async set(scopeType: ContentScopeType, scopeId: string, resourceKey: string, state: JsonObject): Promise<void> {
      await executor.query(
        `INSERT INTO resource_state (scope_type, scope_id, resource_key, state)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (scope_type, scope_id, resource_key) DO UPDATE SET state = EXCLUDED.state`,
        [scopeType, scopeId, resourceKey, JSON.stringify(state)]
      );
    },

    async delete(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<void> {
      await executor.query(
        "DELETE FROM resource_state WHERE scope_type = $1 AND scope_id = $2 AND resource_key = $3",
        [scopeType, scopeId, resourceKey]
      );
    },

    async getAll(scopeType: ContentScopeType, scopeId: string): Promise<Record<string, JsonObject>> {
      const result = await executor.query(
        "SELECT resource_key, state FROM resource_state WHERE scope_type = $1 AND scope_id = $2",
        [scopeType, scopeId]
      );
      const entries: Record<string, JsonObject> = {};
      for (const row of result.rows) {
        entries[row.resource_key as string] = row.state as JsonObject;
      }
      return entries;
    },

    async getByPrefix(
      scopeType: ContentScopeType,
      scopeId: string,
      keyPrefix: string
    ): Promise<Record<string, JsonObject>> {
      // Prefix match via LEFT(...) = prefix rather than LIKE — sidesteps
      // LIKE wildcard escaping (`%`/`_` are legal in resource keys). An
      // empty prefix matches every key (LEFT(key, 0) = '').
      const result = await executor.query(
        "SELECT resource_key, state FROM resource_state " +
          "WHERE scope_type = $1 AND scope_id = $2 AND LEFT(resource_key, char_length($3)) = $3",
        [scopeType, scopeId, keyPrefix]
      );
      const entries: Record<string, JsonObject> = {};
      for (const row of result.rows) {
        entries[row.resource_key as string] = row.state as JsonObject;
      }
      return entries;
    },

    async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
      await executor.query(
        "DELETE FROM resource_state WHERE scope_type = $1 AND scope_id = $2",
        [scopeType, scopeId]
      );
    }
  };
}
