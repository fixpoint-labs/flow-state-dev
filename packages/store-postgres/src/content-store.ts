/**
 * PostgreSQL-backed content store.
 *
 * Stores resource content addressed by (scope_type, scope_id, resource_key).
 * Content is stored as TEXT in a dedicated table, separate from scope record JSONB.
 */

import type { ContentStore, ContentScopeType } from "@flow-state-dev/server";
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

    async getByPrefixPaged(
      scopeType: ContentScopeType,
      scopeId: string,
      keyPrefix: string,
      opts: { limit: number; after?: string; order?: "asc" | "desc" }
    ): Promise<{ items: Array<{ key: string; value: string }>; nextCursor?: string }> {
      // Indexed keyset read: the same `LEFT(resource_key, char_length($3)) = $3`
      // prefix predicate as getByPrefix, plus an exclusive keyset bound on
      // resource_key and an explicit order. `after` is omitted on the first
      // page, so the bound predicate is dropped entirely.
      const order = opts.order ?? "asc";
      const params: unknown[] = [scopeType, scopeId, keyPrefix];
      let boundClause = "";
      if (opts.after !== undefined) {
        params.push(opts.after);
        boundClause = ` AND resource_key ${order === "asc" ? ">" : "<"} $${params.length}`;
      }
      params.push(Math.max(0, opts.limit));
      const limitParam = params.length;
      const result = await executor.query(
        "SELECT resource_key, content FROM resource_content " +
          "WHERE scope_type = $1 AND scope_id = $2 AND LEFT(resource_key, char_length($3)) = $3" +
          boundClause +
          ` ORDER BY resource_key ${order === "asc" ? "ASC" : "DESC"} LIMIT $${limitParam}`,
        params
      );
      const items = result.rows.map((row) => ({
        key: row.resource_key as string,
        value: row.content as string
      }));
      // Uniform keyset rule across all adapters: a full page (rows === limit)
      // implies there may be more; a short/empty page signals the end.
      const nextCursor =
        items.length === opts.limit && opts.limit > 0
          ? items[items.length - 1]!.key
          : undefined;
      return { items, nextCursor };
    },

    async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
      await executor.query(
        "DELETE FROM resource_content WHERE scope_type = $1 AND scope_id = $2",
        [scopeType, scopeId]
      );
    }
  };
}
