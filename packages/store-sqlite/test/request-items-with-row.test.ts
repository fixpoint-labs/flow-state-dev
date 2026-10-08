/**
 * A request's row and its items are one write and one read on SQLite.
 *
 * Items live in `request_items`, apart from the record row. A write that
 * settles a request carries the items it settles with, and they land in the
 * same transaction as the status, so no reader sees the status without them.
 * A read takes the row and its items from one snapshot, so a request deleted
 * and recreated under the same id between the two never hands back one run's
 * row with another run's items.
 */
import Database from "better-sqlite3";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { RequestRecord, RequestStore } from "@flow-state-dev/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeSchema } from "../src/schema";
import { createSQLiteRequestStore } from "../src/request-store";

function record(id: string, overrides: Partial<RequestRecord> = {}): RequestRecord {
  const ts = Date.now();
  return {
    id,
    flowKind: "f",
    actionName: "a",
    userId: "u1",
    sessionId: "s1",
    status: "in_progress",
    startedAtMs: ts,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    ...overrides
  };
}

function item(requestId: string, id: string, itemIndex: number, text: string): OutputItem {
  return {
    id,
    type: "message",
    status: "done",
    requestId,
    itemIndex,
    provenance: { blockKind: "generator", blockInstanceId: "b1", blockName: "g" },
    ts: Date.now(),
    role: "assistant",
    content: [{ type: "text", text }]
  } as unknown as OutputItem;
}

function texts(r: RequestRecord | undefined): string[] {
  return (r?.items ?? []).map(
    (i) => ((i as unknown as { content: Array<{ text: string }> }).content[0]?.text ?? "")
  );
}

describe("SQLite request store: a record's items travel with its row", () => {
  let db: Database.Database;
  let store: RequestStore;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    store = createSQLiteRequestStore(db);
  });
  afterEach(() => db.close());

  it("lands a settling write's items with its status, without a separate items write", async () => {
    await store.set("r1", record("r1"), "absent");
    await store.set(
      "r1",
      record("r1", { status: "completed", items: [item("r1", "i1", 0, "answer")] }),
      "any"
    );

    const settled = await store.get("r1");
    expect(settled?.status).toBe("completed");
    expect(texts(settled)).toEqual(["answer"]);
  });

  it("writes none of a settling write's items when the write itself loses", async () => {
    await store.set("r1", record("r1"), "absent");
    const result = await store.set(
      "r1",
      record("r1", { status: "completed", version: 8, items: [item("r1", "i1", 0, "answer")] }),
      7
    );

    expect(result.ok).toBe(false);
    const current = await store.get("r1");
    expect(current?.status).toBe("in_progress");
    expect(current?.items).toEqual([]);
  });

  // A write made while the request runs is built from a record read earlier,
  // so its items can be older than ones persisted since. Writing them would
  // roll a finished item back to its earlier content.
  it("leaves a running request's items to persistItems, so a mid-run write cannot roll one back", async () => {
    await store.set("r1", record("r1"), "absent");
    const earlier = await store.get("r1");
    store.persistItems("r1", [item("r1", "i1", 0, "finished")]);
    await store.flushItems("r1");

    await store.set("r1", { ...earlier!, items: [item("r1", "i1", 0, "started")] }, "any");

    expect(texts(await store.get("r1"))).toEqual(["finished"]);
  });

  /** Delete `id` and write a new request under it, straight on the database. */
  function recreate(id: string, text: string): void {
    db.prepare("DELETE FROM request_items WHERE request_id = ?").run(id);
    db.prepare("DELETE FROM requests WHERE id = ?").run(id);
    const next = record(id, { input: { generation: text } });
    db.prepare(
      "INSERT INTO requests (id, flow_kind, flow_id, user_id, session_id, org_id, tenant_id, status, version, created_at, updated_at, data) " +
        "VALUES (?, ?, NULL, ?, ?, NULL, NULL, ?, 0, ?, ?, ?)"
    ).run(id, next.flowKind, next.userId, next.sessionId, next.status, next.createdAt, next.updatedAt, JSON.stringify(next));
    db.prepare(
      "INSERT INTO request_items (request_id, item_id, sequence, item_type, data) VALUES (?, ?, 0, 'message', ?)"
    ).run(id, `${text}-item`, JSON.stringify(item(id, `${text}-item`, 0, text)));
  }

  async function seedFirstGeneration(): Promise<void> {
    await store.set("r1", record("r1", { input: { generation: "first" } }), "absent");
    store.persistItems("r1", [item("r1", "first-item", 0, "first")]);
    await store.flushItems("r1");
  }

  it("get returns a row and items from the same request when the id is recreated mid-read", async () => {
    await seedFirstGeneration();

    const read = store.get("r1");
    // Runs before the read can continue past its first await.
    recreate("r1", "second");
    const got = await read;

    const generation = (got?.input as { generation: string } | undefined)?.generation;
    expect(texts(got)).toEqual([generation]);
  });

  it("list with items returns each row with its own request's items when the id is recreated mid-read", async () => {
    await seedFirstGeneration();

    const read = store.list({ sessionId: "s1", withItems: true });
    recreate("r1", "second");
    const [got] = await read;

    const generation = (got?.input as { generation: string } | undefined)?.generation;
    expect(texts(got)).toEqual([generation]);
  });
});
