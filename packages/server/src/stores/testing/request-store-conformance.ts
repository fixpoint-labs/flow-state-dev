/**
 * Shared `RequestStore.subscribeToEvents` conformance suite. Every concrete
 * implementation — memory bus, SQLite poll, filesystem poll, Postgres
 * LISTEN/NOTIFY, PGlite poll — runs this suite via
 * `@flow-state-dev/server/testing`.
 *
 * Mirrors the `TraceStore` conformance pattern. Polling-tolerance defaults
 * give the SQLite/filesystem/Postgres pollers room to wake up; cross-store
 * cases that need different windows pass `pollIntervalMs`.
 */
import { describe, expect, it } from "vitest";
import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import { StoreSubscriptionError } from "../../errors/store-subscription-error";
import type { RequestStore } from "../types";

const DEFAULT_POLL_INTERVAL_MS = 100;

export type CreateRequestStoreConformanceTestsOptions = {
  /** Display name surfaced in the `describe` block, e.g. `"InMemoryRequestStore"`. */
  name: string;
  /** Build a fresh store. Called per-test so cases run against an empty backend. */
  createStore: () => RequestStore | Promise<RequestStore>;
  /** Optional teardown hook for adapters with external resources. */
  cleanup?: (store: RequestStore) => Promise<void> | void;
  /**
   * Effective subscription poll interval (ms). Polling backends should
   * pass their configured interval so the live-phase tolerance windows
   * are wide enough to be deterministic. Memory uses 0 (no polling).
   */
  pollIntervalMs?: number;
  /**
   * If `true`, the suite skips the liveness-timeout case. Memory
   * deliberately ignores `livenessTimeoutMs` (no cross-process death
   * scenario) and should set this.
   */
  skipLivenessTimeout?: boolean;
};

/**
 * Build an `item.added` `RequestStreamEvent` with the given sequence
 * number. Tests want a single valid shape they can stamp; this is it.
 */
export function makeRequestStreamEvent(
  requestId: string,
  sequenceNumber: number
): RequestStreamEvent {
  return {
    stream: "request",
    type: "item.added",
    requestId,
    sequence_number: sequenceNumber,
    ts: sequenceNumber * 100,
    item: {
      id: `item_${requestId}_${sequenceNumber}`,
      type: "message",
      status: "completed",
      requestId,
      itemIndex: sequenceNumber,
      provenance: {
        blockName: "test-block",
        blockInstanceId: "test-instance",
        phase: "main"
      },
      ts: sequenceNumber * 100,
      role: "assistant",
      content: [{ type: "text", text: `event ${sequenceNumber}` }]
    }
  } as unknown as RequestStreamEvent;
}

/** Build a terminal `request.completed` event. */
export function makeRequestCompletedEvent(
  requestId: string,
  sequenceNumber: number
): RequestStreamEvent {
  return {
    stream: "request",
    type: "request.completed",
    status: "completed",
    requestId,
    sequence_number: sequenceNumber,
    ts: sequenceNumber * 100
  } as unknown as RequestStreamEvent;
}

/**
 * Register the shared `RequestStore.subscribeToEvents` conformance cases
 * against a backend. Call inside a test file's top-level scope.
 */
export function createRequestStoreConformanceTests(
  options: CreateRequestStoreConformanceTestsOptions
): void {
  const { name, createStore, cleanup } = options;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const liveTolerance = Math.max(pollIntervalMs * 3, 200);

  describe(`${name} (RequestStore subscribeToEvents conformance)`, () => {
    async function withStore(
      run: (store: RequestStore) => Promise<void>
    ): Promise<void> {
      const store = await createStore();
      try {
        await run(store);
      } finally {
        if (cleanup !== undefined) await cleanup(store);
      }
    }

    it("catch-up phase yields events strictly greater than fromSequence", async () => {
      await withStore(async (store) => {
        for (let i = 1; i <= 5; i += 1) {
          store.persistEvents("r1", [makeRequestStreamEvent("r1", i)]);
        }
        await store.flushEvents("r1");

        const controller = new AbortController();
        const seen: number[] = [];
        const iter = store.subscribeToEvents("r1", {
          fromSequence: 2,
          signal: controller.signal,
          livenessTimeoutMs: 60_000
        });
        // Give the iterator a chance to drain the catch-up.
        for (let i = 0; i < 3; i += 1) {
          const next = await iter.next();
          if (next.done) break;
          seen.push(next.value.sequence_number);
        }
        controller.abort();
        await iter.return?.();
        expect(seen).toEqual([3, 4, 5]);
      });
    });

    it("live phase yields events as they are persisted, in order", async () => {
      await withStore(async (store) => {
        const controller = new AbortController();
        const iter = store.subscribeToEvents("r1", {
          fromSequence: 0,
          signal: controller.signal,
          livenessTimeoutMs: 60_000
        });

        // Yield to the event loop so the iterator's catch-up phase runs.
        await new Promise((resolve) => setTimeout(resolve, 20));

        const collect: Promise<number[]> = (async () => {
          const out: number[] = [];
          for await (const event of iter) {
            out.push(event.sequence_number);
            if (event.type === "request.completed") break;
          }
          return out;
        })();

        for (let i = 1; i <= 3; i += 1) {
          store.persistEvents("r1", [makeRequestStreamEvent("r1", i)]);
          await store.flushEvents("r1");
          await new Promise((resolve) => setTimeout(resolve, liveTolerance));
        }
        store.persistEvents("r1", [makeRequestCompletedEvent("r1", 4)]);
        await store.flushEvents("r1");

        const seen = await collect;
        controller.abort();
        expect(seen).toEqual([1, 2, 3, 4]);
      });
    });

    it("no duplicates across the catch-up/live boundary", async () => {
      await withStore(async (store) => {
        for (let i = 1; i <= 3; i += 1) {
          store.persistEvents("r1", [makeRequestStreamEvent("r1", i)]);
        }
        await store.flushEvents("r1");

        const controller = new AbortController();
        const iter = store.subscribeToEvents("r1", {
          fromSequence: 0,
          signal: controller.signal,
          livenessTimeoutMs: 60_000
        });

        const collect: Promise<number[]> = (async () => {
          const out: number[] = [];
          for await (const event of iter) {
            out.push(event.sequence_number);
            if (event.type === "request.completed") break;
          }
          return out;
        })();

        // Persist the boundary event after the catch-up is in flight to
        // exercise the handoff. The bus / poll loop must filter it.
        await new Promise((resolve) => setTimeout(resolve, liveTolerance));
        store.persistEvents("r1", [makeRequestStreamEvent("r1", 4)]);
        await store.flushEvents("r1");
        store.persistEvents("r1", [makeRequestCompletedEvent("r1", 5)]);
        await store.flushEvents("r1");

        const seen = await collect;
        controller.abort();
        expect(seen).toEqual([1, 2, 3, 4, 5]);
      });
    });

    it("signal.abort terminates the iterator cleanly", async () => {
      await withStore(async (store) => {
        const controller = new AbortController();
        const iter = store.subscribeToEvents("r1", {
          fromSequence: 0,
          signal: controller.signal,
          livenessTimeoutMs: 60_000
        });
        // Schedule an abort while the iterator is parked.
        setTimeout(() => controller.abort(), liveTolerance);
        const seen: number[] = [];
        for await (const event of iter) {
          seen.push(event.sequence_number);
        }
        expect(seen).toEqual([]);
      });
    });

    it("terminal event ends the iterator after yielding it", async () => {
      await withStore(async (store) => {
        store.persistEvents("r1", [makeRequestStreamEvent("r1", 1)]);
        store.persistEvents("r1", [makeRequestCompletedEvent("r1", 2)]);
        store.persistEvents("r1", [makeRequestStreamEvent("r1", 3)]);
        await store.flushEvents("r1");

        const controller = new AbortController();
        const iter = store.subscribeToEvents("r1", {
          fromSequence: 0,
          signal: controller.signal,
          livenessTimeoutMs: 60_000
        });
        const seen: number[] = [];
        for await (const event of iter) {
          seen.push(event.sequence_number);
        }
        controller.abort();
        // Iterator stops after `request.completed` (seq 2). Event 3 is
        // post-terminal; subscribers don't receive it.
        expect(seen).toEqual([1, 2]);
      });
    });

    it("getEvents with fromSequence returns events strictly greater than the cursor", async () => {
      await withStore(async (store) => {
        for (let i = 1; i <= 5; i += 1) {
          store.persistEvents("r1", [makeRequestStreamEvent("r1", i)]);
        }
        await store.flushEvents("r1");
        const events = await store.getEvents("r1", 3);
        expect(events.map((e) => e.sequence_number)).toEqual([4, 5]);
      });
    });

    it("getEvents without fromSequence returns the full log (backward compat)", async () => {
      await withStore(async (store) => {
        for (let i = 1; i <= 3; i += 1) {
          store.persistEvents("r1", [makeRequestStreamEvent("r1", i)]);
        }
        await store.flushEvents("r1");
        const events = await store.getEvents("r1");
        expect(events.map((e) => e.sequence_number)).toEqual([1, 2, 3]);
      });
    });

    if (!options.skipLivenessTimeout) {
      it("yields a synthetic request.interrupted after livenessTimeoutMs of silence", async () => {
        await withStore(async (store) => {
          store.persistEvents("r1", [makeRequestStreamEvent("r1", 1)]);
          await store.flushEvents("r1");

          const controller = new AbortController();
          const livenessTimeoutMs = Math.max(pollIntervalMs * 2, 150);
          const iter = store.subscribeToEvents("r1", {
            fromSequence: 0,
            signal: controller.signal,
            livenessTimeoutMs
          });
          const seen: RequestStreamEvent[] = [];
          for await (const event of iter) {
            seen.push(event);
            if (event.type === "request.interrupted") break;
          }
          controller.abort();
          expect(seen.at(-1)?.type).toBe("request.interrupted");
          expect((seen.at(-1) as { status?: string }).status).toBe("interrupted");
        });
      }, 10_000);
    }
  });

  // Reference for downstream tests that want to assert overflow behavior
  // directly on the BoundedQueue rather than through the iterator.
  void StoreSubscriptionError;
}
