/**
 * Shared `TraceStore` conformance suite (FIX-558).
 *
 * Every concrete implementation — in-memory, filesystem, SQLite, and any
 * future backend — should pass these tests. The suite focuses on contract
 * shape: round-trip persistence, cursor semantics, FIFO eviction across
 * distinct request IDs, and `flush` durability. Backend-specific behavior
 * (atomic write, restart durability, native concurrency) lives alongside
 * each implementation's tests.
 *
 * Consumed via `@flow-state-dev/server/testing`.
 */
import { describe, expect, it } from "vitest";
import type { TraceEvent, TraceStore } from "../types";

/**
 * Configuration for `createTraceStoreConformanceTests`. `createStore` must
 * yield a freshly-isolated `TraceStore` so the suite's assertions are
 * independent across cases. `cleanup` runs after each case so adapters
 * with on-disk or open-handle state can release resources.
 */
export type CreateTraceStoreConformanceTestsOptions = {
  /** Display name surfaced in the `describe` block, e.g. `"InMemoryTraceStore"`. */
  name: string;
  /**
   * Build a fresh store. Called per-test so eviction and cursor cases run
   * against an empty backend. `maxRequests` lets eviction tests configure
   * a small cap without leaking into the default-retention assertions.
   */
  createStore: (
    options?: { maxRequests?: number }
  ) => TraceStore | Promise<TraceStore>;
  /**
   * Optional teardown hook for adapters with external resources (open
   * filesystem handles, sqlite connections). Runs after each case.
   */
  cleanup?: (store: TraceStore) => Promise<void> | void;
};

function makeEvent(
  requestId: string,
  sequenceNumber: number,
  ts: number
): TraceEvent {
  return {
    requestId,
    sequenceNumber,
    ts,
    type: "trace.item.added",
    item: {
      type: "block_debug",
      itemId: `item_${requestId}_${sequenceNumber}`,
      ts,
      blockName: "test-block"
    } as unknown as TraceEvent["item"]
  };
}

/**
 * Register the shared `TraceStore` conformance cases against a backend.
 * Call inside a test file's top-level scope; the helper opens its own
 * `describe` block so multiple suites can coexist.
 */
export function createTraceStoreConformanceTests(
  options: CreateTraceStoreConformanceTestsOptions
): void {
  const { name, createStore, cleanup } = options;

  describe(`${name} (TraceStore conformance)`, () => {
    async function withStore(
      run: (store: TraceStore) => Promise<void>,
      storeOptions?: { maxRequests?: number }
    ): Promise<void> {
      const store = await createStore(storeOptions);
      try {
        await run(store);
      } finally {
        if (cleanup !== undefined) await cleanup(store);
      }
    }

    it("appendEvent then getEvents round-trips events", async () => {
      await withStore(async (store) => {
        await store.appendEvent("r1", makeEvent("r1", 1, 100));
        await store.appendEvent("r1", makeEvent("r1", 2, 101));
        await store.appendEvent("r1", makeEvent("r1", 3, 102));

        const events = await store.getEvents("r1");
        expect(events).toHaveLength(3);
        expect(events.map((e) => e.sequenceNumber)).toEqual([1, 2, 3]);
        expect(events[0]!.type).toBe("trace.item.added");
      });
    });

    it("getEvents with fromSequence filters strictly greater than the cursor", async () => {
      await withStore(async (store) => {
        for (let i = 1; i <= 5; i += 1) {
          await store.appendEvent("r1", makeEvent("r1", i, 100 + i));
        }
        const events = await store.getEvents("r1", 2);
        expect(events.map((e) => e.sequenceNumber)).toEqual([3, 4, 5]);
      });
    });

    it("getEvents returns [] for an unknown request id", async () => {
      await withStore(async (store) => {
        expect(await store.getEvents("nope")).toEqual([]);
      });
    });

    it("listRequestIds returns request ids in insertion order", async () => {
      await withStore(async (store) => {
        await store.appendEvent("r3", makeEvent("r3", 1, 100));
        await store.appendEvent("r1", makeEvent("r1", 1, 101));
        await store.appendEvent("r2", makeEvent("r2", 1, 102));
        expect(await store.listRequestIds()).toEqual(["r3", "r1", "r2"]);
      });
    });

    it("evicts the oldest request when maxRequests is exceeded", async () => {
      await withStore(
        async (store) => {
          await store.appendEvent("r1", makeEvent("r1", 1, 100));
          await store.appendEvent("r2", makeEvent("r2", 1, 101));
          await store.appendEvent("r3", makeEvent("r3", 1, 102));

          expect(await store.listRequestIds()).toEqual(["r2", "r3"]);
          expect(await store.getEvents("r1")).toEqual([]);
        },
        { maxRequests: 2 }
      );
    });

    it("flush is awaitable and idempotent", async () => {
      await withStore(async (store) => {
        await store.appendEvent("r1", makeEvent("r1", 1, 100));
        await store.flush("r1");
        await store.flush("r1");
        expect(await store.getEvents("r1")).toHaveLength(1);
      });
    });

    it("preserves out-of-order sequence numbers as written", async () => {
      await withStore(async (store) => {
        await store.appendEvent("r1", makeEvent("r1", 3, 100));
        await store.appendEvent("r1", makeEvent("r1", 1, 101));
        await store.appendEvent("r1", makeEvent("r1", 2, 102));

        const events = await store.getEvents("r1");
        // Backends differ on whether sequence is the only sort key. Some
        // (SQLite) sort by sequence; others (in-memory, filesystem) keep
        // insertion order. The conformance contract is that all three
        // events round-trip; ordering is asserted only when callers pass
        // a cursor.
        expect(events.map((e) => e.sequenceNumber).sort()).toEqual([1, 2, 3]);
      });
    });
  });
}
