/**
 * In-memory resource state store implementation.
 *
 * Stores resource state (single-resource and collection-instance alike) in a
 * flat Map keyed by `scopeType:scopeId:resourceKey`. The state-layer twin of
 * the in-memory ContentStore. Suitable for development, testing, and
 * single-process deployments where state need not survive process restarts.
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import type { ContentScopeType, ResourceStateStore } from "../types";

export class InMemoryResourceStateStore implements ResourceStateStore {
  private readonly data = new Map<string, JsonObject>();

  private key(scopeType: ContentScopeType, scopeId: string, resourceKey: string): string {
    return `${scopeType}:${scopeId}:${resourceKey}`;
  }

  private prefix(scopeType: ContentScopeType, scopeId: string): string {
    return `${scopeType}:${scopeId}:`;
  }

  async get(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<JsonObject | undefined> {
    return this.data.get(this.key(scopeType, scopeId, resourceKey));
  }

  async set(scopeType: ContentScopeType, scopeId: string, resourceKey: string, state: JsonObject): Promise<void> {
    this.data.set(this.key(scopeType, scopeId, resourceKey), state);
  }

  async delete(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<void> {
    this.data.delete(this.key(scopeType, scopeId, resourceKey));
  }

  async getAll(scopeType: ContentScopeType, scopeId: string): Promise<Record<string, JsonObject>> {
    return this.getByPrefix(scopeType, scopeId, "");
  }

  async getByPrefix(
    scopeType: ContentScopeType,
    scopeId: string,
    keyPrefix: string
  ): Promise<Record<string, JsonObject>> {
    const prefix = this.prefix(scopeType, scopeId);
    const result: Record<string, JsonObject> = {};
    for (const [key, value] of this.data) {
      if (!key.startsWith(prefix)) continue;
      const resourceKey = key.slice(prefix.length);
      if (resourceKey.startsWith(keyPrefix)) {
        result[resourceKey] = value;
      }
    }
    return result;
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

export function createInMemoryResourceStateStore(): ResourceStateStore {
  return new InMemoryResourceStateStore();
}
