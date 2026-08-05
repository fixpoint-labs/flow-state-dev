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
import type {
  ExpectedVersion,
  SetResult,
  VersionedResourceState
} from "@flow-state-dev/engine";
import type { JsonObject } from "@flow-state-dev/core/types";

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

/**
 * The other window the same two-round-trip shape opens, and the one the
 * previous round's own fix created: dropping the pre-read short-circuit made
 * the tombstone statement run first and the zero-row branch re-read to decide.
 * That re-read is a second round trip, so a recreate can land between it and
 * the statement it is explaining.
 *
 * Only Postgres can show this. The two SQL adapters share the shape, but
 * `better-sqlite3` is synchronous — nothing yields between SQLite's UPDATE and
 * its re-read inside one process, so a second connection has no point at which
 * to interleave and the window is not reachable from a test. Memory and
 * filesystem do not have the shape at all (no await, and a per-key mutex
 * respectively). Asserted here rather than implied everywhere.
 */
describe("Postgres resource state: a recreate racing a blind delete's re-read", () => {
  /**
   * Park a delete between its zero-row tombstone UPDATE and the re-read that
   * decides what the zero rows meant, so a recreate can land in between.
   */
  async function raceRecreateIntoDeleteWindow(
    expectedVersion: ExpectedVersion,
    deleteVersion: ExpectedVersion
  ): Promise<{ result: SetResult<JsonObject>; live: VersionedResourceState | undefined }> {
    const pglite = new PGlite();
    const plain = pgliteExecutor(pglite);
    await initializeSchema(plain);

    let park: (() => void) | null = null;
    let release: (() => void) | null = null;
    const gated: QueryExecutor = {
      async query(text: string, values?: unknown[]) {
        const result = await pglite.query(text, values);
        // Hold AFTER the tombstone statement has run and matched nothing —
        // exactly the gap between the UPDATE and the diagnostic re-read.
        if (text.includes("lifecycle = 'deleted'") && (result.affectedRows ?? 0) === 0) {
          if (park !== null) {
            const signal = park;
            park = null;
            await new Promise<void>((resolve) => {
              release = resolve;
              signal();
            });
          }
        }
        return {
          rows: result.rows as Record<string, unknown>[],
          rowCount: result.affectedRows ?? 0
        };
      }
    };
    const slow = createPostgresResourceStateStore(gated);
    const fast = createPostgresResourceStateStore(plain);

    await fast.set("session", "s1", "k", { v: 1 }, 0); // version 1
    await fast.delete("session", "s1", "k", 1); // tombstone retaining 1

    const parked = new Promise<void>((resolve) => {
      park = resolve;
    });
    const slowDelete = slow.delete("session", "s1", "k", deleteVersion);
    await parked;

    // The recreate lands while the delete is between its two round trips.
    const recreated = await fast.set("session", "s1", "k", { w: "recreated" }, expectedVersion);
    expect(recreated.ok).toBe(true);

    release!();
    const result = await slowDelete;
    const live = await fast.get("session", "s1", "k");
    await pglite.close();
    return { result, live };
  }

  it('reports idempotent success for "any", because a zero-row tombstone already established there was no live row', async () => {
    const { result, live } = await raceRecreateIntoDeleteWindow(0, "any");

    // `"any"` asserts nothing about versions, so its guard matched every one
    // of them. A zero-row UPDATE can therefore only mean "no live row when it
    // ran", which is precisely what a blind delete asks for — the call
    // linearizes there, and the row visible now was created after it. Calling
    // that a conflict reports a race that did not affect this request.
    expect(result).toEqual({ ok: true, version: 0 });

    // Version `0` and not the recreated row's version: `0` is the contract's
    // "no live row", and it is not a version any row holds, so a caller cannot
    // carry it forward as though this delete had tombstoned something. The
    // recreated row is untouched and still live.
    expect(live).toEqual({ state: { w: "recreated" }, version: 2 });
  });

  it("still conflicts for a positive expectedVersion, because that assertion genuinely did not hold", async () => {
    const { result, live } = await raceRecreateIntoDeleteWindow(0, 2);

    // The asymmetry. This caller DID assert a version, and at the same
    // linearization point the row was not live at version 2 — it was a
    // tombstone. The assertion failed on its own terms, independently of what
    // happened afterwards, so a conflict is the honest report and it carries
    // the version now stored.
    expect(result).toEqual({
      ok: false,
      conflict: { currentValue: { w: "recreated" }, currentVersion: 2 }
    });
    expect(live).toEqual({ state: { w: "recreated" }, version: 2 });
  });
});
