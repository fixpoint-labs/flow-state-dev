/**
 * In-memory resource state store implementation.
 *
 * Stores resource state (single-resource and collection-instance alike) in a
 * flat Map keyed by `scopeType:scopeId:resourceKey`. Suitable for development,
 * testing, and single-process deployments where state need not survive
 * process restarts.
 *
 * Unlike the in-memory `ContentStore` this is a compare-and-swap store: each
 * row carries a monotonic version and a lifecycle, deletes tombstone rather
 * than remove, and tombstones are retained indefinitely. See
 * {@link ResourceStateStore} for the semantics every adapter shares. JS
 * single-threaded execution gives the compare-and-set its atomicity here —
 * there is no await between the read and the write.
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import type {
  ContentScopeType,
  ExpectedVersion,
  ResourceStateStore,
  SetResult,
  VersionedResourceState
} from "../types";
import {
  assertExpectedVersion,
  checkWriteVersion,
  type ResourceStateRow
} from "../resource-state-predicate";

export class InMemoryResourceStateStore implements ResourceStateStore {
  private readonly data = new Map<string, ResourceStateRow>();

  private key(scopeType: ContentScopeType, scopeId: string, resourceKey: string): string {
    return `${scopeType}:${scopeId}:${resourceKey}`;
  }

  private prefix(scopeType: ContentScopeType, scopeId: string): string {
    return `${scopeType}:${scopeId}:`;
  }

  async get(
    scopeType: ContentScopeType,
    scopeId: string,
    resourceKey: string
  ): Promise<VersionedResourceState | undefined> {
    const row = this.data.get(this.key(scopeType, scopeId, resourceKey));
    if (row === undefined || row.lifecycle !== "live") return undefined;
    return { state: row.state, version: row.version };
  }

  async set(
    scopeType: ContentScopeType,
    scopeId: string,
    resourceKey: string,
    state: JsonObject,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<JsonObject>> {
    assertExpectedVersion(expectedVersion);
    const mapKey = this.key(scopeType, scopeId, resourceKey);
    const row = this.data.get(mapKey);
    const check = checkWriteVersion(row, expectedVersion);
    if (check !== undefined) return check;

    // A recreate continues from the tombstone's version, so a version is
    // never reused for a key that has been deleted and written again.
    const nextVersion = (row?.version ?? 0) + 1;
    this.data.set(mapKey, { state, version: nextVersion, lifecycle: "live" });
    return { ok: true, version: nextVersion };
  }

  async delete(
    scopeType: ContentScopeType,
    scopeId: string,
    resourceKey: string,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<JsonObject>> {
    // Ahead of the idempotent short-circuits below: an unusable
    // `expectedVersion` is refused for every key, live or not.
    assertExpectedVersion(expectedVersion);
    const mapKey = this.key(scopeType, scopeId, resourceKey);
    const row = this.data.get(mapKey);

    // Nothing live to remove: idempotent success, and no tombstone is minted
    // for a key that never existed (there is no observer to fence).
    if (row === undefined) return { ok: true, version: 0 };
    if (row.lifecycle !== "live") return { ok: true, version: row.version };

    const check = checkWriteVersion(row, expectedVersion);
    if (check !== undefined) return check;

    // Retain the version, drop the payload — the version is the only thing a
    // tombstone has to carry, and it is retained indefinitely.
    this.data.set(mapKey, { state: {}, version: row.version, lifecycle: "deleted" });
    return { ok: true, version: row.version };
  }

  async getAll(
    scopeType: ContentScopeType,
    scopeId: string
  ): Promise<Record<string, VersionedResourceState>> {
    return this.getByPrefix(scopeType, scopeId, "");
  }

  async getByPrefix(
    scopeType: ContentScopeType,
    scopeId: string,
    keyPrefix: string
  ): Promise<Record<string, VersionedResourceState>> {
    const prefix = this.prefix(scopeType, scopeId);
    const result: Record<string, VersionedResourceState> = {};
    for (const [key, row] of this.data) {
      if (!key.startsWith(prefix)) continue;
      if (row.lifecycle !== "live") continue;
      const resourceKey = key.slice(prefix.length);
      if (resourceKey.startsWith(keyPrefix)) {
        result[resourceKey] = { state: row.state, version: row.version };
      }
    }
    return result;
  }

  async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
    const prefix = this.prefix(scopeType, scopeId);
    for (const [key, row] of this.data) {
      if (!key.startsWith(prefix)) continue;
      if (row.lifecycle !== "live") continue;
      this.data.set(key, { state: {}, version: row.version, lifecycle: "deleted" });
    }
  }
}

export function createInMemoryResourceStateStore(): ResourceStateStore {
  return new InMemoryResourceStateStore();
}
