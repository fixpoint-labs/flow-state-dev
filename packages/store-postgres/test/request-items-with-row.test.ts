/**
 * A request's row and its items are one write and one read on Postgres.
 *
 * Items live in `request_items`, apart from the record row. A write that
 * settles a request carries the items it settles with, and they land in the
 * same statement as the status, so no reader sees the status without them.
 * A read takes the row and its items from one statement's snapshot, so a
 * request deleted and recreated under the same id between two reads never
 * hands back one run's row with another run's items.
 */
import type { PGlite } from "@electric-sql/pglite";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { RequestRecord, RequestStore } from "@flow-state-dev/engine";
import { beforeEach, describe, expect, it } from "vitest";
import { initializeSchema, type QueryExecutor } from "../src";
import { createPostgresRequestStore } from "../src/request-store";
import { freshPglite } from "./shared-pglite";

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

describe("Postgres request store: a record's items travel with its row", () => {
  let pglite: PGlite;
  let executor: QueryExecutor;
  let store: RequestStore;
  /** Runs once, just before the next statement that reads `request_items`. */
  let beforeItemsRead: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    pglite = await freshPglite();
    const raw: QueryExecutor = {
      async query(text, values) {
        const result = await pglite.query(text, values);
        return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
      }
    };
    await initializeSchema(raw);
    executor = {
      async query(text, values) {
        const hook = beforeItemsRead;
        if (hook !== undefined && /^\s*SELECT/i.test(text) && text.includes("request_items")) {
          beforeItemsRead = undefined;
          await hook();
        }
        return raw.query(text, values);
      }
    };
    store = createPostgresRequestStore(executor);
  });

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
  async function recreate(id: string, text: string): Promise<void> {
    await pglite.query("DELETE FROM request_items WHERE request_id = $1", [id]);
    await pglite.query("DELETE FROM requests WHERE id = $1", [id]);
    const next = record(id, { input: { generation: text } });
    await pglite.query(
      "INSERT INTO requests (id, flow_kind, flow_id, user_id, session_id, org_id, tenant_id, status, version, created_at, updated_at, data) " +
        "VALUES ($1, $2, NULL, $3, $4, NULL, NULL, $5, 0, $6, $7, $8)",
      [id, next.flowKind, next.userId, next.sessionId, next.status, next.createdAt, next.updatedAt, JSON.stringify(next)]
    );
    await pglite.query(
      "INSERT INTO request_items (request_id, item_id, sequence, item_type, data) VALUES ($1, $2, 0, 'message', $3)",
      [id, `${text}-item`, JSON.stringify(item(id, `${text}-item`, 0, text))]
    );
  }

  async function seedFirstGeneration(): Promise<void> {
    await store.set("r1", record("r1", { input: { generation: "first" } }), "absent");
    store.persistItems("r1", [item("r1", "first-item", 0, "first")]);
    await store.flushItems("r1");
  }

  it("get returns a row and items from the same request when the id is recreated mid-read", async () => {
    await seedFirstGeneration();

    beforeItemsRead = () => recreate("r1", "second");
    const got = await store.get("r1");

    expect(beforeItemsRead).toBeUndefined();
    const generation = (got?.input as { generation: string } | undefined)?.generation;
    expect(texts(got)).toEqual([generation]);
  });

  it("list with items returns each row with its own request's items when the id is recreated mid-read", async () => {
    await seedFirstGeneration();

    beforeItemsRead = () => recreate("r1", "second");
    const [got] = await store.list({ sessionId: "s1", withItems: true });

    expect(beforeItemsRead).toBeUndefined();
    const generation = (got?.input as { generation: string } | undefined)?.generation;
    expect(texts(got)).toEqual([generation]);
  });
});
