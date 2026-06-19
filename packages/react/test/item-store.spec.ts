/**
 * Pure-data tests for the item store — no React renderer needed.
 * Covers binary insertion, dedup, snapshot application, ownership,
 * delta accumulation/flush, and the standalone insertSortedIntoArray helper.
 */
import { describe, expect, it } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import {
  compareItemOrder,
  createItemStore,
  insertSortedIntoArray
} from "../src/internal/item-store";

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
// insertSortedIntoArray
// ---------------------------------------------------------------------------

describe("insertSortedIntoArray", () => {
  it("inserts into empty array", () => {
    const item = makeItem({ id: "a", ts: 100 });
    const result = insertSortedIntoArray([], item);
    expect(result).toEqual([item]);
  });

  it("appends at tail when item is latest (fast path)", () => {
    const a = makeItem({ id: "a", ts: 100 });
    const b = makeItem({ id: "b", ts: 200 });
    const result = insertSortedIntoArray([a], b);
    expect(result.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("inserts before existing item when out of order", () => {
    const a = makeItem({ id: "a", ts: 200 });
    const b = makeItem({ id: "b", ts: 100 });
    const result = insertSortedIntoArray([a], b);
    expect(result.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("handles itemIndex tiebreak during insertion", () => {
    const a = makeItem({ id: "a", ts: 100, itemIndex: 0 });
    const c = makeItem({ id: "c", ts: 100, itemIndex: 2 });
    const b = makeItem({ id: "b", ts: 100, itemIndex: 1 });
    const result = insertSortedIntoArray([a, c], b);
    expect(result.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("returns a new array (does not mutate input)", () => {
    const a = makeItem({ id: "a", ts: 100 });
    const original = [a];
    const result = insertSortedIntoArray(original, makeItem({ id: "b", ts: 200 }));
    expect(result).not.toBe(original);
    expect(original).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// createItemStore — upsert
// ---------------------------------------------------------------------------

describe("createItemStore — upsert", () => {
  it("inserts a new item and returns true", () => {
    const store = createItemStore();
    const item = makeItem({ id: "a", ts: 100 });
    expect(store.upsert(item)).toBe(true);
    expect(store.getSorted()).toEqual([item]);
    expect(store.size()).toBe(1);
  });

  it("maintains sorted order across multiple inserts", () => {
    const store = createItemStore();
    store.upsert(makeItem({ id: "b", ts: 200 }));
    store.upsert(makeItem({ id: "a", ts: 100 }));
    store.upsert(makeItem({ id: "c", ts: 300 }));
    expect(store.getSorted().map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("deduplicates: value-only update returns false", () => {
    const store = createItemStore();
    const item = makeItem({ id: "a", ts: 100, itemIndex: 0 });
    store.upsert(item);
    const updated = makeItem({ id: "a", ts: 100, itemIndex: 0, status: "in_progress" as OutputItem["status"] });
    expect(store.upsert(updated)).toBe(false);
    expect(store.getById("a")!.status).toBe("in_progress");
    expect(store.size()).toBe(1);
  });

  it("reorders when ts/itemIndex changes and returns true", () => {
    const store = createItemStore();
    store.upsert(makeItem({ id: "a", ts: 100 }));
    store.upsert(makeItem({ id: "b", ts: 200 }));
    // Move "a" to after "b"
    expect(store.upsert(makeItem({ id: "a", ts: 300 }))).toBe(true);
    expect(store.getSorted().map((i) => i.id)).toEqual(["b", "a"]);
  });
});

// ---------------------------------------------------------------------------
// createItemStore — deleteById
// ---------------------------------------------------------------------------

describe("createItemStore — deleteById", () => {
  it("removes an existing item and returns true", () => {
    const store = createItemStore();
    store.upsert(makeItem({ id: "a", ts: 100 }));
    expect(store.deleteById("a")).toBe(true);
    expect(store.size()).toBe(0);
    expect(store.getSorted()).toEqual([]);
  });

  it("returns false for a non-existent id", () => {
    const store = createItemStore();
    expect(store.deleteById("missing")).toBe(false);
  });

  it("removes from ownership index", () => {
    const store = createItemStore();
    const item = makeItem({ id: "a", ts: 100 });
    (item as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";
    store.upsert(item);
    expect(store.getOwnedBy("scope-1")).toHaveLength(1);
    store.deleteById("a");
    expect(store.getOwnedBy("scope-1")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createItemStore — loadSnapshot
// ---------------------------------------------------------------------------

describe("createItemStore — loadSnapshot", () => {
  it("replaces all items with the snapshot", () => {
    const store = createItemStore();
    store.upsert(makeItem({ id: "old", ts: 50 }));

    const items = [
      makeItem({ id: "a", ts: 100 }),
      makeItem({ id: "b", ts: 200 })
    ];
    store.loadSnapshot(items);

    expect(store.size()).toBe(2);
    expect(store.getById("old")).toBeUndefined();
    expect(store.getSorted().map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("rebuilds ownership index from snapshot", () => {
    const store = createItemStore();
    const items = [
      makeItem({ id: "a", ts: 100 }),
      makeItem({ id: "b", ts: 200 })
    ];
    (items[0] as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";
    (items[1] as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";

    store.loadSnapshot(items);
    expect(store.getOwnedBy("scope-1")).toHaveLength(2);
  });

  it("clears pending deltas", () => {
    const store = createItemStore();
    store.upsert(makeItem({ id: "a", ts: 100, type: "message", content: [{ type: "output_text", text: "hi" }] } as Partial<OutputItem> & { id: string }));
    store.accumulateDelta("a", 0, " world");
    store.loadSnapshot([makeItem({ id: "b", ts: 200 })]);
    // flush should be no-op since deltas were cleared
    expect(store.flushDeltas()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createItemStore — clear
// ---------------------------------------------------------------------------

describe("createItemStore — clear", () => {
  it("empties the store completely", () => {
    const store = createItemStore();
    store.upsert(makeItem({ id: "a", ts: 100 }));
    store.accumulateDelta("a", 0, "delta");
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.getSorted()).toEqual([]);
    expect(store.flushDeltas()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createItemStore — getOwnedBy
// ---------------------------------------------------------------------------

describe("createItemStore — getOwnedBy", () => {
  it("returns items matching the owner", () => {
    const store = createItemStore();
    const a = makeItem({ id: "a", ts: 100 });
    (a as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";
    const b = makeItem({ id: "b", ts: 200 });
    (b as OutputItem & { ownedBy?: string }).ownedBy = "scope-2";
    const c = makeItem({ id: "c", ts: 300 });
    (c as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";

    store.upsert(a);
    store.upsert(b);
    store.upsert(c);

    const owned = store.getOwnedBy("scope-1");
    expect(owned.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("returns sorted results", () => {
    const store = createItemStore();
    const a = makeItem({ id: "a", ts: 300 });
    (a as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";
    const b = makeItem({ id: "b", ts: 100 });
    (b as OutputItem & { ownedBy?: string }).ownedBy = "scope-1";

    store.upsert(a);
    store.upsert(b);

    expect(store.getOwnedBy("scope-1").map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("returns empty array for unknown owner", () => {
    const store = createItemStore();
    expect(store.getOwnedBy("unknown")).toEqual([]);
  });

  it("cleans up old ownership when ownedBy changes on upsert", () => {
    const store = createItemStore();
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
// createItemStore — delta accumulation and flush
// ---------------------------------------------------------------------------

describe("createItemStore — deltas", () => {
  it("accumulates and flushes text deltas to a message item", () => {
    const store = createItemStore();
    const item = makeItem({
      id: "msg1",
      ts: 100,
      type: "message",
      content: [{ type: "output_text", text: "Hello" }]
    } as Partial<OutputItem> & { id: string });
    store.upsert(item);

    store.accumulateDelta("msg1", 0, " world");
    store.accumulateDelta("msg1", 0, "!");

    expect(store.flushDeltas()).toBe(true);

    const updated = store.getById("msg1")! as OutputItem & { content?: Array<{ type: string; text: string }> };
    expect(updated.content![0]!.text).toBe("Hello world!");
  });

  it("concatenates multiple deltas for the same key before flushing", () => {
    const store = createItemStore();
    const item = makeItem({
      id: "msg1",
      ts: 100,
      type: "message",
      content: [{ type: "output_text", text: "" }]
    } as Partial<OutputItem> & { id: string });
    store.upsert(item);

    store.accumulateDelta("msg1", 0, "A");
    store.accumulateDelta("msg1", 0, "B");
    store.accumulateDelta("msg1", 0, "C");

    store.flushDeltas();
    const updated = store.getById("msg1")! as OutputItem & { content?: Array<{ type: string; text: string }> };
    expect(updated.content![0]!.text).toBe("ABC");
  });

  it("returns false when nothing to flush", () => {
    const store = createItemStore();
    expect(store.flushDeltas()).toBe(false);
  });

  it("returns false when delta target item is missing", () => {
    const store = createItemStore();
    store.accumulateDelta("missing", 0, "data");
    expect(store.flushDeltas()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createItemStore — applyContentAdded
// ---------------------------------------------------------------------------

describe("createItemStore — applyContentAdded", () => {
  it("appends content to a message item", () => {
    const store = createItemStore();
    const item = makeItem({
      id: "msg1",
      ts: 100,
      type: "message",
      content: [{ type: "output_text", text: "first" }]
    } as Partial<OutputItem> & { id: string });
    store.upsert(item);

    const newContent = { type: "output_text" as const, text: "second" };
    expect(store.applyContentAdded("msg1", 1, newContent)).toBe(true);

    const updated = store.getById("msg1")! as OutputItem & { content?: Array<{ type: string; text: string }> };
    expect(updated.content).toHaveLength(2);
    expect(updated.content![1]!.text).toBe("second");
  });

  it("returns false for non-existent item", () => {
    const store = createItemStore();
    expect(store.applyContentAdded("missing", 0, { type: "output_text", text: "x" })).toBe(false);
  });

  it("returns false for non-message items", () => {
    const store = createItemStore();
    const item = makeItem({ id: "status1", ts: 100, type: "status" });
    store.upsert(item);
    expect(store.applyContentAdded("status1", 0, { type: "output_text", text: "x" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createItemStore — getById
// ---------------------------------------------------------------------------

describe("createItemStore — getById", () => {
  it("returns the item when it exists", () => {
    const store = createItemStore();
    const item = makeItem({ id: "a", ts: 100 });
    store.upsert(item);
    expect(store.getById("a")).toBe(item);
  });

  it("returns undefined for missing id", () => {
    const store = createItemStore();
    expect(store.getById("missing")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createItemStore — getSorted returns new array
// ---------------------------------------------------------------------------

describe("createItemStore — getSorted identity", () => {
  it("returns a new array on each call", () => {
    const store = createItemStore();
    store.upsert(makeItem({ id: "a", ts: 100 }));
    const first = store.getSorted();
    const second = store.getSorted();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});

// ---------------------------------------------------------------------------
// createItemStore — canonical collapse (Rule 3: crash-recovery re-run)
// ---------------------------------------------------------------------------

describe("createItemStore — canonical collapse (crash recovery)", () => {
  it("drops a re-run block's run-1 emission when it ran twice with no suspension_resume", () => {
    // The crash-recovery `continue` path re-runs the in-flight block with no
    // suspension_resume marker; only a second block_trace signals the re-run.
    // getSorted() must collapse to the surviving run's emission (Rule 3),
    // matching the core canonical view — otherwise useSession shows both copies.
    const gate = "req_1:root/step[0]:0";
    const prov = { blockName: "gate", blockInstanceId: gate, phase: "main" as const };
    const store = createItemStore();
    store.loadSnapshot([
      makeItem({ id: "t1", type: "block_trace", status: "in_progress", itemIndex: 0, ts: 1000, provenance: prov }),
      makeItem({ id: "m1", type: "message", itemIndex: 1, ts: 1001, provenance: prov }),
      makeItem({ id: "t2", type: "block_trace", status: "completed", itemIndex: 2, ts: 1002, provenance: prov }),
      makeItem({ id: "m2", type: "message", itemIndex: 3, ts: 1003, provenance: prov })
    ]);

    const ids = store.getSorted().map((i) => i.id);
    expect(ids).toContain("m2"); // run-2 emission (canonical)
    expect(ids).not.toContain("m1"); // run-1 emission (superseded)
    expect(ids).toContain("t2"); // canonical trace
    expect(ids).not.toContain("t1"); // superseded trace
  });

  it("leaves a single-run block untouched", () => {
    const gate = "req_1:root/step[0]:0";
    const prov = { blockName: "gate", blockInstanceId: gate, phase: "main" as const };
    const store = createItemStore();
    store.loadSnapshot([
      makeItem({ id: "t1", type: "block_trace", status: "completed", itemIndex: 0, ts: 1000, provenance: prov }),
      makeItem({ id: "m1", type: "message", itemIndex: 1, ts: 1001, provenance: prov })
    ]);
    const ids = store.getSorted().map((i) => i.id);
    expect(ids).toEqual(["t1", "m1"]);
  });
});
