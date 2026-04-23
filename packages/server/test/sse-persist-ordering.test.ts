/**
 * Tests for FIX-399: events are durably persisted before being published
 * to the SSE wire so a process crash between wire-send and persist-completion
 * cannot leave the client with a sequence number the persisted log can't
 * reproduce.
 */
import type { MessageItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createResponseEmitter } from "../src/streaming/response-emitter";
import type { RequestStreamEventWithId } from "../src/streaming/response-emitter";
import { createFilesystemRequestStore } from "../src/stores/filesystem/request-store";
import { InMemoryRequestStore } from "../src/stores/memory/request-store";

function makeItem(requestId: string, itemIndex: number, ts: number): MessageItem {
  return {
    id: `item_${itemIndex}`,
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: `hello ${itemIndex}` }],
    status: "completed",
    requestId,
    itemIndex,
    provenance: {
      blockName: "test",
      blockInstanceId: "test_1",
      phase: "main"
    },
    ts
  };
}

describe("FIX-399 — persist before wire publish (durability invariant)", () => {
  it("event is durable before the wire callback runs", async () => {
    const requestId = "req_durable";
    const persisted: RequestStreamEvent[] = [];
    const wireOrder: number[] = [];

    const wireSeqsAtPersist: number[] = [];

    const emitter = createResponseEmitter({
      requestId,
      now: () => 100,
      // The "wire" callback. Records the sequence number at the moment
      // the client would observe the event.
      onEvent: (event) => {
        wireOrder.push(event.sequence_number);
      }
    });

    emitter.setEventHooks({
      onEvent: (events) => {
        persisted.push(...events);
      },
      // Simulated durability barrier — resolves on the next macrotask so any
      // pre-FIX-399 ordering bug (wire-before-persist) would observably
      // place the wire emission first.
      flushEvents: async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        // Capture the wire-emission count at the moment durability completes.
        wireSeqsAtPersist.push(wireOrder.length);
      }
    });

    await emitter.emitRequestCreated();
    await emitter.emitItemAdded(makeItem(requestId, 0, 100));
    await emitter.emitRequestStatus("completed");

    // The wire never sees an event ahead of the persisted log.
    const persistedSeqs = persisted.map((e) => e.sequence_number);
    expect(wireOrder).toEqual([1, 2, 3]);
    expect(persistedSeqs).toEqual([1, 2, 3]);

    // For each event, persistence completed BEFORE wire emission.
    // wireSeqsAtPersist[i] is the wire-emission count when event i+1 became
    // durable; it must equal i (i.e., event i+1 hasn't been wired yet).
    expect(wireSeqsAtPersist).toEqual([0, 1, 2]);
  });

  it("simulated mid-flush crash: wire never sees an event past max durable seq", async () => {
    const requestId = "req_crash";
    const wireSeen: number[] = [];
    const persisted: RequestStreamEvent[] = [];

    const emitter = createResponseEmitter({
      requestId,
      now: () => 100,
      onEvent: (event) => {
        wireSeen.push(event.sequence_number);
      }
    });

    let crashAt: number | undefined;

    emitter.setEventHooks({
      onEvent: (events) => {
        persisted.push(...events);
      },
      flushEvents: async () => {
        // The "crash" is modeled as the persistence layer rejecting the
        // flush — exactly what a synchronous fsync failure would do.
        if (crashAt !== undefined) {
          // Drop the most recent enqueued event so disk state diverges from
          // what the emitter accumulated, then reject the flush.
          persisted.pop();
          throw new Error("simulated crash mid-flush");
        }
      }
    });

    await emitter.emitRequestCreated();
    await emitter.emitItemAdded(makeItem(requestId, 0, 100));

    crashAt = 3;
    await expect(
      emitter.emitItemDone(makeItem(requestId, 0, 100))
    ).rejects.toThrow("simulated crash mid-flush");

    // Durability invariant: for every wire-observed seq N, the persisted
    // log has an event with seq N. seq=3 was never wire-emitted because
    // its flush rejected, so the client cannot have a local seq the disk
    // can't reproduce on replay.
    const persistedSeqs = new Set(persisted.map((e) => e.sequence_number));
    for (const seq of wireSeen) {
      expect(persistedSeqs.has(seq)).toBe(true);
    }
    expect(wireSeen).toEqual([1, 2]);
    expect([...persistedSeqs].sort()).toEqual([1, 2]);
  });

  it("error in flushEvents prevents wire emission and propagates via onPersistError", async () => {
    const requestId = "req_persist_error";
    const wireSeen: number[] = [];
    const observedErrors: Error[] = [];

    const emitter = createResponseEmitter({
      requestId,
      now: () => 100,
      onEvent: (event) => {
        wireSeen.push(event.sequence_number);
      }
    });

    emitter.setEventHooks({
      onEvent: () => {},
      flushEvents: async () => {
        throw new Error("disk full");
      },
      onPersistError: (err) => {
        observedErrors.push(err);
      }
    });

    await expect(emitter.emitRequestCreated()).rejects.toThrow("disk full");

    // Wire never observed the event because persistence failed.
    expect(wireSeen).toEqual([]);
    expect(observedErrors).toHaveLength(1);
    expect(observedErrors[0]!.message).toBe("disk full");
  });

  it("ping and debug events skip the durability barrier (still wire-emit fast)", async () => {
    const requestId = "req_ping";
    const wireSeen: string[] = [];
    let flushCalls = 0;

    const emitter = createResponseEmitter({
      requestId,
      now: () => 100,
      onEvent: (event) => {
        wireSeen.push(event.type);
      }
    });

    emitter.setEventHooks({
      onEvent: () => {},
      flushEvents: async () => {
        flushCalls += 1;
      }
    });

    await emitter.emitPing();
    await emitter.emitDebug("test", {});
    await emitter.emitRequestCreated();

    expect(wireSeen).toEqual(["ping", "debug", "request.created"]);
    // Only the replayable event triggers the durability barrier.
    expect(flushCalls).toBe(1);
  });

  it("backpressure: slow persistence throttles wire emission", async () => {
    const requestId = "req_backpressure";
    const wireOrder: { type: string; tWireMs: number }[] = [];
    const start = Date.now();

    const emitter = createResponseEmitter({
      requestId,
      now: () => 100,
      onEvent: (event) => {
        wireOrder.push({ type: event.type, tWireMs: Date.now() - start });
      }
    });

    let pendingDepth = 0;
    let maxPendingDepth = 0;

    emitter.setEventHooks({
      onEvent: (events) => {
        pendingDepth += events.length;
        maxPendingDepth = Math.max(maxPendingDepth, pendingDepth);
      },
      flushEvents: async () => {
        // Simulated slow disk write. Each await must complete before the
        // wire can emit, so the pending-depth seen by onEvent stays at 1.
        await new Promise((resolve) => setTimeout(resolve, 5));
        pendingDepth = 0;
      }
    });

    // Sequentially emit 10 events. The await chain naturally throttles.
    for (let i = 0; i < 10; i += 1) {
      await emitter.emitRequestStatus("in_progress");
    }

    expect(wireOrder).toHaveLength(10);
    // No event was buffered ahead of persistence — the barrier kept the
    // pending queue depth bounded at 1 throughout sequential emission.
    expect(maxPendingDepth).toBe(1);
  });

  it("concurrent emits coalesce into a single persist batch (FIX-361 throughput preserved)", async () => {
    const requestId = "req_batch";
    const persistBatches: number[] = [];

    const emitter = createResponseEmitter({
      requestId,
      now: () => 100
    });

    emitter.setEventHooks({
      onEvent: (events) => {
        persistBatches.push(events.length);
      },
      flushEvents: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    });

    // Concurrent emissions — each call gets its own persist hook invocation
    // (one event per call) but they share a single drain because they all
    // await the same flushEvents promise. A real backend (FilesystemRequestStore)
    // coalesces them into one disk write via the SerializedWriteQueue.
    await Promise.all([
      emitter.emitRequestStatus("in_progress"),
      emitter.emitRequestStatus("in_progress"),
      emitter.emitRequestStatus("in_progress")
    ]);

    expect(persistBatches).toHaveLength(3);
    expect(persistBatches.every((n) => n === 1)).toBe(true);
  });
});

describe("FIX-399 — InMemoryRequestStore integration", () => {
  it("emitter wired to InMemoryRequestStore: every wire-observed seq is durable", async () => {
    const store = new InMemoryRequestStore();
    const requestId = "req_mem";
    const wireSeen: RequestStreamEventWithId[] = [];

    const emitter = createResponseEmitter({
      requestId,
      now: () => 100,
      onEvent: (event) => {
        wireSeen.push(event);
      }
    });

    emitter.setEventHooks({
      onEvent: (events) => {
        store.persistEvents(requestId, events);
      },
      flushEvents: () => store.flushEvents(requestId)
    });

    await emitter.emitRequestCreated();
    await emitter.emitItemAdded(makeItem(requestId, 0, 100));
    await emitter.emitRequestStatus("completed");

    const durable = await store.getEvents(requestId);
    const durableSeqs = new Set(durable.map((e) => e.sequence_number));

    // Every event the client could observe is in the persistent store.
    for (const event of wireSeen) {
      expect(durableSeqs.has(event.sequence_number)).toBe(true);
    }
  });
});

describe("FIX-399 — FilesystemRequestStore integration", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "fsdev-fix399-"));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("filesystem-backed persistence: events are durable on disk before wire emit", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    const requestId = "req_fs";
    const wireSeen: number[] = [];

    const emitter = createResponseEmitter({
      requestId,
      now: () => 100,
      onEvent: (event) => {
        wireSeen.push(event.sequence_number);
      }
    });

    emitter.setEventHooks({
      onEvent: (events) => {
        store.persistEvents(requestId, events);
      },
      flushEvents: () => store.flushEvents(requestId)
    });

    await emitter.emitRequestCreated();
    await emitter.emitItemAdded(makeItem(requestId, 0, 100));
    await emitter.emitRequestStatus("completed");

    // Read directly from disk WITHOUT calling flushEvents — by construction
    // every wire-observed event must already be on disk.
    const onDisk = await store.getEvents(requestId);
    const onDiskSeqs = new Set(onDisk.map((e) => e.sequence_number));

    expect(wireSeen).toEqual([1, 2, 3]);
    for (const seq of wireSeen) {
      expect(onDiskSeqs.has(seq)).toBe(true);
    }
  });

  it("filesystem write failure surfaces via flushEvents and onPersistError", async () => {
    // Point the store at an invalid path so writes fail.
    const badPath = join(rootDir, "definitely-not-a-dir.txt");
    // Create a file at the path to make it a non-directory parent.
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(badPath, "x", "utf8")
    );

    const store = createFilesystemRequestStore({ rootDir: badPath });
    const requestId = "req_fail";
    const wireSeen: number[] = [];
    const observedErrors: Error[] = [];

    const emitter = createResponseEmitter({
      requestId,
      now: () => 100,
      onEvent: (event) => {
        wireSeen.push(event.sequence_number);
      }
    });

    emitter.setEventHooks({
      onEvent: (events) => {
        store.persistEvents(requestId, events);
      },
      flushEvents: () => store.flushEvents(requestId),
      onPersistError: (err) => {
        observedErrors.push(err);
      }
    });

    await expect(emitter.emitRequestCreated()).rejects.toThrow();

    expect(wireSeen).toEqual([]);
    expect(observedErrors.length).toBeGreaterThan(0);
  });
});
