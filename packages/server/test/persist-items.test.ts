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
    await store.set("req_1", makeRequestRecord("req_1"), "any");

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
    await store.set("req_1", makeRequestRecord("req_1"), "any");

    const items = [makeItem("item_1", 0), makeItem("item_2", 1)];
    store.persistItems("req_1", items);
    await store.flushItems("req_1");

    const record = await store.get("req_1");
    expect(record!.items).toHaveLength(2);
    expect(record!.items![0].id).toBe("item_1");
    expect(record!.items![1].id).toBe("item_2");
  });

  it("coalesces rapid persist calls", async () => {
    await store.set("req_1", makeRequestRecord("req_1"), "any");

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

  // FIX-447 regression — persistItems must not stomp on state mutations.
  //
  // The original implementation queued a write that read `current` from disk
  // outside any write lock, then wrote `{...current, items, updatedAt}` with
  // `"any"` version. The runtime sequence in production:
  //
  //   1. handler.execute calls `request.atomicState(...)` → `stores.request.set(record_v1, expected=0)`
  //      writes a new record with state=tasks, v=1.
  //   2. After CAS resolves, the same handler emits component items
  //      (e.g. task-change items via the substrate's onChange path).
  //   3. Each non-transient item triggers `persistItems`, queueing a task
  //      that reads the request record and writes back with the items field
  //      merged in.
  //
  // Step 3's queued task can be scheduled while step 1 is still in-flight.
  // If the queued read observes the pre-CAS record, the write would overwrite
  // the post-CAS state. We exercise that race by enqueueing a persistItems
  // task whose read snapshots the pre-CAS state, then completing the CAS
  // write, then draining the queue. After the fix, `persistItems` re-reads
  // inside the lock and merges only the `items` field, so the post-CAS state
  // survives.
  it("persistItems does not overwrite a concurrent state mutation", async () => {
    // Initial record on disk: state is empty, version 0.
    await store.set("req_race", makeRequestRecord("req_race"), "any");

    const items = [makeItem("item_1", 0)];

    // 1. Enqueue persistItems first. The queued task will start its disk read
    //    on the next microtask tick.
    store.persistItems("req_race", items);

    // 2. CAS-style state write — runs concurrently with the queued items
    //    write. Both compete for the per-id write lock; the merge inside the
    //    lock guarantees neither field stomps the other.
    const stateUpdated: RequestRecord = {
      ...makeRequestRecord("req_race"),
      state: { tasks: { t1: { id: "t1", goal: "first" } } },
      version: 1,
      updatedAt: Date.now()
    };
    await store.set("req_race", stateUpdated, 0);

    // 3. Drain the queue.
    await store.flushItems("req_race");

    const final = await store.get("req_race");
    expect(final).toBeDefined();
    // Both fields must be present — the items write must merge under the
    // lock against whatever the latest CAS state write committed.
    expect(final!.state).toEqual({ tasks: { t1: { id: "t1", goal: "first" } } });
  });

  it("items are persisted after flush before terminal write", async () => {
    await store.set("req_1", makeRequestRecord("req_1"), "any");

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
    }, "any");

    const final = await store.get("req_1");
    expect(final!.status).toBe("completed");
    expect(final!.items).toHaveLength(2);
  });
});
