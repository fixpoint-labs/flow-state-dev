/**
 * In-memory resource state store implementation.
 *
 * Resource state (single-resource and collection-instance alike) is held in
 * nested maps — `scopeType → scopeId → resourceKey` — so a bucket is addressed
 * by **exact** `(scopeType, scopeId)` identity and prefix matching applies only
 * to the resource key inside it. Suitable for development, testing, and
 * single-process deployments where state need not survive process restarts.
 *
 * It used to be one flat map keyed `scopeType:scopeId:resourceKey`, scanned by
 * string prefix. Concatenating three caller-supplied strings and re-splitting
 * them by position is ambiguous, and FIX-1323 makes the ambiguity reachable:
 * instance ids are now part of the `scopeId`, so scope `user:reviewer-a` and
 * scope `user:reviewer-a:b` share a string prefix — one copy's `getAll`,
 * `deleteAll` or `purgeTombstones` would have listed, tombstoned or purged the
 * other's rows. Nesting removes the encoding rather than escaping it.
 *
 * Unlike the in-memory `ContentStore` this is a compare-and-swap store: each
 * row carries a monotonic version and a lifecycle, deletes tombstone rather
 * than remove, and tombstones are retained indefinitely. See
 * {@link ResourceStateStore} for the semantics every adapter shares. JS
 * single-threaded execution gives the compare-and-set its atomicity here —
 * there is no await between the read and the write.
 *
 * Every crossing of the store boundary is deep-copied via `cloneValue`, in both
 * directions. This adapter is the only one that keeps the caller's object graph
 * alive between calls — the other three serialize (filesystem writes JSON, both
 * SQL adapters stringify on write and parse per read), so they get this for
 * free. Without the copies a caller could mutate a stored row through what
 * `get` returned or through the reference it passed to `set`, changing the
 * value while the version stood still. That is precisely the failure this
 * store exists to prevent: the version has to witness the value, or a later
 * CAS write at the old version commits against data that already moved.
 */
import { cloneValue } from "@flow-state-dev/core/helpers";
import type { JsonObject } from "@flow-state-dev/core/types";
import type {
  ContentScopeType,
  ExpectedVersion,
  ResourceStateStore,
  SetResult,
  VersionedResourceState
} from "../types";
import {
  assertDeleteExpectedVersion,
  assertSetExpectedVersion,
  checkWriteVersion,
  type ResourceStateRow
} from "../resource-state-predicate";

export class InMemoryResourceStateStore implements ResourceStateStore {
  /** `scopeType → scopeId → resourceKey → row`. Exact bucket identity. */
  private readonly data = new Map<
    ContentScopeType,
    Map<string, Map<string, ResourceStateRow>>
  >();

  /** The bucket for one exact scope, or `undefined` when nothing is stored there. */
  private bucket(
    scopeType: ContentScopeType,
    scopeId: string
  ): Map<string, ResourceStateRow> | undefined {
    return this.data.get(scopeType)?.get(scopeId);
  }

  /**
   * Drop a bucket that has no rows left, so a process that keeps minting scope
   * ids (a recreated session id purging its tombstones, FIX-1323 review) does
   * not retain one unreachable `Map` per id — retention the flat map it
   * replaced did not have. The `scopeType` parent is deliberately kept: it is a
   * closed three-value union, so it is bounded whatever happens.
   */
  private dropBucketIfEmpty(scopeType: ContentScopeType, scopeId: string): void {
    const byScopeId = this.data.get(scopeType);
    if (byScopeId?.get(scopeId)?.size === 0) byScopeId.delete(scopeId);
  }

  /** The bucket for one exact scope, created empty if it does not exist yet. */
  private ensureBucket(
    scopeType: ContentScopeType,
    scopeId: string
  ): Map<string, ResourceStateRow> {
    let byScopeId = this.data.get(scopeType);
    if (byScopeId === undefined) {
      byScopeId = new Map();
      this.data.set(scopeType, byScopeId);
    }
    let bucket = byScopeId.get(scopeId);
    if (bucket === undefined) {
      bucket = new Map();
      byScopeId.set(scopeId, bucket);
    }
    return bucket;
  }

  async get(
    scopeType: ContentScopeType,
    scopeId: string,
    resourceKey: string
  ): Promise<VersionedResourceState | undefined> {
    const row = this.bucket(scopeType, scopeId)?.get(resourceKey);
    if (row === undefined || row.lifecycle !== "live") return undefined;
    return { state: cloneValue(row.state), version: row.version };
  }

  async set(
    scopeType: ContentScopeType,
    scopeId: string,
    resourceKey: string,
    state: JsonObject,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<JsonObject>> {
    assertSetExpectedVersion(expectedVersion);
    const bucket = this.ensureBucket(scopeType, scopeId);
    const row = bucket.get(resourceKey);
    const check = checkWriteVersion(row, expectedVersion);
    if (check !== undefined) return check;

    // A recreate continues from the tombstone's version, so a version is
    // never reused for a key that has been deleted and written again.
    const nextVersion = (row?.version ?? 0) + 1;
    bucket.set(resourceKey, { state: cloneValue(state), version: nextVersion, lifecycle: "live" });
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
    assertDeleteExpectedVersion(expectedVersion);
    const bucket = this.bucket(scopeType, scopeId);
    const row = bucket?.get(resourceKey);

    // Nothing live to remove: idempotent success, and no tombstone is minted
    // for a key that never existed (there is no observer to fence). An absent
    // bucket is that same case — no row has ever been written at this scope.
    if (bucket === undefined || row === undefined) return { ok: true, version: 0 };
    if (row.lifecycle !== "live") return { ok: true, version: row.version };

    const check = checkWriteVersion(row, expectedVersion);
    if (check !== undefined) return check;

    // Retain the version, drop the payload — the version is the only thing a
    // tombstone has to carry, and it is retained indefinitely.
    bucket.set(resourceKey, { state: {}, version: row.version, lifecycle: "deleted" });
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
    const result: Record<string, VersionedResourceState> = {};
    const bucket = this.bucket(scopeType, scopeId);
    if (bucket === undefined) return result;
    for (const [resourceKey, row] of bucket) {
      if (row.lifecycle !== "live") continue;
      if (resourceKey.startsWith(keyPrefix)) {
        result[resourceKey] = { state: cloneValue(row.state), version: row.version };
      }
    }
    return result;
  }

  async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
    const bucket = this.bucket(scopeType, scopeId);
    if (bucket === undefined) return;
    for (const [resourceKey, row] of bucket) {
      if (row.lifecycle !== "live") continue;
      bucket.set(resourceKey, { state: {}, version: row.version, lifecycle: "deleted" });
    }
  }

  async purgeTombstones(scopeType: ContentScopeType, scopeId: string): Promise<void> {
    // Tombstones only — the mirror of `deleteAll`'s `lifecycle !== "live"`
    // skip, and the reason live rows written before the scope record existed
    // survive a re-create. Deleting entries while iterating a `Map` is
    // defined: the iterator visits each remaining key once and never revisits
    // a removed one.
    const bucket = this.bucket(scopeType, scopeId);
    if (bucket === undefined) return;
    for (const [resourceKey, row] of bucket) {
      if (row.lifecycle === "live") continue;
      bucket.delete(resourceKey);
    }
    this.dropBucketIfEmpty(scopeType, scopeId);
  }
}

export function createInMemoryResourceStateStore(): ResourceStateStore {
  return new InMemoryResourceStateStore();
}
