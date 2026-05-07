import { describe, expect, it } from "vitest";
import { createInMemoryTraceStore } from "../src/stores";
import {
  createTraceStoreConformanceTests,
  makeTraceEvent
} from "../src/testing";

createTraceStoreConformanceTests({
  name: "InMemoryTraceStore",
  createStore: (options) => createInMemoryTraceStore(options)
});

describe("InMemoryTraceStore (backend-specific)", () => {
  it("drops oldest events when per-request byte cap exceeded", async () => {
    const probe = makeTraceEvent("r1", 1, { payload: { filler: "x".repeat(200) } });
    const eventBytes = Buffer.byteLength(JSON.stringify(probe), "utf8");
    const store = createInMemoryTraceStore({ maxBytesPerRequest: eventBytes * 2 + 8 });

    for (let i = 1; i <= 5; i += 1) {
      await store.appendEvent(
        "r1",
        makeTraceEvent("r1", i, { payload: { filler: "x".repeat(200) } })
      );
    }

    const events = await store.getEvents("r1");
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThan(5);
    expect(events[events.length - 1]!.sequenceNumber).toBe(5);
    expect(events[0]!.sequenceNumber).toBeGreaterThan(1);
  });
});
