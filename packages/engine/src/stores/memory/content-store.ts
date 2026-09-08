/**
 * In-memory content store implementation.
 *
 * Content is held in nested maps — `scopeType → scopeId → resourceKey` — so a
 * bucket is addressed by **exact** `(scopeType, scopeId)` identity and prefix
 * matching applies only to the resource key inside it. Suitable for
 * development, testing, and single-process deployments where content does not
 * need to survive process restarts.
 *
 * It used to be one flat map keyed `scopeType:scopeId:resourceKey`, scanned by
 * string prefix. Concatenating three caller-supplied strings and then
 * re-splitting them by position is ambiguous, and FIX-1323 makes the ambiguity
 * reachable: instance ids are now part of the `scopeId`, so a scope
 * `user:reviewer-a` and a scope `user:reviewer-a:b` share a string prefix. A
 * `getAll` / `deleteAll` / `getByPrefix` on the first would have listed and
 * deleted the second's rows. Nesting removes the encoding rather than escaping
 * it — there is no key to parse, so nothing can be parsed wrong.
 */
import type { ContentScopeType, ContentStore } from "../types";

export class InMemoryContentStore implements ContentStore {
  /** `scopeType → scopeId → resourceKey → content`. Exact bucket identity. */
  private readonly data = new Map<ContentScopeType, Map<string, Map<string, string>>>();

  /** The bucket for one exact scope, or `undefined` when nothing is stored there. */
  private bucket(
    scopeType: ContentScopeType,
    scopeId: string
  ): Map<string, string> | undefined {
    return this.data.get(scopeType)?.get(scopeId);
  }

  /** The bucket for one exact scope, created empty if it does not exist yet. */
  private ensureBucket(scopeType: ContentScopeType, scopeId: string): Map<string, string> {
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

  async get(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<string | undefined> {
    return this.bucket(scopeType, scopeId)?.get(resourceKey);
  }

  async set(scopeType: ContentScopeType, scopeId: string, resourceKey: string, content: string): Promise<void> {
    this.ensureBucket(scopeType, scopeId).set(resourceKey, content);
  }

  async delete(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<void> {
    const bucket = this.bucket(scopeType, scopeId);
    if (bucket === undefined) return;
    bucket.delete(resourceKey);
    // Drop the bucket once its last row goes, so a process that keeps minting
    // scope ids does not retain one unreachable `Map` per id — retention the
    // flat map this replaced did not have. `deleteAll` already drops the whole
    // bucket. The `scopeType` parent is kept: a closed three-value union is
    // bounded whatever happens.
    if (bucket.size === 0) this.data.get(scopeType)?.delete(scopeId);
  }

  async getAll(scopeType: ContentScopeType, scopeId: string): Promise<Record<string, string>> {
    return this.getByPrefix(scopeType, scopeId, "");
  }

  async getByPrefix(
    scopeType: ContentScopeType,
    scopeId: string,
    keyPrefix: string
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const bucket = this.bucket(scopeType, scopeId);
    if (bucket === undefined) return result;
    for (const [resourceKey, value] of bucket) {
      if (resourceKey.startsWith(keyPrefix)) {
        result[resourceKey] = value;
      }
    }
    return result;
  }

  async deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void> {
    this.data.get(scopeType)?.delete(scopeId);
  }
}

export function createInMemoryContentStore(): ContentStore {
  return new InMemoryContentStore();
}
