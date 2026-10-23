/**
 * Deferred callbacks are run by hand, so a throw after close is the assertion
 * rather than an uncaught error the runner misses.
 */
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import { makeRequestStreamEvent } from "@flow-state-dev/engine/testing";
import { createSQLiteRequestStore } from "../src/request-store";
import { initializeSchema } from "../src/schema";

function freshStore() {
  const db = new Database(":memory:");
  initializeSchema(db);
  return { db, store: createSQLiteRequestStore(db) };
}

function messageItem(requestId: string): OutputItem {
  return {
    id: "a",
    type: "message",
    status: "done",
    requestId,
    itemIndex: 0,
    provenance: { blockKind: "generator", blockInstanceId: "b1", blockName: "g" },
    ts: Date.now(),
    role: "assistant",
    content: [{ type: "text", text: "late" }]
  } as unknown as OutputItem;
}

function captureDeferredWrites(): Array<() => void> {
  const deferred: Array<() => void> = [];
  vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => {
    deferred.push(callback);
  });
  return deferred;
}

describe("SQLite request store: a write after close (FIX-2097)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["event", "queued before close", "req_late"],
    ["event", "made after close", "req_after"],
    ["item", "queued before close", "req_items"],
    ["item", "made after close", "req_items_after"]
  ] as const)("drops an %s write %s", (kind, when, requestId) => {
    const { db, store } = freshStore();
    const deferred = captureDeferredWrites();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const write = () =>
      kind === "event"
        ? store.persistEvents(requestId, [makeRequestStreamEvent(requestId, 1)])
        : store.persistItems(requestId, [messageItem(requestId)]);

    if (when === "made after close") db.close();
    write();
    if (when === "queued before close") {
      db.close();
      expect(deferred).toHaveLength(1);
    }

    expect(() => deferred.forEach((run) => run())).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(requestId));
  });

  it("still writes while the connection is open", () => {
    const { db, store } = freshStore();
    const deferred = captureDeferredWrites();

    store.persistEvents("req_open", [makeRequestStreamEvent("req_open", 1)]);
    deferred.forEach((run) => run());

    const row = db
      .prepare("SELECT count(*) AS c FROM request_events WHERE request_id = ?")
      .get("req_open") as { c: number };
    expect(row.c).toBe(1);
    db.close();
  });
});
