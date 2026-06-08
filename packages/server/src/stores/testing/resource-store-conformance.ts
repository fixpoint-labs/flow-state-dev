/**
 * Shared conformance suites for the two keyed resource stores — `ContentStore`
 * (string bodies) and `ResourceStateStore` (`JsonObject` state). Both have the
 * same `(scopeType, scopeId, resourceKey)` addressing and the same six methods,
 * so the cases live in one generic core and each public wrapper supplies a
 * value factory. Every concrete adapter — memory, filesystem, SQLite, Postgres
 * — runs these via `@flow-state-dev/server/testing`.
 *
 * These cases run against a single store instance; persistence-across-restart
 * is adapter-specific (close + reopen the backing file) and lives in each
 * adapter's own test file.
 */
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { ContentStore, ResourceStateStore, ContentScopeType } from "../types";

/** Structural shape shared by `ContentStore` and `ResourceStateStore`. */
type KeyedResourceStore<V> = {
  get(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<V | undefined>;
  set(scopeType: ContentScopeType, scopeId: string, resourceKey: string, value: V): Promise<void>;
  delete(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<void>;
  getAll(scopeType: ContentScopeType, scopeId: string): Promise<Record<string, V>>;
  getByPrefix(
    scopeType: ContentScopeType,
    scopeId: string,
    keyPrefix: string
  ): Promise<Record<string, V>>;
  deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void>;
};

type ConformanceOptions<V> = {
  /** Display name surfaced in the `describe` block. */
  name: string;
  /** Build a fresh store. Called per-test so cases run against an empty backend. */
  createStore: () => KeyedResourceStore<V> | Promise<KeyedResourceStore<V>>;
  /** Optional teardown hook for adapters with external resources. */
  cleanup?: (store: KeyedResourceStore<V>) => Promise<void> | void;
  /** Produce a distinct, comparable value for index `i`. */
  makeValue: (i: number) => V;
};

/** Register the generic keyed-resource-store conformance cases against a backend. */
function runKeyedResourceStoreConformance<V>(options: ConformanceOptions<V>): void {
  const { name, createStore, cleanup, makeValue } = options;

  describe(`${name} (keyed resource store conformance)`, () => {
    async function withStore(fn: (store: KeyedResourceStore<V>) => Promise<void>): Promise<void> {
      const store = await createStore();
      try {
        await fn(store);
      } finally {
        await cleanup?.(store);
      }
    }

    it("get returns undefined for a missing key", async () => {
      await withStore(async (store) => {
        expect(await store.get("session", "s1", "missing")).toBeUndefined();
      });
    });

    it("set then get round-trips the value", async () => {
      await withStore(async (store) => {
        const value = makeValue(1);
        await store.set("session", "s1", "k1", value);
        expect(await store.get("session", "s1", "k1")).toEqual(value);
      });
    });

    it("set on an existing key is last-write-wins", async () => {
      await withStore(async (store) => {
        await store.set("session", "s1", "k1", makeValue(1));
        const updated = makeValue(2);
        await store.set("session", "s1", "k1", updated);
        expect(await store.get("session", "s1", "k1")).toEqual(updated);
      });
    });

    it("delete removes a key", async () => {
      await withStore(async (store) => {
        await store.set("session", "s1", "k1", makeValue(1));
        await store.delete("session", "s1", "k1");
        expect(await store.get("session", "s1", "k1")).toBeUndefined();
      });
    });

    it("getAll returns every key in the scope", async () => {
      await withStore(async (store) => {
        await store.set("session", "s1", "a", makeValue(1));
        await store.set("session", "s1", "b", makeValue(2));
        const all = await store.getAll("session", "s1");
        expect(Object.keys(all).sort()).toEqual(["a", "b"]);
        expect(all.a).toEqual(makeValue(1));
        expect(all.b).toEqual(makeValue(2));
      });
    });

    it("getByPrefix filters to keys under the prefix", async () => {
      await withStore(async (store) => {
        await store.set("session", "s1", "docs/one", makeValue(1));
        await store.set("session", "s1", "docs/two", makeValue(2));
        await store.set("session", "s1", "other", makeValue(3));
        const docs = await store.getByPrefix("session", "s1", "docs/");
        expect(Object.keys(docs).sort()).toEqual(["docs/one", "docs/two"]);
      });
    });

    it("getByPrefix with an empty prefix returns every key", async () => {
      await withStore(async (store) => {
        await store.set("session", "s1", "a", makeValue(1));
        await store.set("session", "s1", "b", makeValue(2));
        const all = await store.getByPrefix("session", "s1", "");
        expect(Object.keys(all).sort()).toEqual(["a", "b"]);
      });
    });

    it("getByPrefix treats LIKE wildcards as literal characters", async () => {
      await withStore(async (store) => {
        // `%` and `_` are legal in resource keys and must not act as wildcards.
        await store.set("session", "s1", "50%_off", makeValue(1));
        await store.set("session", "s1", "5000_off", makeValue(2));
        const matched = await store.getByPrefix("session", "s1", "50%_");
        expect(Object.keys(matched)).toEqual(["50%_off"]);
      });
    });

    it("isolates keys across scope types and scope ids", async () => {
      await withStore(async (store) => {
        await store.set("session", "s1", "k", makeValue(1));
        await store.set("session", "s2", "k", makeValue(2));
        await store.set("user", "s1", "k", makeValue(3));
        expect(await store.get("session", "s1", "k")).toEqual(makeValue(1));
        expect(await store.get("session", "s2", "k")).toEqual(makeValue(2));
        expect(await store.get("user", "s1", "k")).toEqual(makeValue(3));
      });
    });

    it("deleteAll clears only the target scope", async () => {
      await withStore(async (store) => {
        await store.set("session", "s1", "a", makeValue(1));
        await store.set("session", "s2", "a", makeValue(2));
        await store.deleteAll("session", "s1");
        expect(await store.getAll("session", "s1")).toEqual({});
        expect(await store.get("session", "s2", "a")).toEqual(makeValue(2));
      });
    });
  });
}

/** Options for `createContentStoreConformanceTests`. */
export type CreateContentStoreConformanceTestsOptions = {
  /** Display name surfaced in the `describe` block, e.g. `"SQLiteContentStore"`. */
  name: string;
  /** Build a fresh `ContentStore`. Called per-test. */
  createStore: () => ContentStore | Promise<ContentStore>;
  /** Optional teardown hook for adapters with external resources. */
  cleanup?: (store: ContentStore) => Promise<void> | void;
};

/**
 * Register the shared `ContentStore` conformance cases against a backend.
 * Call inside a test file's top-level scope.
 */
export function createContentStoreConformanceTests(
  options: CreateContentStoreConformanceTestsOptions
): void {
  runKeyedResourceStoreConformance<string>({
    ...options,
    makeValue: (i) => `content-${i}`
  });
}

/** Options for `createResourceStateStoreConformanceTests`. */
export type CreateResourceStateStoreConformanceTestsOptions = {
  /** Display name surfaced in the `describe` block, e.g. `"SQLiteResourceStateStore"`. */
  name: string;
  /** Build a fresh `ResourceStateStore`. Called per-test. */
  createStore: () => ResourceStateStore | Promise<ResourceStateStore>;
  /** Optional teardown hook for adapters with external resources. */
  cleanup?: (store: ResourceStateStore) => Promise<void> | void;
};

/**
 * Register the shared `ResourceStateStore` conformance cases against a backend.
 * Call inside a test file's top-level scope.
 */
export function createResourceStateStoreConformanceTests(
  options: CreateResourceStateStoreConformanceTestsOptions
): void {
  runKeyedResourceStoreConformance<JsonObject>({
    ...options,
    makeValue: (i) => ({ n: i, label: `state-${i}` })
  });
}
