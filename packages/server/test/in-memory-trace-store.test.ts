import { describe, expect, it } from "vitest";
import {
  createInMemoryTraceStore,
  type TraceEvent
} from "../src/stores";
import { createTraceStoreConformanceTests } from "../src/testing";

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

createTraceStoreConformanceTests({
  name: "InMemoryTraceStore",
  createStore: (options) => createInMemoryTraceStore(options)
});

describe("InMemoryTraceStore (backend-specific)", () => {
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
});
