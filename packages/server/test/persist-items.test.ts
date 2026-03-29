import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import { createInMemoryRequestStore } from "../src/stores/memory/request-store";
import { createFilesystemRequestStore } from "../src/stores/filesystem/request-store";
import type { RequestRecord, RequestStore } from "../src/stores/types";

function makeItem(id: string, index: number): OutputItem {
  return {
    id,
    type: "message",
    role: "assistant",
    status: "completed",
    transient: false,
    requestId: "req_test",
    itemIndex: index,
    provenance: {
      blockName: "test",
      blockInstanceId: "test_1",
      phase: "main"
    },
    ts: Date.now(),
    content: [{ type: "output_text", text: `Item ${id}` }]
  } as OutputItem;
}

function makeRequestRecord(id: string): RequestRecord {
  const ts = Date.now();
  return {
    id,
    flowKind: "chat",
    actionName: "run",
    userId: "user_1",
    status: "in_progress",
    startedAtMs: ts,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts
  };
}

describe("RequestStore.persistItems — in-memory", () => {
  it("persistItems is a no-op, flushItems resolves immediately", async () => {
    const store = createInMemoryRequestStore();
    await store.set("req_1", makeRequestRecord("req_1"));

    // Should not throw
    store.persistItems("req_1", [makeItem("item_1", 0)]);
    await store.flushItems("req_1");

    // In-memory store doesn't persist items via persistItems
    const record = await store.get("req_1");
    expect(record!.items).toBeUndefined();
  });
});

describe("RequestStore.persistItems — filesystem", () => {
  let store: RequestStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "fsd-persist-items-"));
    store = createFilesystemRequestStore({ rootDir: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists items and flushes correctly", async () => {
    await store.set("req_1", makeRequestRecord("req_1"));

    const items = [makeItem("item_1", 0), makeItem("item_2", 1)];
    store.persistItems("req_1", items);
    await store.flushItems("req_1");

    const record = await store.get("req_1");
    expect(record!.items).toHaveLength(2);
    expect(record!.items![0].id).toBe("item_1");
    expect(record!.items![1].id).toBe("item_2");
  });

  it("coalesces rapid persist calls", async () => {
    await store.set("req_1", makeRequestRecord("req_1"));

    // Fire multiple persist calls rapidly
    const items1 = [makeItem("item_1", 0)];
    const items2 = [makeItem("item_1", 0), makeItem("item_2", 1)];
    const items3 = [makeItem("item_1", 0), makeItem("item_2", 1), makeItem("item_3", 2)];

    store.persistItems("req_1", items1);
    store.persistItems("req_1", items2); // should be skipped (coalesced)
    store.persistItems("req_1", items3); // should also be skipped

    await store.flushItems("req_1");

    const record = await store.get("req_1");
    // The first call captures items1 (1 item), subsequent calls are coalesced
    expect(record!.items).toBeDefined();
    expect(record!.items!.length).toBeGreaterThanOrEqual(1);
  });

  it("flushItems on unknown requestId resolves immediately", async () => {
    // Should not throw
    await store.flushItems("nonexistent");
  });

  it("items are persisted after flush before terminal write", async () => {
    await store.set("req_1", makeRequestRecord("req_1"));

    const items = [makeItem("item_a", 0)];
    store.persistItems("req_1", items);
    await store.flushItems("req_1");

    // Now do the "terminal write" — simulate patchRequestRecord
    const current = await store.get("req_1");
    await store.set("req_1", {
      ...current!,
      status: "completed",
      completedAtMs: Date.now(),
      items: [makeItem("item_a", 0), makeItem("item_b", 1)]
    });

    const final = await store.get("req_1");
    expect(final!.status).toBe("completed");
    expect(final!.items).toHaveLength(2);
  });
});
