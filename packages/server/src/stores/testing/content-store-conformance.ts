/**
 * Shared `ContentStore.getByPrefixPaged` conformance suite. Every concrete
 * `ContentStore` implementation — in-memory, filesystem, SQLite, Postgres,
 * future backends — runs this suite via `@flow-state-dev/server/testing`.
 * Backend-specific cases (atomic write, restart durability, key encoding) live
 * alongside each implementation's tests; this suite locks the keyset-paging
 * contract uniformly across adapters.
 */
import { describe, expect, it } from "vitest";
import type { ContentScopeType, ContentStore } from "../types";

export type CreateContentStoreConformanceTestsOptions = {
  /** Display name surfaced in the `describe` block, e.g. `"InMemoryContentStore"`. */
  name: string;
  /** Build a fresh, empty store. Called per-test so paging cases start clean. */
  createStore: () => ContentStore | Promise<ContentStore>;
  /** Optional teardown hook for adapters with external resources. */
  cleanup?: (store: ContentStore) => Promise<void> | void;
};

/** Zero-padded keys (`key-00`..`key-NN`) so lexicographic order is numeric. */
function makeKeys(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `key-${String(i).padStart(2, "0")}`);
}

/**
 * Register the shared `ContentStore` paging conformance cases against a
 * backend. Call inside a test file's top-level scope; the helper opens its own
 * `describe` block so multiple suites can coexist.
 */
export function createContentStoreConformanceTests(
  options: CreateContentStoreConformanceTestsOptions
): void {
  const { name, createStore, cleanup } = options;
  const scope: ContentScopeType = "session";
  const scopeId = "s1";

  describe(`${name} (ContentStore.getByPrefixPaged conformance)`, () => {
    async function withStore(run: (store: ContentStore) => Promise<void>): Promise<void> {
      const store = await createStore();
      try {
        await run(store);
      } finally {
        if (cleanup !== undefined) await cleanup(store);
      }
    }

    async function seed(store: ContentStore, keys: string[]): Promise<void> {
      for (const key of keys) {
        await store.set(scope, scopeId, key, `v:${key}`);
      }
    }

    it("first asc page returns up to limit items, lex-ascending, with a cursor", async () => {
      await withStore(async (store) => {
        const keys = makeKeys(25);
        await seed(store, keys);
        const page = await store.getByPrefixPaged(scope, scopeId, "", {
          limit: 10,
          order: "asc"
        });
        expect(page.items).toHaveLength(10);
        const pageKeys = page.items.map((i) => i.key);
        expect(pageKeys).toEqual([...pageKeys].sort());
        expect(pageKeys).toEqual(keys.slice(0, 10));
        expect(page.nextCursor).toBeDefined();
        expect(page.items[0]!.value).toBe("v:key-00");
      });
    });

    it("threads nextCursor (asc): monotonic cursor, full coverage, no dupes", async () => {
      await withStore(async (store) => {
        const keys = makeKeys(25);
        await seed(store, keys);

        const seen: string[] = [];
        let cursor: string | undefined;
        let prevCursor: string | undefined;
        let pages = 0;
        do {
          const page = await store.getByPrefixPaged(scope, scopeId, "", {
            limit: 10,
            after: cursor,
            order: "asc"
          });
          for (const item of page.items) seen.push(item.key);
          if (page.nextCursor !== undefined && prevCursor !== undefined) {
            expect(page.nextCursor > prevCursor).toBe(true);
          }
          prevCursor = page.nextCursor;
          cursor = page.nextCursor;
          pages += 1;
          expect(pages).toBeLessThan(100); // guard against an infinite loop
        } while (cursor !== undefined);

        expect(seen.sort()).toEqual([...keys].sort());
        expect(new Set(seen).size).toBe(keys.length);
      });
    });

    it("desc order returns lex-descending items and threads", async () => {
      await withStore(async (store) => {
        const keys = makeKeys(25);
        await seed(store, keys);

        const first = await store.getByPrefixPaged(scope, scopeId, "", {
          limit: 10,
          order: "desc"
        });
        const firstKeys = first.items.map((i) => i.key);
        expect(firstKeys).toEqual([...firstKeys].sort().reverse());
        expect(firstKeys).toEqual([...keys].reverse().slice(0, 10));
        expect(first.nextCursor).toBeDefined();

        const seen: string[] = [...firstKeys];
        let cursor = first.nextCursor;
        let pages = 1;
        while (cursor !== undefined) {
          const page = await store.getByPrefixPaged(scope, scopeId, "", {
            limit: 10,
            after: cursor,
            order: "desc"
          });
          for (const item of page.items) seen.push(item.key);
          cursor = page.nextCursor;
          pages += 1;
          expect(pages).toBeLessThan(100);
        }
        expect(seen.sort()).toEqual([...keys].sort());
      });
    });

    it("limit larger than total returns all items with no cursor", async () => {
      await withStore(async (store) => {
        const keys = makeKeys(5);
        await seed(store, keys);
        const page = await store.getByPrefixPaged(scope, scopeId, "", { limit: 50 });
        expect(page.items.map((i) => i.key).sort()).toEqual([...keys].sort());
        expect(page.nextCursor).toBeUndefined();
      });
    });

    it("after past all keys returns empty items and no cursor", async () => {
      await withStore(async (store) => {
        await seed(store, makeKeys(5));
        const page = await store.getByPrefixPaged(scope, scopeId, "", {
          limit: 10,
          after: "zzzz"
        });
        expect(page.items).toEqual([]);
        expect(page.nextCursor).toBeUndefined();
      });
    });

    it("empty keyPrefix returns every key in scope, paged", async () => {
      await withStore(async (store) => {
        await store.set(scope, scopeId, "alpha/1", "a");
        await store.set(scope, scopeId, "beta/1", "b");
        await store.set(scope, scopeId, "gamma", "g");
        const page = await store.getByPrefixPaged(scope, scopeId, "", { limit: 50 });
        expect(page.items.map((i) => i.key).sort()).toEqual(["alpha/1", "beta/1", "gamma"]);
      });
    });

    it("keyPrefix filters to matching keys only", async () => {
      await withStore(async (store) => {
        await store.set(scope, scopeId, "files/a", "a");
        await store.set(scope, scopeId, "files/b", "b");
        await store.set(scope, scopeId, "notes", "n");
        const page = await store.getByPrefixPaged(scope, scopeId, "files/", { limit: 50 });
        expect(page.items.map((i) => i.key).sort()).toEqual(["files/a", "files/b"]);
      });
    });

    it("does not bleed keys across scopes", async () => {
      await withStore(async (store) => {
        await store.set(scope, scopeId, "k1", "session");
        await store.set("user", scopeId, "k1", "user");
        await store.set(scope, "s2", "k1", "other");
        const page = await store.getByPrefixPaged(scope, scopeId, "", { limit: 50 });
        expect(page.items).toEqual([{ key: "k1", value: "session" }]);
      });
    });

    it("mid-iteration insert/delete does not throw; cursor semantics hold", async () => {
      await withStore(async (store) => {
        const keys = makeKeys(20);
        await seed(store, keys);

        const first = await store.getByPrefixPaged(scope, scopeId, "", { limit: 10 });
        const cursor = first.nextCursor!;

        // Insert a key after the cursor (visible) and one before (skipped),
        // and delete a key after the cursor (no longer visible).
        await store.set(scope, scopeId, "key-15-new", "later");
        await store.set(scope, scopeId, "key-00-new", "earlier");
        await store.delete(scope, scopeId, "key-16");

        const rest: string[] = [];
        let c: string | undefined = cursor;
        let pages = 0;
        while (c !== undefined) {
          const page = await store.getByPrefixPaged(scope, scopeId, "", {
            limit: 10,
            after: c
          });
          for (const item of page.items) rest.push(item.key);
          c = page.nextCursor;
          pages += 1;
          expect(pages).toBeLessThan(100);
        }
        // Keys strictly after the cursor are visible; inserts past it appear,
        // deletes past it vanish, and the earlier insert (before cursor) is
        // skipped since we only page forward.
        expect(rest).toContain("key-15-new");
        expect(rest).not.toContain("key-16");
        expect(rest).not.toContain("key-00-new");
      });
    });
  });
}
