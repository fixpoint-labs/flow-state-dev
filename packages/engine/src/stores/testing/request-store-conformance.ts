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

  /** Run one case against a fresh store, cleaning it up even when the case throws. */
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

  describe(`${name} (RequestStore subscribeToEvents conformance)`, () => {
    // A request id is the caller's to choose. Between a stream's
    // authorization and any read it makes after an await, the request can be
    // deleted and the id taken by another owner. `isStillAuthorized` is how
    // the caller fences that: a batch read after it no longer holds is never
    // yielded, and the iterator ends.
    describe("incarnation fence", () => {
      const takeOver = async (store: RequestStore, requestId: string): Promise<void> => {
        await store.delete(requestId);
        await store.set(
          requestId,
          { ...makeRecord(requestId, "in_progress", []), userId: "u_bob", incarnation: "inc_bob" },
          "any"
        );
        store.persistEvents(requestId, [
          makeRequestStreamEvent(requestId, 1),
          makeRequestStreamEvent(requestId, 2),
          makeRequestCompletedEvent(requestId, 3)
        ]);
        await store.flushEvents(requestId);
      };
      const drain = async (
        iter: AsyncIterableIterator<RequestStreamEvent>,
        controller: AbortController
      ): Promise<number[]> => {
        const seen: number[] = [];
        const timer = setTimeout(() => controller.abort(), liveTolerance * 3);
        try {
          for (;;) {
            const next = await iter.next();
            if (next.done) break;
            seen.push(next.value.sequence_number);
          }
        } finally {
          clearTimeout(timer);
        }
        return seen;
      };

      it("yields nothing when the id changed hands before the first read", async () => {
        await withStore(async (store) => {
          const requestId = "req_fence_first_read";
          await store.set(
            requestId,
            { ...makeRecord(requestId, "in_progress", []), incarnation: "inc_alice" },
            "any"
          );
          const controller = new AbortController();
          const iter = store.subscribeToEvents(requestId, {
            fromSequence: 0,
            signal: controller.signal,
            livenessTimeoutMs: 60_000,
            isStillAuthorized: async () =>
              (await store.get(requestId))?.incarnation === "inc_alice"
          });

          // The iterator has not read yet: its first read is still pending.
          await takeOver(store, requestId);

          expect(await drain(iter, controller)).toEqual([]);
        });
      });

      it("yields nothing of the new owner's after a later read", async () => {
        await withStore(async (store) => {
          const requestId = "req_fence_later_read";
          await store.set(
            requestId,
            { ...makeRecord(requestId, "in_progress", []), incarnation: "inc_alice" },
            "any"
          );
          store.persistEvents(requestId, [makeRequestStreamEvent(requestId, 1)]);
          await store.flushEvents(requestId);
          const controller = new AbortController();
          const iter = store.subscribeToEvents(requestId, {
            fromSequence: 0,
            signal: controller.signal,
            livenessTimeoutMs: 60_000,
            isStillAuthorized: async () =>
              (await store.get(requestId))?.incarnation === "inc_alice"
          });
          const first = await iter.next();
          expect(first.done ? undefined : first.value.sequence_number).toBe(1);

          // Alice's request is deleted and Bob's takes the id before the
          // stream's next read.
          await takeOver(store, requestId);

          expect(await drain(iter, controller)).toEqual([]);
        });
      });
    });

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

  // Request ids are caller-supplied, so a later request may take a deleted
  // one. Nothing the deleted run left under the id may reach it.
  describe(`${name} (RequestStore delete conformance)`, () => {
    it("delete removes the request's events and runOnce results with the record", async () => {
      await withStore(async (store) => {
        const requestId = "req_delete_children";
        await store.set(requestId, makeRecord(requestId, "completed", []), "any");
        store.persistEvents(requestId, [
          makeRequestStreamEvent(requestId, 1),
          makeRequestCompletedEvent(requestId, 2)
        ]);
        await store.flushEvents(requestId);
        await store.setRunOnceResult(requestId, "step", { owner: "previous" });

        await store.delete(requestId);

        expect(await store.get(requestId)).toBeUndefined();
        expect(await store.getEvents(requestId)).toEqual([]);
        expect(await store.getRunOnceResult(requestId, "step")).toEqual({ found: false });
      });
    });

    it("delete is not undone by events persisted just before it", async () => {
      await withStore(async (store) => {
        const requestId = "req_delete_queued";
        await store.set(requestId, makeRecord(requestId, "completed", []), "any");
        // No flush: the write is still queued when delete runs.
        store.persistEvents(requestId, [makeRequestStreamEvent(requestId, 1)]);

        await store.delete(requestId);
        await store.flushEvents(requestId);

        expect(await store.getEvents(requestId)).toEqual([]);
      });
    });

    it("delete leaves other requests' events in place", async () => {
      await withStore(async (store) => {
        store.persistEvents("req_delete_other", [makeRequestStreamEvent("req_delete_other", 1)]);
        await store.flushEvents("req_delete_other");

        await store.delete("req_delete_target");

        const kept = await store.getEvents("req_delete_other");
        expect(kept.map((e) => e.sequence_number)).toEqual([1]);
      });
    });

    it("delete leaves the runOnce results of an id that merely starts with it", async () => {
      // Request ids are caller-supplied. Deleting "foo" must not reach a
      // result stored for "foo.runonce.bar": losing it would let that
      // request's step run a second time.
      await withStore(async (store) => {
        await store.set("foo", makeRecord("foo", "completed", []), "any");
        await store.set(
          "foo.runonce.bar",
          makeRecord("foo.runonce.bar", "completed", []),
          "any"
        );
        await store.setRunOnceResult("foo", "step", { owner: "foo" });
        await store.setRunOnceResult("foo.runonce.bar", "step", { owner: "bar" });

        await store.delete("foo");

        expect(await store.getRunOnceResult("foo.runonce.bar", "step")).toEqual({
          found: true,
          value: { owner: "bar" }
        });
        expect(await store.getRunOnceResult("foo", "step")).toEqual({ found: false });
      });
    });
  });

  describe(`${name} (RequestStore incarnation conformance)`, () => {
    // A request's incarnation is its identity: the engine stamps it once and
    // every later context reads it back from here. An adapter that dropped it
    // on write or on list would make every read of a record look like a
    // legacy one, and a retry could open a new, empty run workspace.
    it("carries a record's incarnation through set, get and list", async () => {
      await withStore(async (store) => {
        const requestId = "req_incarnation_conformance";
        const record = { ...makeRecord(requestId, "in_progress", []), incarnation: "inc_conformance" };
        await store.set(requestId, record, "absent");
        await store.set(requestId, { ...record, status: "completed", updatedAt: record.updatedAt + 1 }, "any");

        expect((await store.get(requestId))?.incarnation).toBe("inc_conformance");
        const listed = await store.list({ userId: "u_conformance" });
        expect(listed.find((r) => r.id === requestId)?.incarnation).toBe("inc_conformance");
      });
    });
  });

  describe(`${name} (RequestStore action-result conformance)`, () => {
    // The action's result rides the final status write (FIX-1661), and the
    // session request list is where a client reads it. An adapter that kept
    // only its indexed columns, or dropped a nested value, would leave every
    // finished request reading as "no result recorded".
    it("carries a record's result through set, get and list", async () => {
      await withStore(async (store) => {
        const requestId = "req_result_conformance";
        const record = makeRecord(requestId, "in_progress", []);
        const result = {
          output: { ok: false, error: "task is cancelled", nested: [1, { deep: null }] },
          error: { code: "execution_error", message: "hook failed" }
        };
        await store.set(requestId, record, "absent");
        await store.set(requestId, { ...record, status: "failed", updatedAt: record.updatedAt + 1, result }, "any");

        expect((await store.get(requestId))?.result).toEqual(result);
        const listed = await store.list({ userId: "u_conformance" });
        expect(listed.find((r) => r.id === requestId)?.result).toEqual(result);
      });
    });

    it("lists a record written without a result with the field absent", async () => {
      await withStore(async (store) => {
        const requestId = "req_result_legacy_conformance";
        const record = makeRecord(requestId, "completed", []);
        await store.set(requestId, record, "absent");

        expect((await store.get(requestId))?.result == null).toBe(true);
        const listed = await store.list({ userId: "u_conformance" });
        expect(listed.find((r) => r.id === requestId)?.result == null).toBe(true);
      });
    });
  });

  describe(`${name} (RequestStore abort-intent conformance)`, () => {
    /** Seed an `in_progress` record with no abort intent. */
    async function seed(
      store: RequestStore,
      requestId: string,
      status: RequestRecord["status"] = "in_progress",
      items: OutputItem[] = []
    ): Promise<void> {
      await store.set(requestId, makeRecord(requestId, status, items), "any");
    }

    describe("isAbortRequested", () => {
      it("returns false for an unknown request", async () => {
        await withStore(async (store) => {
          expect(await store.isAbortRequested("req_abort_missing")).toBe(false);
        });
      });

      it("returns false when the flag was never set", async () => {
        await withStore(async (store) => {
          await seed(store, "req_abort_absent");
          expect(await store.isAbortRequested("req_abort_absent")).toBe(false);
        });
      });

      it("returns true once the conditional write sets the flag", async () => {
        await withStore(async (store) => {
          const requestId = "req_abort_set";
          await seed(store, requestId);

          const result = await store.setFieldsIfStatus(
            requestId,
            { abortRequested: true },
            ["in_progress"],
            Date.now()
          );

          expect(result.applied).toBe(true);
          expect(await store.isAbortRequested(requestId)).toBe(true);
        });
      });

      // A cross-adapter consistency claim, not an adapter detail. Adapters that
      // keep the flag on the record get this for free; one that stores it
      // beside the record has to overlay it onto listed records too, or the
      // same request reads as cancelled through `get` and not cancelled
      // through `list` — including through the session request-list endpoint.
      it("agrees with list() on the same record", async () => {
        await withStore(async (store) => {
          const requestId = "req_abort_list_agrees";
          await seed(store, requestId);
          await store.setFieldsIfStatus(
            requestId,
            { abortRequested: true },
            ["in_progress"],
            Date.now()
          );

          const listed = (await store.list()).find((r) => r.id === requestId);
          expect(listed).toBeDefined();
          expect(listed?.abortRequested).toBe(true);
          expect(listed?.abortRequested).toBe(
            (await store.get(requestId))?.abortRequested
          );
        });
      });

      it("agrees with get() on the same record", async () => {
        await withStore(async (store) => {
          const requestId = "req_abort_agrees";
          await seed(store, requestId);
          expect((await store.get(requestId))?.abortRequested).not.toBe(true);

          await store.setFieldsIfStatus(
            requestId,
            { abortRequested: true },
            ["in_progress"],
            Date.now()
          );

          expect(await store.isAbortRequested(requestId)).toBe(true);
          expect((await store.get(requestId))?.abortRequested).toBe(true);
        });
      });

      // The case that proves the read is narrow. An adapter that answers this
      // by loading the record deserializes the whole item array on every
      // heartbeat tick — the quadratic cost this method exists to remove. The
      // shape is asserted here; the bound itself is the interface contract.
      it("reads the flag on a record carrying a large item set", async () => {
        await withStore(async (store) => {
          const requestId = "req_abort_many_items";
          const items = Array.from({ length: 250 }, (_unused, index) =>
            makeItem(requestId, index)
          );
          store.persistItems(requestId, items);
          await store.flushItems(requestId);
          await seed(store, requestId, "in_progress", items);

          expect(await store.isAbortRequested(requestId)).toBe(false);

          await store.setFieldsIfStatus(
            requestId,
            { abortRequested: true },
            ["in_progress"],
            Date.now()
          );

          expect(await store.isAbortRequested(requestId)).toBe(true);
          // The item history is untouched by the abort write.
          expect((await store.get(requestId))?.items?.length).toBe(250);
        });
      });
    });

    describe("setFieldsIfStatus", () => {
      it("applies the fields when the predicate holds", async () => {
        await withStore(async (store) => {
          const requestId = "req_cond_applies";
          await seed(store, requestId);

          const result = await store.setFieldsIfStatus(
            requestId,
            { abortRequested: true },
            ["in_progress"],
            Date.now()
          );

          expect(result).toEqual({ applied: true, status: "in_progress" });
        });
      });

      // The resurrection case. A version predicate cannot express this, which
      // is why the verb exists: terminal writes persist `version` unchanged, so
      // a CAS validates after the terminal commit and restores a dead record.
      it("does not apply on a terminal status, and reports the status it found", async () => {
        await withStore(async (store) => {
          const requestId = "req_cond_terminal";
          await seed(store, requestId, "completed");

          const result = await store.setFieldsIfStatus(
            requestId,
            { abortRequested: true },
            ["in_progress"],
            Date.now()
          );

          expect(result).toEqual({ applied: false, status: "completed" });
          expect(await store.isAbortRequested(requestId)).toBe(false);
          // The record is not resurrected to the predicated status.
          expect((await store.get(requestId))?.status).toBe("completed");
          // A not-applied result must never name a status inside the predicate:
          // that combination is self-contradictory, and a caller turning it into
          // an error emits nonsense like `409 … terminal state "in_progress"`.
          // It is what an adapter produces when the status it reports comes
          // from a read that is not the same observation as the write.
          expect(["in_progress"]).not.toContain(result.status);
        });
      });

      it("does not apply to an unknown request and reports no status", async () => {
        await withStore(async (store) => {
          const result = await store.setFieldsIfStatus(
            "req_cond_missing",
            { abortRequested: true },
            ["in_progress"],
            Date.now()
          );

          expect(result).toEqual({ applied: false, status: undefined });
          expect(await store.get("req_cond_missing")).toBeUndefined();
        });
      });

      // The identity fence. A caller that checked who owns the record passes
      // that record's incarnation, so the write lands only on the request the
      // check read: never on another request that took the id afterwards, and
      // never missing the checked one because a same-owner hand-off rewrote
      // its `createdAt`. A record written before incarnations existed answers
      // to `legacy_<createdAt>`, spelled out here rather than read from the
      // engine's helper, so a store that states the rule in its own query
      // language is held to the same string.
      describe("identity fence (expectedIncarnation)", () => {
        const stamped = (
          requestId: string,
          incarnation: string | null | undefined,
          createdAt: number
        ): RequestRecord => ({
          ...makeRecord(requestId, "in_progress", []),
          createdAt,
          updatedAt: createdAt,
          startedAtMs: createdAt,
          ...(incarnation === undefined ? {} : { incarnation: incarnation as string })
        });

        async function fenced(store: RequestStore, requestId: string, expected: string) {
          return store.setFieldsIfStatus(
            requestId,
            { abortRequested: true },
            ["in_progress"],
            Date.now(),
            expected
          );
        }

        it("reports a request with another incarnation as absent, even with the same createdAt", async () => {
          await withStore(async (store) => {
            const requestId = "req_fence_same_ms";
            await store.set(requestId, stamped(requestId, "inc_newer", 1_000), "any");

            const missed = await fenced(store, requestId, "inc_checked");
            expect(missed).toEqual({ applied: false, status: undefined });
            expect(await store.isAbortRequested(requestId)).toBe(false);
          });
        });

        it("applies to the same incarnation even when createdAt was rewritten", async () => {
          await withStore(async (store) => {
            const requestId = "req_fence_handed_off";
            // What a same-owner hand-off leaves: a new createdAt, the kept incarnation.
            await store.set(requestId, stamped(requestId, "inc_kept", 2_000), "any");

            const hit = await fenced(store, requestId, "inc_kept");
            expect(hit).toEqual({ applied: true, status: "in_progress" });
            expect(await store.isAbortRequested(requestId)).toBe(true);
          });
        });

        it("fences a legacy record on legacy_<createdAt>", async () => {
          await withStore(async (store) => {
            const requestId = "req_fence_legacy";
            await store.set(requestId, stamped(requestId, undefined, 1_000), "any");

            expect(await fenced(store, requestId, "legacy_1001")).toEqual({
              applied: false,
              status: undefined
            });
            expect(await store.isAbortRequested(requestId)).toBe(false);
            expect(await fenced(store, requestId, "legacy_1000")).toEqual({
              applied: true,
              status: "in_progress"
            });
          });
        });

        it("fences a handed-off legacy record on the value it stores, not its new createdAt", async () => {
          await withStore(async (store) => {
            const requestId = "req_fence_legacy_handed_off";
            await store.set(requestId, stamped(requestId, "legacy_1000", 2_000), "any");

            expect(await fenced(store, requestId, "legacy_2000")).toEqual({
              applied: false,
              status: undefined
            });
            expect(await fenced(store, requestId, "legacy_1000")).toEqual({
              applied: true,
              status: "in_progress"
            });
          });
        });

        it("never matches a stamped request to a legacy fence", async () => {
          await withStore(async (store) => {
            const requestId = "req_fence_stamped_vs_legacy";
            await store.set(requestId, stamped(requestId, "inc_new", 1_000), "any");

            expect(await fenced(store, requestId, "legacy_1000")).toEqual({
              applied: false,
              status: undefined
            });
            expect(await store.isAbortRequested(requestId)).toBe(false);
          });
        });

        it("treats a null incarnation as absent", async () => {
          await withStore(async (store) => {
            const requestId = "req_fence_null";
            await store.set(requestId, stamped(requestId, null, 1_000), "any");

            expect(await fenced(store, requestId, "legacy_1000")).toEqual({
              applied: true,
              status: "in_progress"
            });
          });
        });

        it("reports the terminal status, not absence, when the incarnation matches", async () => {
          await withStore(async (store) => {
            const requestId = "req_fence_terminal";
            await store.set(
              requestId,
              { ...stamped(requestId, "inc_done", 1_000), status: "completed" },
              "any"
            );

            expect(await fenced(store, requestId, "inc_done")).toEqual({
              applied: false,
              status: "completed"
            });
          });
        });
      });

      // The same fence on the request's identity. Two records under one id can
      // share a millisecond, so only the incarnation tells them apart.
      it("reports a record with another incarnation as absent, even in the same millisecond", async () => {
        await withStore(async (store) => {
          const requestId = "req_cond_incarnation";
          const record = { ...makeRecord(requestId, "completed", []), incarnation: "inc_now" };
          await store.set(requestId, record, "any");

          const missed = await store.setFieldsIfStatus(
            requestId,
            { finalizedAtMs: 1 },
            ["completed"],
            Date.now(),
            "inc_before"
          );
          expect(missed).toEqual({ applied: false, status: undefined });
          expect((await store.get(requestId))?.finalizedAtMs).toBeUndefined();

          const hit = await store.setFieldsIfStatus(
            requestId,
            { finalizedAtMs: 1 },
            ["completed"],
            Date.now(),
            "inc_now"
          );
          expect(hit).toEqual({ applied: true, status: "completed" });
          expect((await store.get(requestId))?.finalizedAtMs).toBe(1);
        });
      });

      // A record written before incarnations were stamped answers to the one
      // derived from its `createdAt` (BP-030).
      it("fences a record with no stored incarnation on legacy_<createdAt>", async () => {
        await withStore(async (store) => {
          const requestId = "req_cond_incarnation_legacy";
          await seed(store, requestId, "completed");
          const { createdAt } = (await store.get(requestId))!;

          const missed = await store.setFieldsIfStatus(
            requestId, { finalizedAtMs: 1 }, ["completed"], Date.now(), "inc_other"
          );
          expect(missed).toEqual({ applied: false, status: undefined });

          const hit = await store.setFieldsIfStatus(
            requestId, { finalizedAtMs: 1 }, ["completed"], Date.now(), `legacy_${createdAt}`
          );
          expect(hit).toEqual({ applied: true, status: "completed" });
        });
      });

      it("matches any status in the predicate list", async () => {
        await withStore(async (store) => {
          const requestId = "req_cond_multi";
          await seed(store, requestId, "suspended");

          const result = await store.setFieldsIfStatus(
            requestId,
            { abortRequested: true },
            ["in_progress", "suspended"],
            Date.now()
          );

          expect(result.applied).toBe(true);
          expect(await store.isAbortRequested(requestId)).toBe(true);
        });
      });

      it("writes a field that is not the abort flag", async () => {
        await withStore(async (store) => {
          const requestId = "req_cond_general";
          await seed(store, requestId);

          const result = await store.setFieldsIfStatus(
            requestId,
            { interruptedAt: 4242 },
            ["in_progress"],
            Date.now()
          );

          expect(result.applied).toBe(true);
          expect((await store.get(requestId))?.interruptedAt).toBe(4242);
        });
      });

      // The record's own `updatedAt` must move with the write, not just any
      // indexed column an adapter keeps beside it. An adapter that advances
      // only its column leaves `get()` reporting the old timestamp — list
      // ordering and the record disagree, and a later full-record write built
      // from `get()` carries the stale value back and moves the column
      // BACKWARD.
      it("advances the record's updatedAt", async () => {
        await withStore(async (store) => {
          const requestId = "req_cond_updated_at";
          await seed(store, requestId);
          const before = await store.get(requestId);
          expect(before?.updatedAt).toBeTypeOf("number");

          const stamp = (before as RequestRecord).updatedAt + 5_000;
          const result = await store.setFieldsIfStatus(
            requestId,
            { abortRequested: true },
            ["in_progress"],
            stamp
          );
          expect(result.applied).toBe(true);

          const after = await store.get(requestId);
          expect(after?.updatedAt).toBe(stamp);
        });
      });

      it("clears the flag when written false", async () => {
        await withStore(async (store) => {
          const requestId = "req_cond_clear";
          await seed(store, requestId);
          await store.setFieldsIfStatus(
            requestId,
            { abortRequested: true },
            ["in_progress"],
            Date.now()
          );
          expect(await store.isAbortRequested(requestId)).toBe(true);

          await store.setFieldsIfStatus(
            requestId,
            { abortRequested: false },
            ["in_progress"],
            Date.now()
          );

          expect(await store.isAbortRequested(requestId)).toBe(false);
          expect((await store.get(requestId))?.abortRequested).not.toBe(true);
        });
      });
    });

    // The pair that pins `abortRequested` leaving `set`'s write surface. Both
    // directions matter: one-directional preservation is a monotonic
    // "never lower a stored true" rule wearing a different hat, and that rule
    // makes undelivered intent permanent.
    describe("set ignores abortRequested", () => {
      it("does not clear a stored flag when the written record omits it", async () => {
        await withStore(async (store) => {
          const requestId = "req_set_omits";
          await seed(store, requestId);
          await store.setFieldsIfStatus(
            requestId,
            { abortRequested: true },
            ["in_progress"],
            Date.now()
          );

          // A worker's full-record write, built from a snapshot taken before
          // the flag was set. This is all six full-record writers.
          const stale = makeRecord(requestId, "in_progress", []);
          expect(stale.abortRequested).toBeUndefined();
          await store.set(requestId, stale, "any");

          expect(await store.isAbortRequested(requestId)).toBe(true);
          expect((await store.get(requestId))?.abortRequested).toBe(true);
        });
      });

      it("does not set the flag when the written record carries it", async () => {
        await withStore(async (store) => {
          const requestId = "req_set_carries";
          await seed(store, requestId);

          await store.set(
            requestId,
            { ...makeRecord(requestId, "in_progress", []), abortRequested: true },
            "any"
          );

          expect(await store.isAbortRequested(requestId)).toBe(false);
          expect((await store.get(requestId))?.abortRequested).not.toBe(true);
        });
      });

      it("does not clear a stored flag on a record created carrying it", async () => {
        await withStore(async (store) => {
          const requestId = "req_set_create";
          await store.set(
            requestId,
            { ...makeRecord(requestId, "in_progress", []), abortRequested: true },
            "any"
          );
          // Creation cannot set it either — `set` is inert in both directions.
          expect(await store.isAbortRequested(requestId)).toBe(false);

          await store.setFieldsIfStatus(
            requestId,
            { abortRequested: true },
            ["in_progress"],
            Date.now()
          );
          // ...and a later full-record write still cannot clear it.
          await store.set(requestId, makeRecord(requestId, "in_progress", []), "any");
          expect(await store.isAbortRequested(requestId)).toBe(true);
        });
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
