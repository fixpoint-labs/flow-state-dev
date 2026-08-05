/**
 * Shared conformance suites for the two keyed resource stores — `ContentStore`
 * (string bodies) and `ResourceStateStore` (`JsonObject` state).
 *
 * The two stores share an addressing scheme — `(scopeType, scopeId,
 * resourceKey)` — but no longer share a concurrency model, so they no longer
 * share one suite. `ContentStore` stays last-write-wins and keeps the generic
 * keyed-store core below. `ResourceStateStore` is compare-and-swap, with
 * versioned reads and a delete that tombstones rather than removes, so it gets
 * its own suite covering the CAS, lifecycle and ABA behaviour that the generic
 * core cannot express.
 *
 * Every concrete adapter — memory, filesystem, SQLite, Postgres — runs these
 * via `@flow-state-dev/engine/testing`.
 *
 * These cases run against a single store instance; persistence-across-restart
 * is adapter-specific (close + reopen the backing file) and lives in each
 * adapter's own test file, as does anything asserting on-disk or on-row
 * representation (a tombstone's dropped payload, for instance).
 */
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@flow-state-dev/core/types";
import type {
  ContentStore,
  ResourceStateStore,
  ContentScopeType
} from "../types";

/** Structural shape of the last-write-wins keyed store (`ContentStore`). */
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

    it("round-trips a dotted-extension nested key through get and getAll", async () => {
      await withStore(async (store) => {
        // A key whose leaf carries its own dot (`utils.ts`) exercises the leaf
        // extension escaping — the stored `.ts` must not be confused with the
        // structural store extension.
        const value = makeValue(7);
        await store.set("session", "s1", "files/src/utils.ts", value);
        expect(await store.get("session", "s1", "files/src/utils.ts")).toEqual(value);
        const all = await store.getAll("session", "s1");
        expect(all["files/src/utils.ts"]).toEqual(value);
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
 * Register the shared `ResourceStateStore` conformance cases against a
 * backend. Call inside a test file's top-level scope.
 *
 * Covers the baseline keyed-store behaviour in versioned terms, then the CAS,
 * lifecycle and ABA behaviour that is the whole point of this store being
 * different from `ContentStore`. The contended cases matter most: a
 * value-only design passes every happy-path CAS assertion, so ABA needs a
 * delete between read and write, resurrection needs a delete racing a patch,
 * and the `deleteAll` residual needs a purge racing a create.
 */
export function createResourceStateStoreConformanceTests(
  options: CreateResourceStateStoreConformanceTestsOptions
): void {
  const { name, createStore, cleanup } = options;
  const makeState = (i: number): JsonObject => ({ n: i, label: `state-${i}` });

  describe(`${name} (resource state store conformance)`, () => {
    async function withStore(fn: (store: ResourceStateStore) => Promise<void>): Promise<void> {
      const store = await createStore();
      try {
        await fn(store);
      } finally {
        await cleanup?.(store);
      }
    }

    /** Seed a key at version 1 and return that version. */
    async function seed(
      store: ResourceStateStore,
      key: string,
      value: JsonObject
    ): Promise<number> {
      const result = await store.set("session", "s1", key, value, 0);
      if (!result.ok) throw new Error(`seed of ${key} conflicted`);
      return result.version;
    }

    // --- baseline keyed behaviour, in versioned terms ---------------------

    it("get returns undefined for a missing key", async () => {
      await withStore(async (store) => {
        expect(await store.get("session", "s1", "missing")).toBeUndefined();
      });
    });

    it("set then get round-trips the state with its version", async () => {
      await withStore(async (store) => {
        const value = makeState(1);
        const written = await store.set("session", "s1", "k1", value, 0);
        expect(written.ok).toBe(true);
        expect(await store.get("session", "s1", "k1")).toEqual({
          state: value,
          version: written.ok ? written.version : -1
        });
      });
    });

    it("getAll returns every live key in the scope with versions", async () => {
      await withStore(async (store) => {
        await seed(store, "a", makeState(1));
        await seed(store, "b", makeState(2));
        const all = await store.getAll("session", "s1");
        expect(Object.keys(all).sort()).toEqual(["a", "b"]);
        expect(all.a).toEqual({ state: makeState(1), version: 1 });
        expect(all.b).toEqual({ state: makeState(2), version: 1 });
      });
    });

    it("getByPrefix filters to live keys under the prefix", async () => {
      await withStore(async (store) => {
        await seed(store, "docs/one", makeState(1));
        await seed(store, "docs/two", makeState(2));
        await seed(store, "other", makeState(3));
        const docs = await store.getByPrefix("session", "s1", "docs/");
        expect(Object.keys(docs).sort()).toEqual(["docs/one", "docs/two"]);
      });
    });

    it("getByPrefix with an empty prefix returns every live key", async () => {
      await withStore(async (store) => {
        await seed(store, "a", makeState(1));
        await seed(store, "b", makeState(2));
        const all = await store.getByPrefix("session", "s1", "");
        expect(Object.keys(all).sort()).toEqual(["a", "b"]);
      });
    });

    it("getByPrefix treats LIKE wildcards as literal characters", async () => {
      await withStore(async (store) => {
        await seed(store, "50%_off", makeState(1));
        await seed(store, "5000_off", makeState(2));
        const matched = await store.getByPrefix("session", "s1", "50%_");
        expect(Object.keys(matched)).toEqual(["50%_off"]);
      });
    });

    it("round-trips a dotted-extension nested key through get and getAll", async () => {
      await withStore(async (store) => {
        const value = makeState(7);
        await seed(store, "files/src/utils.ts", value);
        expect(await store.get("session", "s1", "files/src/utils.ts")).toEqual({
          state: value,
          version: 1
        });
        const all = await store.getAll("session", "s1");
        expect(all["files/src/utils.ts"]).toEqual({ state: value, version: 1 });
      });
    });

    it("isolates keys across scope types and scope ids", async () => {
      await withStore(async (store) => {
        await store.set("session", "s1", "k", makeState(1), 0);
        await store.set("session", "s2", "k", makeState(2), 0);
        await store.set("user", "s1", "k", makeState(3), 0);
        expect((await store.get("session", "s1", "k"))?.state).toEqual(makeState(1));
        expect((await store.get("session", "s2", "k"))?.state).toEqual(makeState(2));
        expect((await store.get("user", "s1", "k"))?.state).toEqual(makeState(3));
      });
    });

    // --- versioning -------------------------------------------------------

    it("a first create writes version 1", async () => {
      await withStore(async (store) => {
        const result = await store.set("session", "s1", "k", makeState(1), 0);
        expect(result).toEqual({ ok: true, version: 1 });
      });
    });

    it("each committed write bumps the version by exactly 1", async () => {
      await withStore(async (store) => {
        await seed(store, "k", makeState(1));
        const second = await store.set("session", "s1", "k", makeState(2), 1);
        expect(second).toEqual({ ok: true, version: 2 });
        const third = await store.set("session", "s1", "k", makeState(3), 2);
        expect(third).toEqual({ ok: true, version: 3 });
        expect(await store.get("session", "s1", "k")).toEqual({
          state: makeState(3),
          version: 3
        });
      });
    });

    it("a stale expectedVersion conflicts and reports the current state and version", async () => {
      await withStore(async (store) => {
        await seed(store, "k", makeState(1));
        await store.set("session", "s1", "k", makeState(2), 1); // now at version 2
        const stale = await store.set("session", "s1", "k", makeState(9), 1);
        expect(stale).toEqual({
          ok: false,
          conflict: { currentValue: makeState(2), currentVersion: 2 }
        });
        // and the losing write did not land
        expect((await store.get("session", "s1", "k"))?.state).toEqual(makeState(2));
      });
    });

    it('"any" writes unconditionally and still bumps the version', async () => {
      await withStore(async (store) => {
        await seed(store, "k", makeState(1));
        await store.set("session", "s1", "k", makeState(2), 1); // version 2
        const blind = await store.set("session", "s1", "k", makeState(3), "any");
        expect(blind).toEqual({ ok: true, version: 3 });
        expect((await store.get("session", "s1", "k"))?.state).toEqual(makeState(3));
      });
    });

    it('"any" writes a key that never existed', async () => {
      await withStore(async (store) => {
        const blind = await store.set("session", "s1", "fresh", makeState(1), "any");
        expect(blind).toEqual({ ok: true, version: 1 });
      });
    });

    it('two concurrent "any" writes never commit the same version', async () => {
      await withStore(async (store) => {
        await seed(store, "k", makeState(0));

        // `"any"` is the opt-out every un-migrated caller passes, so this is
        // the only write path in production until the registry driver lands.
        // If the version bump is computed from a prior read rather than
        // applied atomically, both writers compute the same next version and
        // both commit it — and the loser then holds a version naming the
        // winner's row, so its next version-checked write sails through and
        // clobbers it. That is the lost update this store exists to stop,
        // arriving through the one path that does not check a version.
        const [first, second] = await Promise.all([
          store.set("session", "s1", "k", makeState(1), "any"),
          store.set("session", "s1", "k", makeState(2), "any")
        ]);
        expect(first.ok && second.ok).toBe(true);
        const versions = [first, second].map((r) => (r.ok ? r.version : -1));
        expect(new Set(versions).size).toBe(2);

        // and the row ends at the higher of the two, not at a shared number
        const current = await store.get("session", "s1", "k");
        expect(current?.version).toBe(Math.max(...versions));
      });
    });

    it("expectedVersion 0 inserts when there is no live row", async () => {
      await withStore(async (store) => {
        const created = await store.set("session", "s1", "k", makeState(1), 0);
        expect(created).toEqual({ ok: true, version: 1 });
      });
    });

    it("expectedVersion 0 conflicts against a live row", async () => {
      await withStore(async (store) => {
        await seed(store, "k", makeState(1));
        const loser = await store.set("session", "s1", "k", makeState(2), 0);
        expect(loser).toEqual({
          ok: false,
          conflict: { currentValue: makeState(1), currentVersion: 1 }
        });
        // the winner's value stands
        expect((await store.get("session", "s1", "k"))?.state).toEqual(makeState(1));
      });
    });

    // --- tombstones and lifecycle ----------------------------------------

    it("a tombstoned key reads as absent through all three readers", async () => {
      await withStore(async (store) => {
        await seed(store, "k", makeState(1));
        await store.delete("session", "s1", "k", 1);
        expect(await store.get("session", "s1", "k")).toBeUndefined();
        expect(await store.getAll("session", "s1")).toEqual({});
        expect(await store.getByPrefix("session", "s1", "")).toEqual({});
      });
    });

    it("delete keeps the version rather than bumping it", async () => {
      await withStore(async (store) => {
        await seed(store, "k", makeState(1));
        await store.set("session", "s1", "k", makeState(2), 1); // version 2
        const deleted = await store.delete("session", "s1", "k", 2);
        expect(deleted).toEqual({ ok: true, version: 2 });
      });
    });

    it("deleting an absent key is an idempotent success", async () => {
      await withStore(async (store) => {
        const result = await store.delete("session", "s1", "never", "any");
        expect(result.ok).toBe(true);
      });
    });

    it("deleting an already-tombstoned key is an idempotent success", async () => {
      await withStore(async (store) => {
        await seed(store, "k", makeState(1));
        await store.delete("session", "s1", "k", 1);
        const again = await store.delete("session", "s1", "k", "any");
        expect(again.ok).toBe(true);
      });
    });

    it("a stale-version delete conflicts instead of tombstoning the current row", async () => {
      await withStore(async (store) => {
        await seed(store, "k", makeState(1));
        await store.set("session", "s1", "k", makeState(2), 1); // version 2
        const staleDelete = await store.delete("session", "s1", "k", 1);
        expect(staleDelete).toEqual({
          ok: false,
          conflict: { currentValue: makeState(2), currentVersion: 2 }
        });
        // the row survives, fully readable
        expect(await store.get("session", "s1", "k")).toEqual({
          state: makeState(2),
          version: 2
        });
      });
    });

    it("a conflict against a tombstone reports no current value, so a caller cannot mistake it for a live row", async () => {
      await withStore(async (store) => {
        await seed(store, "k", makeState(1));
        await store.delete("session", "s1", "k", 1);
        const patch = await store.set("session", "s1", "k", makeState(2), 1);
        expect(patch).toEqual({
          ok: false,
          conflict: { currentValue: undefined, currentVersion: 1 }
        });
      });
    });

    it("a tombstone never satisfies a positive expectedVersion", async () => {
      await withStore(async (store) => {
        await seed(store, "k", makeState(1));
        await store.delete("session", "s1", "k", 1);
        // the tombstone retains version 1 — a writer holding exactly that
        // version must still be refused, or the delete never happened
        const resurrect = await store.set("session", "s1", "k", makeState(5), 1);
        expect(resurrect.ok).toBe(false);
        expect(await store.get("session", "s1", "k")).toBeUndefined();
      });
    });

    // --- ABA, key altitude ------------------------------------------------

    it("a recreate after delete does not reuse a version", async () => {
      await withStore(async (store) => {
        await seed(store, "k", makeState(1)); // version 1
        await store.delete("session", "s1", "k", 1); // tombstone retains 1
        const recreated = await store.set("session", "s1", "k", makeState(2), 0);
        expect(recreated).toEqual({ ok: true, version: 2 });
      });
    });

    it("a pre-delete observer's write conflicts against the recreated row (key ABA)", async () => {
      await withStore(async (store) => {
        // an observer reads at version 1
        await seed(store, "k", makeState(1));
        const observed = await store.get("session", "s1", "k");
        expect(observed?.version).toBe(1);

        // the key is deleted and recreated behind its back
        await store.delete("session", "s1", "k", 1);
        await store.set("session", "s1", "k", makeState(2), 0);

        // the stale write must not land on the new generation
        const stale = await store.set("session", "s1", "k", makeState(9), observed!.version);
        expect(stale.ok).toBe(false);
        expect((await store.get("session", "s1", "k"))?.state).toEqual(makeState(2));
      });
    });

    it("retention: a pre-delete version still conflicts long after the delete", async () => {
      await withStore(async (store) => {
        await seed(store, "k", makeState(1));
        await store.delete("session", "s1", "k", 1);
        await store.set("session", "s1", "k", makeState(2), 0); // recreated at 2

        // nothing sweeps the tombstone, so the guarantee holds indefinitely.
        // An arbitrary interval must not change the answer.
        await new Promise((resolve) => setTimeout(resolve, 25));

        const stale = await store.set("session", "s1", "k", makeState(9), 1);
        expect(stale.ok).toBe(false);
      });
    });

    // --- deleteAll, scope altitude ---------------------------------------

    it("deleteAll tombstones every live key in the scope and leaves other scopes alone", async () => {
      await withStore(async (store) => {
        await seed(store, "a", makeState(1));
        await store.set("session", "s2", "a", makeState(2), 0);
        await store.deleteAll("session", "s1");
        expect(await store.getAll("session", "s1")).toEqual({});
        expect((await store.get("session", "s2", "a"))?.state).toEqual(makeState(2));
      });
    });

    it("deleteAll racing a write to an existing key: the write conflicts and no row reappears", async () => {
      await withStore(async (store) => {
        // (i) a writer passes its version check, then the purge lands, then
        // the writer commits. It must conflict — not resurrect the key.
        await seed(store, "k", makeState(1));
        const observed = await store.get("session", "s1", "k");
        expect(observed?.version).toBe(1);

        await store.deleteAll("session", "s1");

        const late = await store.set("session", "s1", "k", makeState(2), observed!.version);
        expect(late.ok).toBe(false);
        expect(await store.get("session", "s1", "k")).toBeUndefined();
        expect(await store.getAll("session", "s1")).toEqual({});

        // The conflict above is necessary but NOT sufficient evidence that the
        // purge marked rather than removed: a positive expectedVersion fails
        // against an absent row too, so the assertions so far pass even if
        // `deleteAll` deleted outright and threw the version away. What
        // separates the two is whether the version survived — so recreate and
        // check it continued rather than restarting at 1.
        const recreated = await store.set("session", "s1", "k", makeState(3), 0);
        expect(recreated).toEqual({ ok: true, version: 2 });
      });
    });

    it("deleteAll racing a create of a never-existed key: the create LANDS — the residual this design does not close", async () => {
      await withStore(async (store) => {
        // (ii) `expectedVersion: 0` means "no live row", which a key that
        // never existed satisfies trivially, and a bulk mark only touches
        // rows that already exist. So this create commits into a scope that
        // was already purged. Pinned by a test rather than carried as prose:
        // closing it needs a scope generation, not a per-key predicate.
        await seed(store, "existing", makeState(1));
        await store.deleteAll("session", "s1");

        const created = await store.set("session", "s1", "brand-new", makeState(2), 0);
        expect(created.ok).toBe(true);
        expect((await store.get("session", "s1", "brand-new"))?.state).toEqual(makeState(2));
      });
    });

    it("deleteAll retains each key's version, so a recreate after a purge does not reuse one (scope ABA)", async () => {
      await withStore(async (store) => {
        await seed(store, "k", makeState(1));
        await store.set("session", "s1", "k", makeState(2), 1); // version 2
        await store.deleteAll("session", "s1");

        // the scope is recreated under the same (caller-supplied, reusable) id
        const recreated = await store.set("session", "s1", "k", makeState(3), 0);
        expect(recreated).toEqual({ ok: true, version: 3 });

        // a straggler from the previous generation still cannot land
        const straggler = await store.set("session", "s1", "k", makeState(9), 2);
        expect(straggler.ok).toBe(false);
      });
    });
  });
}
