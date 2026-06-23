/**
 * Pure-data tests for the request-stream store — no React renderer needed.
 * Covers binary insertion, dedup, snapshot application, ownership, delta
 * accumulation/flush, content add/done (message + reasoning + overwrite),
 * item patches, canonical collapse, and the status/sequence/status-event layer.
 */
import { describe, expect, it } from "vitest";
import type { OutputItem, RequestStatusEvent } from "@flow-state-dev/core/items";
import {
  compareItemOrder,
  createRequestStreamStore
} from "../src/stream-client/request-stream-store";

function makeItem(overrides: Partial<OutputItem> & { id: string }): OutputItem {
  return {
    type: "message",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" as const },
    ts: 1000,
    ...overrides
  } as OutputItem;
}

function makeStatusEvent(overrides: Partial<RequestStatusEvent> = {}): RequestStatusEvent {
  return {
    stream: "request",
    type: "request.in_progress",
    requestId: "req_1",
    sequence_number: 1,
    ts: 1000,
    status: "in_progress",
    ...overrides
  } as RequestStatusEvent;
}

// ---------------------------------------------------------------------------
// compareItemOrder
// ---------------------------------------------------------------------------

describe("compareItemOrder", () => {
  it("sorts by ts ascending", () => {
    const a = makeItem({ id: "a", ts: 100 });
    const b = makeItem({ id: "b", ts: 200 });
    expect(compareItemOrder(a, b)).toBeLessThan(0);
    expect(compareItemOrder(b, a)).toBeGreaterThan(0);
  });

  it("uses itemIndex as tiebreaker when ts is equal", () => {
    const a = makeItem({ id: "a", ts: 100, itemIndex: 1 });
    const b = makeItem({ id: "b", ts: 100, itemIndex: 2 });
    expect(compareItemOrder(a, b)).toBeLessThan(0);
    expect(compareItemOrder(b, a)).toBeGreaterThan(0);
  });

  it("returns zero for identical ordering keys", () => {
    const a = makeItem({ id: "a", ts: 100, itemIndex: 1 });
    const b = makeItem({ id: "b", ts: 100, itemIndex: 1 });
    expect(compareItemOrder(a, b)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// upsert
// ---------------------------------------------------------------------------

describe("createRequestStreamStore — upsert", () => {
  it("inserts a new item and returns true", () => {
    const store = createRequestStreamStore();
    const item = makeItem({ id: "a", ts: 100 });
    expect(store.upsert(item)).toBe(true);
    expect(store.getSorted()).toEqual([item]);
    expect(store.size()).toBe(1);
  });

  it("maintains sorted order across multiple inserts", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "b", ts: 200 }));
    store.upsert(makeItem({ id: "a", ts: 100 }));
    store.upsert(makeItem({ id: "c", ts: 300 }));
    expect(store.getSorted().map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("deduplicates: value-only update returns false", () => {
    const store = createRequestStreamStore();
    const item = makeItem({ id: "a", ts: 100, itemIndex: 0 });
    store.upsert(item);
    const updated = makeItem({ id: "a", ts: 100, itemIndex: 0, status: "in_progress" as OutputItem["status"] });
    expect(store.upsert(updated)).toBe(false);
    expect(store.getById("a")!.status).toBe("in_progress");
    expect(store.size()).toBe(1);
  });

  it("reorders when ts/itemIndex changes and returns true", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "a", ts: 100 }));
    store.upsert(makeItem({ id: "b", ts: 200 }));
    expect(store.upsert(makeItem({ id: "a", ts: 300 }))).toBe(true);
    expect(store.getSorted().map((i) => i.id)).toEqual(["b", "a"]);
  });
});

// ---------------------------------------------------------------------------
// applyItemPatch
// ---------------------------------------------------------------------------

describe("createRequestStreamStore — applyItemPatch", () => {
  it("shallow-merges a patch into an existing item and returns true", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "a", ts: 100, status: "in_progress" as OutputItem["status"] }));
    expect(store.applyItemPatch("a", { status: "completed" })).toBe(true);
    expect(store.getById("a")!.status).toBe("completed");
  });

  it("strips identity-invariant keys before merging", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "a", ts: 100, type: "message" }));
    store.applyItemPatch("a", {
      id: "hijacked",
      type: "status",
      provenance: { blockName: "x" },
      itemVisibility: "internal",
      transient: true,
      status: "completed"
    });
    const updated = store.getById("a")!;
    expect(updated.id).toBe("a");
    expect(updated.type).toBe("message");
    expect(updated.status).toBe("completed");
  });

  it("returns false (no-op) for an unknown item id", () => {
    const store = createRequestStreamStore();
    expect(store.applyItemPatch("missing", { status: "completed" })).toBe(false);
  });

  it("returns false for a patch that is entirely invariant keys (no real change)", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "a", ts: 100, type: "message" }));
    expect(store.applyItemPatch("a", { id: "x", type: "status", provenance: { blockName: "y" } })).toBe(false);
    // The item is unchanged.
    expect(store.getById("a")!.type).toBe("message");
  });

  it("re-sorts when a patch changes a sort key (ts)", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "a", ts: 100 }));
    store.upsert(makeItem({ id: "b", ts: 200 }));
    // Move "a" after "b" via a patch.
    store.applyItemPatch("a", { ts: 300 });
    expect(store.getSorted().map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("re-indexes ownership when a patch changes ownedBy", () => {
    const store = createRequestStreamStore();
    const item = makeItem({ id: "a", ts: 100 });
    (item as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";
    store.upsert(item);
    expect(store.getOwnedBy("scope-1")).toHaveLength(1);

    store.applyItemPatch("a", { ownedBy: "scope-2" });
    expect(store.getOwnedBy("scope-1")).toHaveLength(0);
    expect(store.getOwnedBy("scope-2")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// deleteById
// ---------------------------------------------------------------------------

describe("createRequestStreamStore — deleteById", () => {
  it("removes an existing item and returns true", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "a", ts: 100 }));
    expect(store.deleteById("a")).toBe(true);
    expect(store.size()).toBe(0);
    expect(store.getSorted()).toEqual([]);
  });

  it("returns false for a non-existent id", () => {
    const store = createRequestStreamStore();
    expect(store.deleteById("missing")).toBe(false);
  });

  it("removes from ownership index", () => {
    const store = createRequestStreamStore();
    const item = makeItem({ id: "a", ts: 100 });
    (item as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";
    store.upsert(item);
    expect(store.getOwnedBy("scope-1")).toHaveLength(1);
    store.deleteById("a");
    expect(store.getOwnedBy("scope-1")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// loadSnapshot
// ---------------------------------------------------------------------------

describe("createRequestStreamStore — loadSnapshot", () => {
  it("replaces all items with the snapshot", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "old", ts: 50 }));

    store.loadSnapshot([makeItem({ id: "a", ts: 100 }), makeItem({ id: "b", ts: 200 })]);

    expect(store.size()).toBe(2);
    expect(store.getById("old")).toBeUndefined();
    expect(store.getSorted().map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("rebuilds ownership index from snapshot", () => {
    const store = createRequestStreamStore();
    const items = [makeItem({ id: "a", ts: 100 }), makeItem({ id: "b", ts: 200 })];
    (items[0] as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";
    (items[1] as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";

    store.loadSnapshot(items);
    expect(store.getOwnedBy("scope-1")).toHaveLength(2);
  });

  it("clears pending deltas", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "a", ts: 100, type: "message", content: [{ type: "output_text", text: "hi" }] } as Partial<OutputItem> & { id: string }));
    store.accumulateDelta("a", 0, " world");
    store.loadSnapshot([makeItem({ id: "b", ts: 200 })]);
    expect(store.flushDeltas()).toBe(false);
  });

  it("leaves the status/sequence layer untouched", () => {
    const store = createRequestStreamStore();
    store.setStatus("completed");
    store.recordSequence(7);
    store.loadSnapshot([makeItem({ id: "a", ts: 100 })]);
    expect(store.status).toBe("completed");
    expect(store.lastSequenceNumber).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe("createRequestStreamStore — clear", () => {
  it("empties items and resets the status/sequence/status-event layer", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "a", ts: 100 }));
    store.accumulateDelta("a", 0, "delta");
    store.setStatus("completed");
    store.recordSequence(5);
    store.recordStatusEvent(makeStatusEvent({ type: "request.completed", status: "completed" }));

    store.clear();

    expect(store.size()).toBe(0);
    expect(store.getSorted()).toEqual([]);
    expect(store.flushDeltas()).toBe(false);
    expect(store.status).toBe("in_progress");
    expect(store.lastSequenceNumber).toBe(0);
    expect(store.statusEvents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getOwnedBy
// ---------------------------------------------------------------------------

describe("createRequestStreamStore — getOwnedBy", () => {
  it("returns items matching the owner", () => {
    const store = createRequestStreamStore();
    const a = makeItem({ id: "a", ts: 100 });
    (a as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";
    const b = makeItem({ id: "b", ts: 200 });
    (b as OutputItem & { ownedBy?: string }).ownedBy = "scope-2";
    const c = makeItem({ id: "c", ts: 300 });
    (c as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";

    store.upsert(a);
    store.upsert(b);
    store.upsert(c);

    expect(store.getOwnedBy("scope-1").map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("returns sorted results", () => {
    const store = createRequestStreamStore();
    const a = makeItem({ id: "a", ts: 300 });
    (a as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";
    const b = makeItem({ id: "b", ts: 100 });
    (b as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";

    store.upsert(a);
    store.upsert(b);

    expect(store.getOwnedBy("scope-1").map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("returns empty array for unknown owner", () => {
    const store = createRequestStreamStore();
    expect(store.getOwnedBy("unknown")).toEqual([]);
  });

  it("cleans up old ownership when ownedBy changes on upsert", () => {
    const store = createRequestStreamStore();
    const item = makeItem({ id: "a", ts: 100 });
    (item as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";
    store.upsert(item);
    expect(store.getOwnedBy("scope-1")).toHaveLength(1);

    const updated = makeItem({ id: "a", ts: 100 });
    (updated as OutputItem & { ownedBy?: string }).ownedBy = "scope-2";
    store.upsert(updated);
    expect(store.getOwnedBy("scope-1")).toHaveLength(0);
    expect(store.getOwnedBy("scope-2")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// deltas (message + reasoning)
// ---------------------------------------------------------------------------

describe("createRequestStreamStore — deltas", () => {
  it("accumulates and flushes text deltas to a message item", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "msg1", ts: 100, type: "message", content: [{ type: "output_text", text: "Hello" }] } as Partial<OutputItem> & { id: string }));

    store.accumulateDelta("msg1", 0, " world");
    store.accumulateDelta("msg1", 0, "!");

    expect(store.flushDeltas()).toBe(true);
    const updated = store.getById("msg1")! as OutputItem & { content?: Array<{ type: string; text: string }> };
    expect(updated.content![0]!.text).toBe("Hello world!");
  });

  it("accumulates reasoning_text deltas into the summary array", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "r1", ts: 100, type: "reasoning", summary: [{ type: "reasoning_text", text: "Think" }] } as Partial<OutputItem> & { id: string }));

    store.accumulateDelta("r1", 0, "ing...");
    expect(store.flushDeltas()).toBe(true);
    const updated = store.getById("r1")! as OutputItem & { summary?: Array<{ type: string; text: string }> };
    expect(updated.summary![0]!.text).toBe("Thinking...");
  });

  it("concatenates multiple deltas for the same key before flushing", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "msg1", ts: 100, type: "message", content: [{ type: "output_text", text: "" }] } as Partial<OutputItem> & { id: string }));

    store.accumulateDelta("msg1", 0, "A");
    store.accumulateDelta("msg1", 0, "B");
    store.accumulateDelta("msg1", 0, "C");

    store.flushDeltas();
    const updated = store.getById("msg1")! as OutputItem & { content?: Array<{ type: string; text: string }> };
    expect(updated.content![0]!.text).toBe("ABC");
  });

  it("returns false when nothing to flush", () => {
    const store = createRequestStreamStore();
    expect(store.flushDeltas()).toBe(false);
  });

  it("returns false when delta target item is missing", () => {
    const store = createRequestStreamStore();
    store.accumulateDelta("missing", 0, "data");
    expect(store.flushDeltas()).toBe(false);
  });

  it("applies a delta buffered before its item.added once the item arrives", () => {
    // content.delta can arrive before item.added; the buffered delta survives
    // the interleaved upsert and is applied on the next flush.
    const store = createRequestStreamStore();
    store.accumulateDelta("msg1", 0, " world");
    store.upsert(makeItem({ id: "msg1", ts: 100, type: "message", content: [{ type: "output_text", text: "Hello" }] } as Partial<OutputItem> & { id: string }));

    expect(store.flushDeltas()).toBe(true);
    const updated = store.getById("msg1")! as OutputItem & { content?: Array<{ type: string; text: string }> };
    expect(updated.content![0]!.text).toBe("Hello world");
  });

  it("keeps a buffered delta when the target content part isn't ready, then applies it once content.added creates the part", () => {
    // item.added can arrive with an empty content array before content.added
    // creates index 0. A flush in between must not drop the buffered delta.
    const store = createRequestStreamStore();
    store.accumulateDelta("msg1", 0, "Hi");
    store.upsert(makeItem({ id: "msg1", ts: 100, type: "message", content: [] } as Partial<OutputItem> & { id: string }));

    expect(store.flushDeltas()).toBe(false); // part not ready — delta kept buffered

    store.applyContentAdded("msg1", 0, { type: "output_text", text: "" });
    expect(store.flushDeltas()).toBe(true); // part now exists — delta applies
    const updated = store.getById("msg1")! as OutputItem & { content?: Array<{ type: string; text: string }> };
    expect(updated.content![0]!.text).toBe("Hi");
  });
});

// ---------------------------------------------------------------------------
// applyContentAdded (message + reasoning + overwrite-index)
// ---------------------------------------------------------------------------

describe("createRequestStreamStore — applyContentAdded", () => {
  it("appends content to a message item", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "msg1", ts: 100, type: "message", content: [{ type: "output_text", text: "first" }] } as Partial<OutputItem> & { id: string }));

    expect(store.applyContentAdded("msg1", 1, { type: "output_text", text: "second" })).toBe(true);
    const updated = store.getById("msg1")! as OutputItem & { content?: Array<{ type: string; text: string }> };
    expect(updated.content).toHaveLength(2);
    expect(updated.content![1]!.text).toBe("second");
  });

  it("appends content to a reasoning item's summary array", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "r1", ts: 100, type: "reasoning", summary: [{ type: "reasoning_text", text: "a" }] } as Partial<OutputItem> & { id: string }));

    expect(store.applyContentAdded("r1", 1, { type: "reasoning_text", text: "b" })).toBe(true);
    const updated = store.getById("r1")! as OutputItem & { summary?: Array<{ type: string; text: string }> };
    expect(updated.summary).toHaveLength(2);
    expect(updated.summary![1]!.text).toBe("b");
  });

  it("overwrites an already-populated index", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "msg1", ts: 100, type: "message", content: [{ type: "output_text", text: "old" }] } as Partial<OutputItem> & { id: string }));

    expect(store.applyContentAdded("msg1", 0, { type: "output_text", text: "new" })).toBe(true);
    const updated = store.getById("msg1")! as OutputItem & { content?: Array<{ type: string; text: string }> };
    expect(updated.content).toHaveLength(1);
    expect(updated.content![0]!.text).toBe("new");
  });

  it("returns false for non-existent item", () => {
    const store = createRequestStreamStore();
    expect(store.applyContentAdded("missing", 0, { type: "output_text", text: "x" })).toBe(false);
  });

  it("returns false for items without a content array", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "status1", ts: 100, type: "status" }));
    expect(store.applyContentAdded("status1", 0, { type: "output_text", text: "x" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyContentDone
// ---------------------------------------------------------------------------

describe("createRequestStreamStore — applyContentDone", () => {
  it("replaces an accumulated part with the authoritative final content", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "msg1", ts: 100, type: "message", content: [{ type: "output_text", text: "partial" }] } as Partial<OutputItem> & { id: string }));

    expect(store.applyContentDone("msg1", 0, { type: "output_text", text: "final" })).toBe(true);
    const updated = store.getById("msg1")! as OutputItem & { content?: Array<{ type: string; text: string }> };
    expect(updated.content![0]!.text).toBe("final");
  });

  it("inserts the part when no prior content exists at that index", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "msg1", ts: 100, type: "message", content: [] } as Partial<OutputItem> & { id: string }));

    expect(store.applyContentDone("msg1", 0, { type: "output_text", text: "only" })).toBe(true);
    const updated = store.getById("msg1")! as OutputItem & { content?: Array<{ type: string; text: string }> };
    expect(updated.content).toHaveLength(1);
    expect(updated.content![0]!.text).toBe("only");
  });

  it("returns false for an unknown item id", () => {
    const store = createRequestStreamStore();
    expect(store.applyContentDone("missing", 0, { type: "output_text", text: "x" })).toBe(false);
  });

  it("drops buffered deltas so a later flush cannot append stale text on top", () => {
    // RAF-batch ordering: deltas buffer, then content.done lands in the same
    // frame, then a single flushDeltas runs. The buffered deltas must not be
    // re-applied over the authoritative final content.
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "msg1", ts: 100, type: "message", content: [{ type: "output_text", text: "" }] } as Partial<OutputItem> & { id: string }));

    store.accumulateDelta("msg1", 0, "Hel");
    store.accumulateDelta("msg1", 0, "lo");
    store.applyContentDone("msg1", 0, { type: "output_text", text: "Hello" });

    expect(store.flushDeltas()).toBe(false); // queue was cleared by content.done
    const updated = store.getById("msg1")! as OutputItem & { content?: Array<{ type: string; text: string }> };
    expect(updated.content![0]!.text).toBe("Hello");
  });
});

// ---------------------------------------------------------------------------
// getById / getSorted identity
// ---------------------------------------------------------------------------

describe("createRequestStreamStore — getById", () => {
  it("returns the item when it exists", () => {
    const store = createRequestStreamStore();
    const item = makeItem({ id: "a", ts: 100 });
    store.upsert(item);
    expect(store.getById("a")).toBe(item);
  });

  it("returns undefined for missing id", () => {
    const store = createRequestStreamStore();
    expect(store.getById("missing")).toBeUndefined();
  });
});

describe("createRequestStreamStore — getSorted identity", () => {
  it("returns a new array on each call", () => {
    const store = createRequestStreamStore();
    store.upsert(makeItem({ id: "a", ts: 100 }));
    const first = store.getSorted();
    const second = store.getSorted();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});

// ---------------------------------------------------------------------------
// canonical collapse (Rule 3: crash-recovery re-run)
// ---------------------------------------------------------------------------

describe("createRequestStreamStore — canonical collapse (crash recovery)", () => {
  it("drops a re-run block's run-1 emission when it ran twice with no suspension_resume", () => {
    const gate = "req_1:root/step[0]:0";
    const prov = { blockName: "gate", blockInstanceId: gate, phase: "main" as const };
    const store = createRequestStreamStore();
    store.loadSnapshot([
      makeItem({ id: "t1", type: "block_trace", status: "in_progress", itemIndex: 0, ts: 1000, provenance: prov }),
      makeItem({ id: "m1", type: "message", itemIndex: 1, ts: 1001, provenance: prov }),
      makeItem({ id: "t2", type: "block_trace", status: "completed", itemIndex: 2, ts: 1002, provenance: prov }),
      makeItem({ id: "m2", type: "message", itemIndex: 3, ts: 1003, provenance: prov })
    ]);

    const ids = store.getSorted().map((i) => i.id);
    expect(ids).toContain("m2");
    expect(ids).not.toContain("m1");
    expect(ids).toContain("t2");
    expect(ids).not.toContain("t1");
  });

  it("leaves a single-run block untouched", () => {
    const gate = "req_1:root/step[0]:0";
    const prov = { blockName: "gate", blockInstanceId: gate, phase: "main" as const };
    const store = createRequestStreamStore();
    store.loadSnapshot([
      makeItem({ id: "t1", type: "block_trace", status: "completed", itemIndex: 0, ts: 1000, provenance: prov }),
      makeItem({ id: "m1", type: "message", itemIndex: 1, ts: 1001, provenance: prov })
    ]);
    expect(store.getSorted().map((i) => i.id)).toEqual(["t1", "m1"]);
  });
});

// ---------------------------------------------------------------------------
// status / sequence / status-event layer
// ---------------------------------------------------------------------------

describe("createRequestStreamStore — status/sequence layer", () => {
  it("defaults status to in_progress", () => {
    const store = createRequestStreamStore();
    expect(store.status).toBe("in_progress");
  });

  it("records the latest status via setStatus", () => {
    const store = createRequestStreamStore();
    store.setStatus("completed");
    expect(store.status).toBe("completed");
  });

  it("advances lastSequenceNumber via recordSequence", () => {
    const store = createRequestStreamStore();
    expect(store.lastSequenceNumber).toBe(0);
    store.recordSequence(3);
    store.recordSequence(9);
    expect(store.lastSequenceNumber).toBe(9);
  });

  it("keeps lastSequenceNumber monotonic (a lower out-of-order value does not move it back)", () => {
    const store = createRequestStreamStore();
    store.recordSequence(9);
    store.recordSequence(3);
    expect(store.lastSequenceNumber).toBe(9);
  });

  it("appends every status event in arrival order", () => {
    const store = createRequestStreamStore();
    store.recordStatusEvent(makeStatusEvent({ type: "request.in_progress", status: "in_progress", sequence_number: 1 }));
    store.recordStatusEvent(makeStatusEvent({ type: "request.completed", status: "completed", sequence_number: 5 }));
    expect(store.statusEvents.map((e) => e.status)).toEqual(["in_progress", "completed"]);
  });

  it("returns an isolated copy of statusEvents (mutating it does not corrupt internal state)", () => {
    const store = createRequestStreamStore();
    store.recordStatusEvent(makeStatusEvent({ type: "request.in_progress", status: "in_progress" }));
    const snapshot = store.statusEvents;
    (snapshot as RequestStatusEvent[]).push(makeStatusEvent({ type: "request.completed", status: "completed" }));
    expect(store.statusEvents).toHaveLength(1);
  });
});
