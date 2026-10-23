/**
 * A write that lands after the connection closed (FIX-2097).
 *
 * The request store defers its item and event writes to a microtask. At host
 * shutdown a request the drain cancelled can still emit after the registry
 * closed the connection, and that deferred write then runs against a closed
 * database. A throw there has no caller to reach: it surfaces as an uncaught
 * exception and takes the host process down. A late write must be dropped
 * instead, because there is nothing left to persist it to.
 *
 * The deferred callbacks are captured and run by hand so the test asserts on
 * the throw itself, rather than relying on the runner to notice an uncaught
 * error after the test has already passed.
 */
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import { makeRequestStreamEvent } from "@flow-state-dev/engine/testing";
import { createSQLiteRequestStore } from "../src/request-store";
import { initializeSchema } from "../src/schema";

function freshStore(): { db: Database.Database; store: ReturnType<typeof createSQLiteRequestStore> } {
  const db = new Database(":memory:");
  initializeSchema(db);
  return { db, store: createSQLiteRequestStore(db) };
}

function messageItem(requestId: string, id: string): OutputItem {
  return {
    id,
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

/** Hold every callback the store defers, so the test decides when it runs. */
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

  it("drops an event write queued before close and run after it", () => {
    const { db, store } = freshStore();
    const deferred = captureDeferredWrites();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    store.persistEvents("req_late", [makeRequestStreamEvent("req_late", 1)]);
    db.close();

    expect(deferred).toHaveLength(1);
    expect(() => deferred[0]!()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("req_late"));
  });

  it("drops an event write made after close", () => {
    const { db, store } = freshStore();
    const deferred = captureDeferredWrites();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    db.close();
    store.persistEvents("req_after", [makeRequestStreamEvent("req_after", 1)]);

    expect(() => deferred.forEach((run) => run())).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("req_after"));
  });

  it("drops an item write queued before close and run after it", () => {
    const { db, store } = freshStore();
    const deferred = captureDeferredWrites();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    store.persistItems("req_items", [messageItem("req_items", "a")]);
    db.close();

    expect(deferred).toHaveLength(1);
    expect(() => deferred[0]!()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("req_items"));
  });

  it("drops an item write made after close", () => {
    const { db, store } = freshStore();
    const deferred = captureDeferredWrites();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    db.close();
    store.persistItems("req_items_after", [messageItem("req_items_after", "a")]);

    expect(() => deferred.forEach((run) => run())).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("req_items_after"));
  });

  it("still writes while the connection is open", () => {
    // The guard is for a closed connection only: an open one keeps every write.
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
