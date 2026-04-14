import { describe, expect, it } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { RequestRecord } from "../src/stores/types";
import { createInMemoryStores } from "../src/stores";
import {
  isItemExpired,
  stripExpiredItems,
  stripExpiredFromRecord
} from "../src/execution/item-ttl";

/**
 * Creates a minimal OutputItem for testing TTL behavior.
 */
function makeItem(
  id: string,
  opts: { ts: number; ttl?: number; transient?: boolean }
): OutputItem {
  return {
    id,
    type: "message",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "inst", phase: "main" },
    ts: opts.ts,
    ttl: opts.ttl,
    transient: opts.transient,
    role: "assistant",
    content: [{ type: "output_text", text: `item-${id}` }],
  } as OutputItem;
}

function makeRequestRecord(
  id: string,
  items: OutputItem[]
): RequestRecord {
  return {
    id,
    flowKind: "test-flow",
    actionName: "run",
    userId: "user1",
    sessionId: "sess_1",
    status: "completed",
    startedAtMs: 1000,
    completedAtMs: 2000,
    state: {},
    version: 1,
    createdAt: 1000,
    updatedAt: 2000,
    items,
  };
}

describe("isItemExpired", () => {
  it("returns false when no TTL set", () => {
    const item = makeItem("a", { ts: 1000 });
    expect(isItemExpired(item, 999_999)).toBe(false);
  });

  it("returns false when TTL has not yet expired", () => {
    const item = makeItem("a", { ts: 1000, ttl: 5000 });
    // ts + ttl = 6000; now = 5999 → not expired
    expect(isItemExpired(item, 5999)).toBe(false);
  });

  it("returns false at exact expiry boundary (not yet past)", () => {
    const item = makeItem("a", { ts: 1000, ttl: 5000 });
    // ts + ttl = 6000; now = 6000 → not expired (< not <=)
    expect(isItemExpired(item, 6000)).toBe(false);
  });

  it("returns true when TTL has expired", () => {
    const item = makeItem("a", { ts: 1000, ttl: 5000 });
    // ts + ttl = 6000; now = 6001 → expired
    expect(isItemExpired(item, 6001)).toBe(true);
  });

  it("returns true when TTL is 0 and time has advanced", () => {
    const item = makeItem("a", { ts: 1000, ttl: 0 });
    // ts + ttl = 1000; now = 1001 → expired
    expect(isItemExpired(item, 1001)).toBe(true);
  });

  it("returns false when TTL is 0 at exact emission time", () => {
    const item = makeItem("a", { ts: 1000, ttl: 0 });
    // ts + ttl = 1000; now = 1000 → not expired (boundary)
    expect(isItemExpired(item, 1000)).toBe(false);
  });
});

describe("stripExpiredItems", () => {
  it("returns all items when none have TTL", () => {
    const items = [
      makeItem("a", { ts: 1000 }),
      makeItem("b", { ts: 2000 }),
    ];
    const result = stripExpiredItems(items, 999_999);
    expect(result).toHaveLength(2);
  });

  it("filters only expired items, preserves non-expired and no-TTL items", () => {
    const items = [
      makeItem("no-ttl", { ts: 1000 }),
      makeItem("fresh", { ts: 5000, ttl: 10_000 }), // expires at 15000
      makeItem("stale", { ts: 1000, ttl: 2000 }),    // expires at 3000
    ];
    const result = stripExpiredItems(items, 10_000);
    expect(result.map(i => i.id)).toEqual(["no-ttl", "fresh"]);
  });

  it("returns empty array when all items are expired", () => {
    const items = [
      makeItem("a", { ts: 100, ttl: 100 }),
      makeItem("b", { ts: 200, ttl: 100 }),
    ];
    const result = stripExpiredItems(items, 999_999);
    expect(result).toEqual([]);
  });

  it("handles empty array", () => {
    expect(stripExpiredItems([], 1000)).toEqual([]);
  });
});

describe("stripExpiredFromRecord", () => {
  it("returns record unchanged when items is undefined", () => {
    const record = makeRequestRecord("req_1", []);
    delete (record as any).items;
    const result = stripExpiredFromRecord(record, 999_999);
    expect(result).toBe(record); // same reference
  });

  it("returns record unchanged when no items are expired", () => {
    const items = [
      makeItem("a", { ts: 1000 }),
      makeItem("b", { ts: 2000, ttl: 999_000 }),
    ];
    const record = makeRequestRecord("req_1", items);
    const result = stripExpiredFromRecord(record, 5000);
    expect(result).toBe(record); // same reference — no copy needed
  });

  it("strips expired items and returns a new record", () => {
    const items = [
      makeItem("keep", { ts: 1000 }),
      makeItem("expired", { ts: 1000, ttl: 1000 }),
    ];
    const record = makeRequestRecord("req_1", items);
    const result = stripExpiredFromRecord(record, 5000);
    expect(result).not.toBe(record);
    expect(result.items).toHaveLength(1);
    expect(result.items![0].id).toBe("keep");
  });
});

describe("store adapter integration", () => {
  it("InMemoryRequestStore.get strips expired items", async () => {
    const stores = createInMemoryStores();
    const items = [
      makeItem("keep", { ts: 5000 }),
      makeItem("expired", { ts: 1000, ttl: 1000 }), // expires at 2000
    ];
    const record = makeRequestRecord("req_1", items);
    await stores.request.set("req_1", record);

    const result = await stores.request.get("req_1");
    expect(result).toBeDefined();
    // The expired item (ts: 1000 + ttl: 1000 = 2000) should be gone
    // since Date.now() is well past 2000
    expect(result!.items!.every(i => i.id !== "expired")).toBe(true);
  });

  it("InMemoryRequestStore.list strips expired items", async () => {
    const stores = createInMemoryStores();
    const items = [
      makeItem("keep", { ts: Date.now() }),
      makeItem("expired", { ts: 1000, ttl: 1000 }), // long expired
    ];
    const record = makeRequestRecord("req_1", items);
    await stores.request.set("req_1", record);

    const results = await stores.request.list();
    expect(results).toHaveLength(1);
    expect(results[0].items!.every(i => i.id !== "expired")).toBe(true);
  });

  it("preserves items with future TTL expiry", async () => {
    const stores = createInMemoryStores();
    const futureTs = Date.now();
    const items = [
      makeItem("fresh", { ts: futureTs, ttl: 86_400_000 }), // 1 day TTL
    ];
    const record = makeRequestRecord("req_1", items);
    await stores.request.set("req_1", record);

    const result = await stores.request.get("req_1");
    expect(result!.items).toHaveLength(1);
    expect(result!.items![0].id).toBe("fresh");
  });

  it("mixed items: no-TTL, unexpired TTL, expired TTL, transient", async () => {
    const stores = createInMemoryStores();
    const now = Date.now();
    const items = [
      makeItem("permanent", { ts: 1000 }),                          // no TTL — kept
      makeItem("fresh-ttl", { ts: now, ttl: 86_400_000 }),          // future expiry — kept
      makeItem("stale-ttl", { ts: 1000, ttl: 1000 }),               // expired — stripped
      makeItem("transient-item", { ts: now, transient: true }),      // transient — kept in store (filtered elsewhere)
    ];
    const record = makeRequestRecord("req_1", items);
    await stores.request.set("req_1", record);

    const result = await stores.request.get("req_1");
    const ids = result!.items!.map(i => i.id);
    expect(ids).toContain("permanent");
    expect(ids).toContain("fresh-ttl");
    expect(ids).not.toContain("stale-ttl");
    // transient items are stored in-memory (filtering happens at persistence time in runAction)
    expect(ids).toContain("transient-item");
  });
});
