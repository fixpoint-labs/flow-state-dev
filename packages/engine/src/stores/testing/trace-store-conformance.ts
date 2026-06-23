/**
 * Shared `TraceStore` conformance suite. Every concrete implementation —
 * in-memory, filesystem, SQLite, future backends — runs this suite via
 * `@flow-state-dev/engine/testing`. Backend-specific cases (atomic write,
 * restart durability, native concurrency) live alongside each
 * implementation's tests.
 */
import { describe, expect, it } from "vitest";
import type { TraceEvent, TraceStore } from "../types";

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
  /** Optional teardown hook for adapters with external resources. */
  cleanup?: (store: TraceStore) => Promise<void> | void;
};

export type MakeTraceEventOptions = {
  ts?: number;
  payload?: Record<string, unknown>;
};

/**
 * Build a `TraceEvent` whose inner item is a fully-typed `BlockTraceItem`.
 * Tests want one valid shape they can stamp with sequence numbers; this is
 * it. `ts` defaults to a stable function of `sequenceNumber` so test logs
 * don't churn between runs.
 */
export function makeTraceEvent(
  requestId: string,
  sequenceNumber: number,
  options: MakeTraceEventOptions = {}
): TraceEvent {
  const ts = options.ts ?? sequenceNumber * 100;
  const id = `item_${requestId}_${sequenceNumber}`;
  return {
    requestId,
    sequenceNumber,
    ts,
    type: "trace.item.added",
    item: {
      id,
      type: "block_trace",
      status: "completed",
      requestId,
      itemIndex: sequenceNumber,
      provenance: {
        blockName: "test-block",
        blockInstanceId: "test-instance",
        phase: "main"
      },
      ts,
      blockName: "test-block",
      blockKind: "handler",
      blockInstanceId: "test-instance"
    }
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
        await store.appendEvent("r1", makeTraceEvent("r1", 1));
        await store.appendEvent("r1", makeTraceEvent("r1", 2));
        await store.appendEvent("r1", makeTraceEvent("r1", 3));

        const events = await store.getEvents("r1");
        expect(events).toHaveLength(3);
        expect(events.map((e) => e.sequenceNumber)).toEqual([1, 2, 3]);
        expect(events[0]!.type).toBe("trace.item.added");
      });
    });

    it("getEvents with fromSequence filters strictly greater than the cursor", async () => {
      await withStore(async (store) => {
        for (let i = 1; i <= 5; i += 1) {
          await store.appendEvent("r1", makeTraceEvent("r1", i));
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
      // Distinct `ts` values so backends sorting by insertion timestamp
      // (SQLite) reflect call order rather than tying on a shared default.
      await withStore(async (store) => {
        await store.appendEvent("r3", makeTraceEvent("r3", 1, { ts: 100 }));
        await store.appendEvent("r1", makeTraceEvent("r1", 1, { ts: 101 }));
        await store.appendEvent("r2", makeTraceEvent("r2", 1, { ts: 102 }));
        expect(await store.listRequestIds()).toEqual(["r3", "r1", "r2"]);
      });
    });

    it("evicts the oldest request when maxRequests is exceeded", async () => {
      await withStore(
        async (store) => {
          await store.appendEvent("r1", makeTraceEvent("r1", 1, { ts: 100 }));
          await store.appendEvent("r2", makeTraceEvent("r2", 1, { ts: 101 }));
          await store.appendEvent("r3", makeTraceEvent("r3", 1, { ts: 102 }));

          expect(await store.listRequestIds()).toEqual(["r2", "r3"]);
          expect(await store.getEvents("r1")).toEqual([]);
        },
        { maxRequests: 2 }
      );
    });

    it("flush is awaitable and idempotent", async () => {
      await withStore(async (store) => {
        await store.appendEvent("r1", makeTraceEvent("r1", 1));
        await store.flush("r1");
        await store.flush("r1");
        expect(await store.getEvents("r1")).toHaveLength(1);
      });
    });

    it("preserves out-of-order sequence numbers as written", async () => {
      await withStore(async (store) => {
        await store.appendEvent("r1", makeTraceEvent("r1", 3));
        await store.appendEvent("r1", makeTraceEvent("r1", 1));
        await store.appendEvent("r1", makeTraceEvent("r1", 2));

        // Backends differ on whether sequence is the only sort key. SQLite
        // sorts by sequence; in-memory and filesystem keep insertion order.
        // The conformance contract is round-trip; ordering is asserted only
        // when callers pass a cursor.
        const events = await store.getEvents("r1");
        expect(events.map((e) => e.sequenceNumber).sort()).toEqual([1, 2, 3]);
      });
    });
  });
}
