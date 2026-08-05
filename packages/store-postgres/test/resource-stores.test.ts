/**
 * FIX-687: runs the shared keyed-resource-store conformance suites against the
 * Postgres `ContentStore` and `ResourceStateStore`. These adapters were already
 * durable (the SQLite work that introduced the shared suites is the reference's
 * mirror); wiring Postgres into the same cases keeps both adapters honest about
 * scoped reads, last-write-wins, literal prefix matching, and scope isolation.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  createPostgresContentStore,
  createPostgresResourceStateStore,
  initializeSchema,
  type QueryExecutor
} from "../src";
import {
  createContentStoreConformanceTests,
  createResourceStateStoreConformanceTests
} from "@flow-state-dev/engine/testing";

const pglites: PGlite[] = [];

function pgliteExecutor(pglite: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? 0
      };
    }
  };
}

async function freshExecutor(): Promise<QueryExecutor> {
  const pglite = new PGlite();
  pglites.push(pglite);
  const executor = pgliteExecutor(pglite);
  await initializeSchema(executor);
  return executor;
}

async function cleanupAll(): Promise<void> {
  while (pglites.length > 0) {
    const pglite = pglites.pop();
    await pglite?.close();
  }
}

createContentStoreConformanceTests({
  name: "PostgresContentStore",
  createStore: async () => createPostgresContentStore(await freshExecutor()),
  cleanup: cleanupAll
});

createResourceStateStoreConformanceTests({
  name: "PostgresResourceStateStore",
  createStore: async () => createPostgresResourceStateStore(await freshExecutor()),
  cleanup: cleanupAll
});

/**
 * A concurrency case the shared conformance suite cannot express: it needs to
 * park one call between its read and its write, which requires an executor
 * that can be gated. Postgres is the adapter where the two are genuinely
 * separate round trips, so the interleaving is real rather than simulated.
 */
describe("Postgres resource state: revive fences on the tombstone it observed", () => {
  it("does not reuse a version when a revive races another revive plus delete", async () => {
    const pglite = new PGlite();
    await initializeSchema(pgliteExecutor(pglite));

    let park: (() => void) | null = null;
    let release: (() => void) | null = null;
    const gated: QueryExecutor = {
      async query(text: string, values?: unknown[]) {
        // Hold the revive UPDATE just before it runs, once.
        if (text.includes("lifecycle <> 'live'") && park !== null) {
          const signal = park;
          park = null;
          await new Promise<void>((resolve) => {
            release = resolve;
            signal();
          });
        }
        const result = await pglite.query(text, values);
        return {
          rows: result.rows as Record<string, unknown>[],
          rowCount: result.affectedRows ?? 0
        };
      }
    };
    const slow = createPostgresResourceStateStore(gated);
    const fast = createPostgresResourceStateStore(pgliteExecutor(pglite));

    await fast.set("session", "s1", "k", { v: 1 }, 0); // version 1
    await fast.delete("session", "s1", "k", 1); // tombstone retaining 1

    // A reads the tombstone at version 1, then parks before writing.
    const parked = new Promise<void>((resolve) => {
      park = resolve;
    });
    const slowRevive = slow.set("session", "s1", "k", { w: "A" }, 0);
    await parked;

    // B revives to version 2 and C tombstones it again, all while A is parked.
    const b = await fast.set("session", "s1", "k", { w: "B" }, 0);
    expect(b).toEqual({ ok: true, version: 2 });
    await fast.delete("session", "s1", "k", 2);

    release!();
    const a = await slowRevive;

    // A's predicate named version 1, which no longer describes the row, so it
    // must conflict. Were it fenced only on "still not live" it would commit
    // version 2 a second time — and a version naming two generations is
    // exactly the ABA the retained tombstone exists to prevent.
    expect(a.ok).toBe(false);
    await pglite.close();
  });
});
