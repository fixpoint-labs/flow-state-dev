/**
 * Shared `RequestStore.subscribeToEvents` conformance suite. Every concrete
 * implementation — memory bus, SQLite poll, filesystem poll, Postgres
 * LISTEN/NOTIFY, PGlite poll — runs this suite via
 * `@flow-state-dev/engine/testing`.
 *
 * Mirrors the `TraceStore` conformance pattern. Polling-tolerance defaults
 * give the SQLite/filesystem/Postgres pollers room to wake up; cross-store
 * cases that need different windows pass `pollIntervalMs`.
 */
import { describe, expect, it } from "vitest";
import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import { StoreSubscriptionError } from "../../errors/store-subscription-error";
import type { RequestRecord, RequestStore } from "../types";

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

/** Build a `request.suspended` event (a stream terminal unless followed through). */
export function makeRequestSuspendedEvent(
  requestId: string,
  sequenceNumber: number
): RequestStreamEvent {
  return {
    stream: "request",
    type: "request.suspended",
    status: "suspended",
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

    it("request.suspended ends the iterator by default", async () => {
      await withStore(async (store) => {
        store.persistEvents("r1", [makeRequestStreamEvent("r1", 1)]);
        store.persistEvents("r1", [makeRequestSuspendedEvent("r1", 2)]);
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
        // Stops after `request.suspended` (seq 2); seq 3 is never delivered.
        expect(seen).toEqual([1, 2]);
      });
    });

    it("followThroughSuspend streams past request.suspended to the real terminal (FIX-811)", async () => {
      await withStore(async (store) => {
        // The pre-suspension run, then the continuation events, then completion.
        store.persistEvents("r1", [makeRequestStreamEvent("r1", 1)]);
        store.persistEvents("r1", [makeRequestSuspendedEvent("r1", 2)]);
        await store.flushEvents("r1");

        const controller = new AbortController();
        const iter = store.subscribeToEvents("r1", {
          fromSequence: 0,
          signal: controller.signal,
          livenessTimeoutMs: 60_000,
          followThroughSuspend: true
        });

        const collect: Promise<number[]> = (async () => {
          const out: number[] = [];
          for await (const event of iter) {
            out.push(event.sequence_number);
            if (event.type === "request.completed") break;
          }
          return out;
        })();

        // The continuation resumes and completes after the subscriber attached.
        await new Promise((resolve) => setTimeout(resolve, liveTolerance));
        store.persistEvents("r1", [makeRequestStreamEvent("r1", 3)]);
        await store.flushEvents("r1");
        store.persistEvents("r1", [makeRequestCompletedEvent("r1", 4)]);
        await store.flushEvents("r1");

        const seen = await collect;
        controller.abort();
        // Followed through the suspension (seq 2) to the continuation + terminal.
        expect(seen).toEqual([1, 2, 3, 4]);
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
          // Synthetic event reuses the last real sequence_number so a
          // reconnecting SSE client doesn't skip a still-in-flight event
          // at lastSeen + 1 (FIX-569 regression).
          expect(seen.at(-1)?.sequence_number).toBe(1);
        });
      }, 10_000);
    }
  });

  describe(`${name} (RequestStore same-request item persistence conformance)`, () => {
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

    // A get-returns-merged check across a same-request continuation (FIX-811).
    // The runtime persists incrementally via `persistItems` AND writes the
    // merged set onto the record at each transition via `set`; both adapter
    // mechanisms (the in-memory record-backed no-op and a persistent store's
    // UPSERT) must surface the full ordered log on a subsequent `get`.
    it("get returns the full ordered item log after a continuation appends items", async () => {
      await withStore(async (store) => {
        const requestId = "req_merge_conformance";
        const pre = [makeItem(requestId, 0), makeItem(requestId, 1)];
        const post = [makeItem(requestId, 2), makeItem(requestId, 3)];

        // Pre-suspension run: persist the pre items and snapshot them onto the
        // record (the suspend transition).
        store.persistItems(requestId, pre);
        await store.flushItems(requestId);
        await store.set(requestId, makeRecord(requestId, "suspended", pre), "any");

        // Continuation: persist the FULL merged set (prior ∪ re-entry) and
        // snapshot it onto the record (the terminal transition).
        const merged = [...pre, ...post];
        store.persistItems(requestId, merged);
        await store.flushItems(requestId);
        await store.set(
          requestId,
          makeRecord(requestId, "completed", merged),
          "any"
        );

        const reread = await store.get(requestId);
        const ids = (reread?.items ?? []).map((item) => item.id);
        expect(ids).toEqual(merged.map((item) => item.id));
        // No id appears twice — the append merges by id, it does not duplicate.
        expect(new Set(ids).size).toBe(ids.length);
      });
    });

    // Re-persisting an item whose fields were mutated IN PLACE (same object
    // reference) must surface the latest content on `get` (FIX-839). The
    // runtime advances a block_trace across its in_progress → completed
    // lifecycle by mutating one item object; a persistence diff keyed on object
    // reference would skip the completed write and leave the store at
    // in_progress, defeating resume memoization. Unlike the merge case above,
    // this reuses ONE object reference across both writes.
    it("re-persisting an in-place-mutated item surfaces its latest content", async () => {
      await withStore(async (store) => {
        const requestId = "req_inplace_conformance";
        const item = makeItem(requestId, 0);

        // Mid-run: persist the item while still in_progress.
        (item as { status: string }).status = "in_progress";
        store.persistItems(requestId, [item]);
        await store.flushItems(requestId);

        // Completion: mutate the SAME object in place, then re-persist and
        // snapshot the record at the transition (persistent stores key off
        // persistItems; the in-memory store keeps items on the record — either
        // way `get` must surface "completed").
        (item as { status: string }).status = "completed";
        store.persistItems(requestId, [item]);
        await store.flushItems(requestId);
        await store.set(requestId, makeRecord(requestId, "suspended", [item]), "any");

        const reread = await store.get(requestId);
        const got = (reread?.items ?? []).find((i) => i.id === item.id);
        expect(got?.status).toBe("completed");
      });
    });
  });

  describe(`${name} (RequestStore countItems conformance)`, () => {
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

    it("returns 0 for an unknown request", async () => {
      await withStore(async (store) => {
        expect(await store.countItems("req_count_missing")).toBe(0);
      });
    });

    // Mirrors the persistence conformance dual-write (persistItems + record
    // snapshot via set) so record-backed and table-backed adapters agree.
    it("counts the persisted item log", async () => {
      await withStore(async (store) => {
        const requestId = "req_count_conformance";
        const items = [
          makeItem(requestId, 0),
          makeItem(requestId, 1),
          makeItem(requestId, 2)
        ];
        store.persistItems(requestId, items);
        await store.flushItems(requestId);
        await store.set(requestId, makeRecord(requestId, "completed", items), "any");

        expect(await store.countItems(requestId)).toBe(3);
      });
    });

    // The count contract is "what get(id).items would contain" — verified
    // across a same-request continuation where the merged log spans two
    // persist waves (FIX-811 union semantics).
    it("matches get().items length across a same-request continuation", async () => {
      await withStore(async (store) => {
        const requestId = "req_count_continuation";
        const pre = [makeItem(requestId, 0), makeItem(requestId, 1)];
        store.persistItems(requestId, pre);
        await store.flushItems(requestId);
        await store.set(requestId, makeRecord(requestId, "suspended", pre), "any");

        const merged = [...pre, makeItem(requestId, 2), makeItem(requestId, 3)];
        store.persistItems(requestId, merged);
        await store.flushItems(requestId);
        await store.set(
          requestId,
          makeRecord(requestId, "completed", merged),
          "any"
        );

        const reread = await store.get(requestId);
        expect(await store.countItems(requestId)).toBe(reread?.items?.length);
        expect(await store.countItems(requestId)).toBe(4);
      });
    });
  });

  // Reference for downstream tests that want to assert overflow behavior
  // directly on the BoundedQueue rather than through the iterator.
  void StoreSubscriptionError;
}

/** Build a minimal `message` `OutputItem` for the persistence conformance cases. */
function makeItem(requestId: string, itemIndex: number): OutputItem {
  return {
    id: `item_${requestId}_${itemIndex}`,
    type: "message",
    status: "completed",
    requestId,
    itemIndex,
    provenance: {
      blockName: "test-block",
      blockInstanceId: `${requestId}:root:0`,
      phase: "main"
    },
    ts: itemIndex * 100,
    role: "assistant",
    content: [{ type: "text", text: `item ${itemIndex}` }]
  } as unknown as OutputItem;
}

/** Build a minimal `RequestRecord` carrying `items`, for the persistence cases. */
function makeRecord(
  requestId: string,
  status: RequestRecord["status"],
  items: OutputItem[]
): RequestRecord {
  const now = Date.now();
  return {
    id: requestId,
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    flowKind: "test-flow",
    actionName: "test-action",
    userId: "u_conformance",
    source: "http",
    status,
    startedAtMs: now,
    items
  };
}
