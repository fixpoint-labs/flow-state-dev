import { describe, expect, it } from "vitest";
import {
  createInMemoryTraceStore,
  type TraceEvent
} from "../src/stores";

function makeEvent(
  requestId: string,
  sequenceNumber: number,
  ts: number,
  itemId = `item_${sequenceNumber}`,
  filler = ""
): TraceEvent {
  return {
    requestId,
    sequenceNumber,
    ts,
    type: "trace.item.added",
    item: {
      type: "block_debug",
      itemId,
      ts,
      blockName: "test-block",
      phase: "started",
      payload: { filler }
    } as TraceEvent["item"]
  };
}

describe("InMemoryTraceStore", () => {
  it("appendEvent then getEvents round-trips events", async () => {
    const store = createInMemoryTraceStore();
    await store.appendEvent("r1", makeEvent("r1", 1, 100));
    await store.appendEvent("r1", makeEvent("r1", 2, 101));
    await store.appendEvent("r1", makeEvent("r1", 3, 102));

    const events = await store.getEvents("r1");
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.sequenceNumber)).toEqual([1, 2, 3]);
  });

  it("getEvents with fromSequence filters strictly greater than the cursor", async () => {
    const store = createInMemoryTraceStore();
    for (let i = 1; i <= 5; i += 1) {
      await store.appendEvent("r1", makeEvent("r1", i, 100 + i));
    }
    const events = await store.getEvents("r1", 2);
    expect(events.map((e) => e.sequenceNumber)).toEqual([3, 4, 5]);
  });

  it("getEvents returns [] for unknown request id", async () => {
    const store = createInMemoryTraceStore();
    expect(await store.getEvents("nope")).toEqual([]);
  });

  it("listRequestIds returns request ids in insertion order", async () => {
    const store = createInMemoryTraceStore();
    await store.appendEvent("r3", makeEvent("r3", 1, 100));
    await store.appendEvent("r1", makeEvent("r1", 1, 101));
    await store.appendEvent("r2", makeEvent("r2", 1, 102));
    expect(await store.listRequestIds()).toEqual(["r3", "r1", "r2"]);
  });

  it("evicts oldest request when maxRequests exceeded", async () => {
    const store = createInMemoryTraceStore({ maxRequests: 2 });
    await store.appendEvent("r1", makeEvent("r1", 1, 100));
    await store.appendEvent("r2", makeEvent("r2", 1, 101));
    await store.appendEvent("r3", makeEvent("r3", 1, 102));

    expect(await store.listRequestIds()).toEqual(["r2", "r3"]);
    expect(await store.getEvents("r1")).toEqual([]);
  });

  it("drops oldest events when per-request byte cap exceeded", async () => {
    const probe = makeEvent("r1", 1, 100, "i1", "x".repeat(200));
    const eventBytes = Buffer.byteLength(JSON.stringify(probe), "utf8");
    // Cap fits ~2 events worth.
    const store = createInMemoryTraceStore({ maxBytesPerRequest: eventBytes * 2 + 8 });

    for (let i = 1; i <= 5; i += 1) {
      await store.appendEvent("r1", makeEvent("r1", i, 100 + i, `i${i}`, "x".repeat(200)));
    }

    const events = await store.getEvents("r1");
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThan(5);
    // Newest events are retained — the highest sequence number must still be present.
    expect(events[events.length - 1]!.sequenceNumber).toBe(5);
    // Oldest events must have been dropped.
    expect(events[0]!.sequenceNumber).toBeGreaterThan(1);
  });

  it("flush is a no-op", async () => {
    const store = createInMemoryTraceStore();
    await store.appendEvent("r1", makeEvent("r1", 1, 100));
    await store.flush("r1");
    expect(await store.getEvents("r1")).toHaveLength(1);
  });
});
