/**
 * In-memory content store for the SQLite adapter package.
 *
 * Defined locally so store-sqlite only uses type-only references to
 * the server package. A SQLite-backed ContentStore can replace this
 * in a future iteration.
 */
import type { ContentStore, ContentScopeType } from "@flow-state-dev/server";
import { pageEntries } from "./page-entries";

export class InMemoryContentStore implements ContentStore {
  private readonly data = new Map<string, string>();

  private key(scopeType: ContentScopeType, scopeId: string, resourceKey: string): string {
    return `${scopeType}:${scopeId}:${resourceKey}`;
  }

  private prefix(scopeType: ContentScopeType, scopeId: string): string {
    return `${scopeType}:${scopeId}:`;
  }

  async get(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<string | undefined> {
    return this.data.get(this.key(scopeType, scopeId, resourceKey));
  }

  async set(scopeType: ContentScopeType, scopeId: string, resourceKey: string, content: string): Promise<void> {
    this.data.set(this.key(scopeType, scopeId, resourceKey), content);
  }

  async delete(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<void> {
    this.data.delete(this.key(scopeType, scopeId, resourceKey));
  }

  async getAll(scopeType: ContentScopeType, scopeId: string): Promise<Record<string, string>> {
    return this.getByPrefix(scopeType, scopeId, "");
  }

  async getByPrefix(
    scopeType: ContentScopeType,
    scopeId: string,
    keyPrefix: string
  ): Promise<Record<string, string>> {
    const prefix = this.prefix(scopeType, scopeId);
    const result: Record<string, string> = {};
    for (const [key, value] of this.data) {
      if (!key.startsWith(prefix)) continue;
      const resourceKey = key.slice(prefix.length);
      if (resourceKey.startsWith(keyPrefix)) {
        result[resourceKey] = value;
      }
    }
    return result;
  }

  async getByPrefixPaged(
    scopeType: ContentScopeType,
    scopeId: string,
    keyPrefix: string,
    opts: { limit: number; after?: string; order?: "asc" | "desc" }
  ): Promise<{ items: Array<{ key: string; value: string }>; nextCursor?: string }> {
    const prefix = this.prefix(scopeType, scopeId);
    const matches: Array<{ key: string; value: string }> = [];
    for (const [key, value] of this.data) {
      if (!key.startsWith(prefix)) continue;
      const resourceKey = key.slice(prefix.length);
      if (resourceKey.startsWith(keyPrefix)) {
        matches.push({ key: resourceKey, value });
      }
    }
    return pageEntries(matches, opts);
  }

  async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
    const prefix = this.prefix(scopeType, scopeId);
    for (const key of this.data.keys()) {
      if (key.startsWith(prefix)) {
        this.data.delete(key);
      }
    }
  }
}
