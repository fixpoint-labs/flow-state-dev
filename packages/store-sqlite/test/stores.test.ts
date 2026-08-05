import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { OutputItem } from "@flow-state-dev/core/items";
import type {
  OrgRecord,
  RequestListOptions,
  RequestRecord,
  RequestStore,
  SessionRecord,
  TraceStore,
  UserRecord
} from "@flow-state-dev/engine";
import { createTraceStoreConformanceTests } from "@flow-state-dev/engine/testing";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src";
import { initializeSchema } from "../src/schema";
import { createSQLiteSuspensionStore } from "../src/suspension-store";
import { createSQLiteRequestStore } from "../src/request-store";

function now() {
  return Date.now();
}

function makeSessionRecord(
  id: string,
  flowKind: string,
  userId: string,
  overrides?: Partial<SessionRecord>
): SessionRecord {
  const ts = now();
  return {
    id,
    flowKind,
    userId,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    journal: [],
    ...overrides
  };
}

function makeRequestRecord(
  id: string,
  flowKind: string,
  actionName: string,
  userId: string,
  sessionId?: string,
  overrides?: Partial<RequestRecord>
): RequestRecord {
  const ts = now();
  return {
    id,
    flowKind,
    actionName,
    userId,
    sessionId,
    status: "in_progress",
    startedAtMs: ts,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    ...overrides
  };
}

function makeMessageItem(
  requestId: string,
  id: string,
  itemIndex: number,
  text: string
): Record<string, unknown> {
  return {
    id,
    type: "message",
    status: "done",
    requestId,
    itemIndex,
    provenance: { blockKind: "generator", blockInstanceId: "b1", blockName: "g" },
    ts: now(),
    role: "assistant",
    content: [{ type: "text", text }]
  };
}

function makeUserRecord(id: string): UserRecord {
  const ts = now();
  return {
    id,
    userId: id,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts
  };
}

function makeOrgRecord(id: string, userId: string): OrgRecord {
  const ts = now();
  return {
    id,
    orgId: id,
    userId,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts
  };
}

describe("SQLite store adapter", () => {
  let stores: SQLiteStoreRegistry;

  afterEach(() => {
    stores?.close();
  });

  function freshStores(): SQLiteStoreRegistry {
    stores = createSQLiteStores({ filename: ":memory:" });
    return stores;
  }

  // --- Schema ---

  it("initializes schema idempotently", () => {
    const s = freshStores();
    // calling createSQLiteStores again on same DB would re-run CREATE IF NOT EXISTS
    // but we can verify tables exist by running operations
    expect(s.session).toBeDefined();
    expect(s.request).toBeDefined();
    expect(s.user).toBeDefined();
    expect(s.org).toBeDefined();
    expect(s.activeRequests).toBeDefined();
  });

  // --- Session Store ---

  describe("session store", () => {
    it("set then get returns the record", async () => {
      const s = freshStores();
      const record = makeSessionRecord("sess_1", "flow-a", "user_1");
      await s.session.set("sess_1", record, "any");

      const result = await s.session.get("sess_1");
      expect(result).toBeDefined();
      expect(result!.id).toBe("sess_1");
      expect(result!.flowKind).toBe("flow-a");
      expect(result!.userId).toBe("user_1");
      expect(result!.journal).toEqual([]);
    });

    it("get non-existent returns undefined", async () => {
      const s = freshStores();
      expect(await s.session.get("nope")).toBeUndefined();
    });

    it("upsert updates record", async () => {
      const s = freshStores();
      const record = makeSessionRecord("sess_1", "flow-a", "user_1");
      await s.session.set("sess_1", record, "any");

      const updated = { ...record, version: 1, updatedAt: now() + 100 };
      await s.session.set("sess_1", updated, "any");

      const result = await s.session.get("sess_1");
      expect(result!.version).toBe(1);
    });

    it("delete removes record", async () => {
      const s = freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"), "any");
      await s.session.delete("sess_1");
      expect(await s.session.get("sess_1")).toBeUndefined();
    });

    it("delete non-existent is a no-op", async () => {
      const s = freshStores();
      await s.session.delete("nope"); // should not throw
    });

    it("list returns all records sorted by updatedAt desc", async () => {
      const s = freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1", { updatedAt: 100 }), "any");
      await s.session.set("sess_2", makeSessionRecord("sess_2", "flow-b", "user_2", { updatedAt: 300 }), "any");
      await s.session.set("sess_3", makeSessionRecord("sess_3", "flow-a", "user_1", { updatedAt: 200 }), "any");

      const all = await s.session.list();
      expect(all).toHaveLength(3);
      expect(all[0]!.id).toBe("sess_2");
      expect(all[1]!.id).toBe("sess_3");
      expect(all[2]!.id).toBe("sess_1");
    });

    it("list filters by flowKind", async () => {
      const s = freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"), "any");
      await s.session.set("sess_2", makeSessionRecord("sess_2", "flow-b", "user_2"), "any");

      const result = await s.session.list({ flowKind: "flow-a" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("sess_1");
    });

    it("list filters by userId", async () => {
      const s = freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"), "any");
      await s.session.set("sess_2", makeSessionRecord("sess_2", "flow-b", "user_2"), "any");

      const result = await s.session.list({ userId: "user_1" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("sess_1");
    });

    it("list with limit and offset", async () => {
      const s = freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1", { updatedAt: 100 }), "any");
      await s.session.set("sess_2", makeSessionRecord("sess_2", "flow-a", "user_1", { updatedAt: 200 }), "any");
      await s.session.set("sess_3", makeSessionRecord("sess_3", "flow-a", "user_1", { updatedAt: 300 }), "any");

      const page = await s.session.list({ limit: 1, offset: 1 });
      expect(page).toHaveLength(1);
      expect(page[0]!.id).toBe("sess_2");
    });

    it("list with offset beyond total returns empty", async () => {
      const s = freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"), "any");
      expect(await s.session.list({ offset: 100 })).toHaveLength(0);
    });

    it("list with limit 0 returns empty", async () => {
      const s = freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"), "any");
      expect(await s.session.list({ limit: 0 })).toHaveLength(0);
    });
  });

  // --- Request Store ---

  describe("request store", () => {
    it("set then get returns the record", async () => {
      const s = freshStores();
      const record = makeRequestRecord("req_1", "flow-a", "run", "user_1", "sess_1");
      await s.request.set("req_1", record, "any");

      const result = await s.request.get("req_1");
      expect(result).toBeDefined();
      expect(result!.id).toBe("req_1");
      expect(result!.actionName).toBe("run");
      expect(result!.status).toBe("in_progress");
    });

    it("filters by flowKind", async () => {
      const s = freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1"), "any");
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-b", "run", "user_1"), "any");

      expect(await s.request.list({ flowKind: "flow-a" })).toHaveLength(1);
    });

    it("filters by sessionId", async () => {
      const s = freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1", "sess_1"), "any");
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-a", "run", "user_1", "sess_2"), "any");

      const result = await s.request.list({ sessionId: "sess_1" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("req_1");
    });

    it("filters by userId", async () => {
      const s = freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1"), "any");
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-a", "run", "user_2"), "any");

      expect(await s.request.list({ userId: "user_1" })).toHaveLength(1);
    });

    it("filters by status", async () => {
      const s = freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1", undefined, { status: "completed" }), "any");
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-a", "run", "user_1", undefined, { status: "in_progress" }), "any");

      const result = await s.request.list({ status: "completed" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("req_1");
    });

    it("orderBy startedAtMs orders by start time, not last update", async () => {
      const s = freshStores();
      // req_old started first, updated last; req_new started last, updated
      // first. orderBy:startedAtMs returns start order (new, old); the default
      // updatedAt order returns (old, new).
      await s.request.set(
        "req_old",
        makeRequestRecord("req_old", "flow-a", "run", "user_1", "sess_o", {
          status: "completed",
          startedAtMs: 100,
          createdAt: 100,
          updatedAt: 999
        }),
        "any"
      );
      await s.request.set(
        "req_new",
        makeRequestRecord("req_new", "flow-a", "run", "user_1", "sess_o", {
          status: "completed",
          startedAtMs: 500,
          createdAt: 500,
          updatedAt: 200
        }),
        "any"
      );

      const byStarted = await s.request.list({ sessionId: "sess_o", orderBy: "startedAtMs" });
      expect(byStarted.map((r) => r.id)).toEqual(["req_new", "req_old"]);

      const byUpdated = await s.request.list({ sessionId: "sess_o" });
      expect(byUpdated.map((r) => r.id)).toEqual(["req_old", "req_new"]);
    });

    it("orderBy startedAtMs with limit selects the most-recently-started", async () => {
      const s = freshStores();
      for (let n = 1; n <= 3; n++) {
        await s.request.set(
          `req_${n}`,
          makeRequestRecord(`req_${n}`, "flow-a", "run", "user_1", "sess_l", {
            status: "completed",
            startedAtMs: n * 100,
            createdAt: n * 100,
            updatedAt: n * 100
          }),
          "any"
        );
      }

      const windowed = await s.request.list({
        sessionId: "sess_l",
        status: "completed",
        orderBy: "startedAtMs",
        limit: 2
      });
      expect(windowed.map((r) => r.id)).toEqual(["req_3", "req_2"]);
    });

    it("filters by status interrupted", async () => {
      const s = freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1", undefined, { status: "interrupted", interruptedAt: Date.now() }), "any");
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-a", "run", "user_1", undefined, { status: "in_progress" }), "any");

      const result = await s.request.list({ status: "interrupted" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("req_1");
      expect(result[0]!.interruptedAt).toBeDefined();
    });

    it("delete removes and is no-op for non-existent", async () => {
      const s = freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1"), "any");
      await s.request.delete("req_1");
      expect(await s.request.get("req_1")).toBeUndefined();
      await s.request.delete("nope"); // should not throw
    });

    it("persistItems updates items on the record", async () => {
      const s = freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1"), "any");

      const items = [makeMessageItem("req_1", "a", 0, "hello") as unknown as OutputItem];
      s.request.persistItems("req_1", items);
      await s.request.flushItems("req_1");

      // Allow microtask to complete
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const result = await s.request.get("req_1");
      expect(result!.items).toBeDefined();
      expect(result!.items).toHaveLength(1);
      expect((result!.items![0]!.content as Array<{ text: string }>)[0]!.text).toBe(
        "hello"
      );
    });
  });

  // --- request_items child table (FIX-686) ---
  //
  // These tests need raw SQL access to assert the items live in the
  // `request_items` child table (not the `requests.data` blob). They build a
  // store directly over an in-memory DB so the same handle can run the store
  // operations and the verification SELECTs.
  describe("request_items (FIX-686)", () => {
    let db: Database.Database;

    afterEach(() => {
      db?.close();
    });

    function freshRequestStore(): RequestStore {
      db = new Database(":memory:");
      initializeSchema(db);
      return createSQLiteRequestStore(db);
    }

    function itemCount(requestId: string): number {
      const row = db
        .prepare("SELECT count(*) AS c FROM request_items WHERE request_id = ?")
        .get(requestId) as { c: number };
      return row.c;
    }

    async function seedRequest(store: RequestStore, id: string): Promise<void> {
      await store.set(id, makeRequestRecord(id, "flow-a", "run", "u"), "any");
    }

    it("persists items to the child table and reads them back via get", async () => {
      // Intent: items round-trip through the dedicated table, not the blob.
      const store = freshRequestStore();
      await seedRequest(store, "req_rt");
      store.persistItems("req_rt", [
        makeMessageItem("req_rt", "a", 0, "x") as unknown as OutputItem,
        makeMessageItem("req_rt", "b", 1, "y") as unknown as OutputItem
      ]);
      await store.flushItems("req_rt");

      expect(itemCount("req_rt")).toBe(2);
      const got = await store.get("req_rt");
      expect(got!.items!.map((i) => i.id)).toEqual(["a", "b"]);
    });

    it("incrementally UPSERTs new items into an existing set", async () => {
      // Intent: a later snapshot that adds an item appends without losing
      // the items already persisted.
      const store = freshRequestStore();
      await seedRequest(store, "req_inc");
      const a = makeMessageItem("req_inc", "a", 0, "x") as unknown as OutputItem;
      const b = makeMessageItem("req_inc", "b", 1, "y") as unknown as OutputItem;
      store.persistItems("req_inc", [a, b]);
      await store.flushItems("req_inc");

      const c = makeMessageItem("req_inc", "c", 2, "z") as unknown as OutputItem;
      store.persistItems("req_inc", [a, b, c]);
      await store.flushItems("req_inc");

      expect(itemCount("req_inc")).toBe(3);
      const got = await store.get("req_inc");
      expect(got!.items!.map((i) => i.id)).toEqual(["a", "b", "c"]);
    });

    it("merges two DISJOINT persistItems sets into the ordered union (FIX-811)", async () => {
      // Same-request continuation persists only its post-resume items. The store
      // must union them with the prior set by id (never full-replace), so a GET
      // returns the full ordered history.
      const store = freshRequestStore();
      await seedRequest(store, "req_disjoint");
      const a = makeMessageItem("req_disjoint", "a", 0, "x") as unknown as OutputItem;
      const b = makeMessageItem("req_disjoint", "b", 1, "y") as unknown as OutputItem;
      store.persistItems("req_disjoint", [a, b]);
      await store.flushItems("req_disjoint");

      // Second call carries a DISJOINT set — the continuation's new items only.
      const c = makeMessageItem("req_disjoint", "c", 2, "z") as unknown as OutputItem;
      const d = makeMessageItem("req_disjoint", "d", 3, "w") as unknown as OutputItem;
      store.persistItems("req_disjoint", [c, d]);
      await store.flushItems("req_disjoint");

      expect(itemCount("req_disjoint")).toBe(4);
      const got = await store.get("req_disjoint");
      expect(got!.items!.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("refines an item in place when the same id is re-emitted with new content", async () => {
      // Intent: re-emitting an item under the same id overwrites the row and
      // updates its sequence — no duplicate row.
      const store = freshRequestStore();
      await seedRequest(store, "req_ref");
      const keyed = "item_component:task-board";
      store.persistItems("req_ref", [
        makeMessageItem("req_ref", keyed, 5, "v1") as unknown as OutputItem
      ]);
      await store.flushItems("req_ref");
      store.persistItems("req_ref", [
        makeMessageItem("req_ref", keyed, 12, "v2") as unknown as OutputItem
      ]);
      await store.flushItems("req_ref");

      expect(itemCount("req_ref")).toBe(1);
      const got = await store.get("req_ref");
      expect((got!.items![0]!.content as Array<{ text: string }>)[0]!.text).toBe(
        "v2"
      );
      const seq = (
        db
          .prepare("SELECT sequence FROM request_items WHERE request_id = ?")
          .get("req_ref") as { sequence: number }
      ).sequence;
      expect(seq).toBe(12);
    });

    it("re-persisting unchanged content issues no second write", async () => {
      // Intent: content diffing skips items whose serialized form is unchanged,
      // so re-persisting an item with no field changes does not touch the row.
      // (A changed field — e.g. a block_trace going in_progress → completed —
      // is re-written; that is the FIX-839 guarantee.)
      const store = freshRequestStore();
      await seedRequest(store, "req_noop");
      const item = makeMessageItem("req_noop", "a", 0, "x") as unknown as OutputItem;
      store.persistItems("req_noop", [item]);
      await store.flushItems("req_noop");

      const updatedBefore = (
        db
          .prepare("SELECT data FROM request_items WHERE request_id = ?")
          .get("req_noop") as { data: string }
      ).data;

      // Mutate the row out-of-band; if persistItems wrote again it would
      // overwrite this marker. A no-op leaves the marker untouched.
      db.prepare(
        "UPDATE request_items SET data = ? WHERE request_id = ?"
      ).run(JSON.stringify({ marker: true }), "req_noop");

      store.persistItems("req_noop", [item]);
      await store.flushItems("req_noop");

      const after = (
        db
          .prepare("SELECT data FROM request_items WHERE request_id = ?")
          .get("req_noop") as { data: string }
      ).data;
      expect(after).toBe(JSON.stringify({ marker: true }));
      expect(after).not.toBe(updatedBefore);
    });

    it("coalesces N synchronous persistItems into one write of the latest snapshot", async () => {
      // Intent: many calls in a synchronous burst collapse to a single
      // microtask that writes one row per distinct item.
      const store = freshRequestStore();
      await seedRequest(store, "req_coal");
      const items = [
        makeMessageItem("req_coal", "a", 0, "x") as unknown as OutputItem,
        makeMessageItem("req_coal", "b", 1, "y") as unknown as OutputItem
      ];
      for (let i = 0; i < 1000; i += 1) {
        store.persistItems("req_coal", items);
      }
      await store.flushItems("req_coal");
      expect(itemCount("req_coal")).toBe(2);
    });

    it("get falls back to legacy data.items when request_items has no rows", async () => {
      // Intent: requests persisted before the table existed still read their
      // items from the JSONB blob.
      const store = freshRequestStore();
      const legacyItem = makeMessageItem("legacy_1", "legacy_a", 0, "legacy-x");
      const record = makeRequestRecord("legacy_1", "flow-a", "run", "u", "sess", {
        items: [legacyItem as unknown as OutputItem]
      });
      // Write the legacy shape directly: items inside data, no child rows.
      db.prepare(
        "INSERT INTO requests (id, flow_kind, user_id, session_id, org_id, status, version, created_at, updated_at, data) " +
          "VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)"
      ).run(
        "legacy_1",
        record.flowKind,
        record.userId,
        record.sessionId ?? null,
        record.status,
        record.version,
        record.createdAt,
        record.updatedAt,
        JSON.stringify(record)
      );

      const got = await store.get("legacy_1");
      expect(got!.items).toHaveLength(1);
      expect(got!.items![0]!.id).toBe("legacy_a");
    });

    it("merges legacy data.items with request_items rows, table wins on collision", async () => {
      const store = freshRequestStore();
      const legacyA = makeMessageItem("merge_1", "shared", 0, "legacy-version");
      const legacyB = makeMessageItem("merge_1", "legacy-only", 1, "legacy-b");
      const record = makeRequestRecord("merge_1", "flow-a", "run", "u", "sess", {
        items: [legacyA as unknown as OutputItem, legacyB as unknown as OutputItem]
      });
      db.prepare(
        "INSERT INTO requests (id, flow_kind, user_id, session_id, org_id, status, version, created_at, updated_at, data) " +
          "VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)"
      ).run(
        "merge_1",
        record.flowKind,
        record.userId,
        record.sessionId ?? null,
        record.status,
        record.version,
        record.createdAt,
        record.updatedAt,
        JSON.stringify(record)
      );

      // Table version of `shared` wins; `table-only` is new.
      store.persistItems("merge_1", [
        makeMessageItem("merge_1", "shared", 2, "table-version") as unknown as OutputItem,
        makeMessageItem("merge_1", "table-only", 3, "table-c") as unknown as OutputItem
      ]);
      await store.flushItems("merge_1");

      const got = await store.get("merge_1");
      expect(got!.items).toHaveLength(3);
      const sharedRow = got!.items!.find((i) => i.id === "shared")!;
      expect((sharedRow.content as Array<{ text: string }>)[0]!.text).toBe(
        "table-version"
      );
      // Ordered by itemIndex: legacy-only (1), shared (2), table-only (3).
      expect(got!.items!.map((i) => i.id)).toEqual([
        "legacy-only",
        "shared",
        "table-only"
      ]);
    });

    it("countItems counts table rows without parsing item payloads", async () => {
      const store = freshRequestStore();
      await seedRequest(store, "req_cnt");
      store.persistItems("req_cnt", [
        makeMessageItem("req_cnt", "a", 0, "x") as unknown as OutputItem,
        makeMessageItem("req_cnt", "b", 1, "y") as unknown as OutputItem
      ]);
      await store.flushItems("req_cnt");

      // Corrupt the payloads out-of-band: a count that parsed item JSON would
      // throw, so a correct answer proves payloads were never materialized.
      db.prepare(
        "UPDATE request_items SET data = 'not-json' WHERE request_id = ?"
      ).run("req_cnt");

      expect(await store.countItems("req_cnt")).toBe(2);
    });

    it("countItems merges legacy data.items with table rows, table wins on collision", async () => {
      const store = freshRequestStore();
      const legacyA = makeMessageItem("cnt_merge", "shared", 0, "legacy-version");
      const legacyB = makeMessageItem("cnt_merge", "legacy-only", 1, "legacy-b");
      const record = makeRequestRecord("cnt_merge", "flow-a", "run", "u", "sess", {
        items: [legacyA as unknown as OutputItem, legacyB as unknown as OutputItem]
      });
      db.prepare(
        "INSERT INTO requests (id, flow_kind, user_id, session_id, org_id, status, version, created_at, updated_at, data) " +
          "VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)"
      ).run(
        "cnt_merge",
        record.flowKind,
        record.userId,
        record.sessionId ?? null,
        record.status,
        record.version,
        record.createdAt,
        record.updatedAt,
        JSON.stringify(record)
      );

      store.persistItems("cnt_merge", [
        makeMessageItem("cnt_merge", "shared", 2, "table-version") as unknown as OutputItem,
        makeMessageItem("cnt_merge", "table-only", 3, "table-c") as unknown as OutputItem
      ]);
      await store.flushItems("cnt_merge");

      // Union by id: shared, legacy-only, table-only — matches get().items.
      expect(await store.countItems("cnt_merge")).toBe(3);
      const got = await store.get("cnt_merge");
      expect(got!.items).toHaveLength(3);
    });

    it("set strips items from the requests blob", async () => {
      const store = freshRequestStore();
      const record = makeRequestRecord("req_strip", "flow-a", "run", "u");
      record.items = [
        makeMessageItem("req_strip", "x", 0, "x") as unknown as OutputItem
      ];
      await store.set("req_strip", record, "any");

      const row = db
        .prepare("SELECT data FROM requests WHERE id = ?")
        .get("req_strip") as { data: string };
      expect((JSON.parse(row.data) as { items?: unknown }).items).toBeUndefined();
    });

    it("terminal set clears the tracking map so a re-persist re-upserts", async () => {
      // Intent: once a request reaches a terminal status the per-request
      // reference map is dropped, so a subsequent persist of the same object
      // still writes (idempotently) rather than being diffed away.
      const store = freshRequestStore();
      await seedRequest(store, "req_term");
      const item = makeMessageItem("req_term", "x", 0, "v1") as unknown as OutputItem;
      store.persistItems("req_term", [item]);
      await store.flushItems("req_term");

      await store.set(
        "req_term",
        makeRequestRecord("req_term", "flow-a", "run", "u", undefined, {
          status: "completed",
          completedAtMs: Date.now()
        }),
        "any"
      );

      // Out-of-band marker; a re-upsert (map cleared) overwrites it.
      db.prepare(
        "UPDATE request_items SET data = ? WHERE request_id = ?"
      ).run(JSON.stringify({ marker: true }), "req_term");

      store.persistItems("req_term", [item]);
      await store.flushItems("req_term");

      expect(itemCount("req_term")).toBe(1);
      const after = (
        db
          .prepare("SELECT data FROM request_items WHERE request_id = ?")
          .get("req_term") as { data: string }
      ).data;
      expect(after).not.toBe(JSON.stringify({ marker: true }));
    });

    it("list default returns empty items and does not query request_items", async () => {
      // Intent: the cheap list path never touches the child table; legacy
      // blob items are stripped so the payload stays lean.
      const store = freshRequestStore();
      await seedRequest(store, "req_l1");
      store.persistItems("req_l1", [
        makeMessageItem("req_l1", "a", 0, "x") as unknown as OutputItem
      ]);
      await store.flushItems("req_l1");

      // Drop the child table entirely; a default list must still succeed,
      // proving it issues no SELECT against request_items.
      db.exec("DROP TABLE request_items");
      const out = await store.list({ sessionId: undefined });
      const target = out.find((r) => r.id === "req_l1")!;
      expect(target.items).toBeUndefined();
    });

    it("list with withItems:true groups items per record, merging legacy + table", async () => {
      const store = freshRequestStore();
      await store.set(
        "req_l2",
        makeRequestRecord("req_l2", "flow-a", "run", "u", "sess_L2"),
        "any"
      );
      store.persistItems("req_l2", [
        makeMessageItem("req_l2", "a", 0, "x") as unknown as OutputItem,
        makeMessageItem("req_l2", "b", 1, "y") as unknown as OutputItem
      ]);
      await store.flushItems("req_l2");

      const out = await store.list({ withItems: true } as RequestListOptions);
      const target = out.find((r) => r.id === "req_l2")!;
      expect(target.items!.map((i) => i.id)).toEqual(["a", "b"]);
    });

    it("delete removes the child rows", async () => {
      const store = freshRequestStore();
      await seedRequest(store, "req_del");
      store.persistItems("req_del", [
        makeMessageItem("req_del", "x", 0, "x") as unknown as OutputItem
      ]);
      // Intentionally do NOT flush — delete must clean up regardless.
      await store.delete("req_del");
      expect(itemCount("req_del")).toBe(0);
      expect(await store.get("req_del")).toBeUndefined();
    });

    it("delete is not undone by a persistItems microtask queued just before it", async () => {
      // Intent: persistItems queues a coalescing microtask that drains on the
      // next await. delete() awaits base.delete internally, so a naive
      // implementation that cleared the tracking maps AFTER that await would
      // let the queued microtask re-INSERT the rows the DELETE just removed.
      // delete must discard the pending snapshot first, leaving zero rows.
      const store = freshRequestStore();
      await seedRequest(store, "req_race");
      store.persistItems("req_race", [
        makeMessageItem("req_race", "x", 0, "x") as unknown as OutputItem
      ]);
      // No flush/await between persistItems and delete: the microtask is still
      // pending when delete runs and would drain during delete's internal await.
      await store.delete("req_race");
      // Let any stray microtask run, then confirm nothing was resurrected.
      await Promise.resolve();
      expect(itemCount("req_race")).toBe(0);
      expect(await store.get("req_race")).toBeUndefined();
    });

    it("rejects items whose id exceeds the length limit synchronously, before any SQL runs", async () => {
      // Intent: an overlong id is caught application-side and surfaced to the
      // caller — NOT thrown from inside the coalescing microtask, where it
      // would escape as an uncaughtException and crash the process. persistItems
      // validates up front and throws synchronously, so the caller can handle it.
      const store = freshRequestStore();
      await seedRequest(store, "req_big");
      const oversized = "x".repeat(2700);

      expect(() =>
        store.persistItems("req_big", [
          makeMessageItem("req_big", oversized, 0, "x") as unknown as OutputItem
        ])
      ).toThrow(/exceeds limit/i);

      // Nothing was scheduled or written.
      await store.flushItems("req_big");
      expect(itemCount("req_big")).toBe(0);
    });

    it("flushItems is a no-op (synchronous writes already landed)", async () => {
      // Intent: documents the SQLite contract divergence from Postgres — the
      // coalescing microtask completes before any awaited flushItems resumes,
      // so flushItems resolves immediately with the write already durable.
      const store = freshRequestStore();
      await seedRequest(store, "req_flush");
      store.persistItems("req_flush", [
        makeMessageItem("req_flush", "a", 0, "x") as unknown as OutputItem
      ]);
      await store.flushItems("req_flush");
      expect(itemCount("req_flush")).toBe(1);
    });

    // NOTE: the Postgres `firstUpsertGate` drain-race test does not apply here.
    // better-sqlite3 writes are synchronous, so there is no in-flight async
    // UPSERT for a late persistItems to race against — the coalescing
    // microtask always observes the latest snapshot before it runs.
  });

  // --- Content store (FIX-685) ---

  describe("content store", () => {
    it("getByPrefix returns only keys matching the prefix", async () => {
      const s = freshStores();
      await s.content.set("session", "s1", "files/a.ts", "a");
      await s.content.set("session", "s1", "files/b.ts", "b");
      await s.content.set("session", "s1", "notes", "n");

      expect(await s.content.getByPrefix("session", "s1", "files/")).toEqual({
        "files/a.ts": "a",
        "files/b.ts": "b"
      });
    });

    it("getByPrefix with an empty prefix returns all keys in scope", async () => {
      const s = freshStores();
      await s.content.set("session", "s1", "notes", "n");
      await s.content.set("session", "s1", "files/a.ts", "a");

      expect(await s.content.getByPrefix("session", "s1", "")).toEqual({
        notes: "n",
        "files/a.ts": "a"
      });
    });
  });

  describe("resource state store", () => {
    it("set then get round-trips JSON state", async () => {
      const s = freshStores();
      await s.resourceState.set("session", "s1", "files/a.ts", { language: "ts", lines: 10 }, "any");
      expect(await s.resourceState.get("session", "s1", "files/a.ts")).toEqual({
        state: { language: "ts", lines: 10 },
        version: 1
      });
    });

    it("getByPrefix returns only keys matching the prefix", async () => {
      const s = freshStores();
      await s.resourceState.set("session", "s1", "files/a.ts", { v: 1 }, "any");
      await s.resourceState.set("session", "s1", "files/b.ts", { v: 2 }, "any");
      await s.resourceState.set("session", "s1", "notes", { v: 3 }, "any");

      expect(await s.resourceState.getByPrefix("session", "s1", "files/")).toEqual({
        "files/a.ts": { state: { v: 1 }, version: 1 },
        "files/b.ts": { state: { v: 2 }, version: 1 }
      });
    });

    it("delete removes a single key", async () => {
      const s = freshStores();
      await s.resourceState.set("session", "s1", "files/a.ts", { v: 1 }, "any");
      await s.resourceState.delete("session", "s1", "files/a.ts", "any");
      expect(await s.resourceState.get("session", "s1", "files/a.ts")).toBeUndefined();
    });
  });

  // --- User Store ---

  describe("user store", () => {
    it("CRUD operations", async () => {
      const s = freshStores();
      await s.user.set("user_1", makeUserRecord("user_1"), "any");

      const result = await s.user.get("user_1");
      expect(result).toBeDefined();
      expect(result!.userId).toBe("user_1");

      await s.user.delete("user_1");
      expect(await s.user.get("user_1")).toBeUndefined();
    });

    it("list returns all sorted by updatedAt desc", async () => {
      const s = freshStores();
      await s.user.set("u1", { ...makeUserRecord("u1"), updatedAt: 100 }, "any");
      await s.user.set("u2", { ...makeUserRecord("u2"), updatedAt: 300 }, "any");

      const all = await s.user.list();
      expect(all).toHaveLength(2);
      expect(all[0]!.id).toBe("u2");
    });
  });

  // --- Org Store ---

  describe("org store", () => {
    it("CRUD operations", async () => {
      const s = freshStores();
      await s.org.set("proj_1", makeOrgRecord("proj_1", "user_1"), "any");

      const result = await s.org.get("proj_1");
      expect(result).toBeDefined();
      expect(result!.orgId).toBe("proj_1");
      expect(result!.userId).toBe("user_1");

      await s.org.delete("proj_1");
      expect(await s.org.get("proj_1")).toBeUndefined();
    });

    it("list filters by userId", async () => {
      const s = freshStores();
      await s.org.set("proj_1", makeOrgRecord("proj_1", "user_1"), "any");
      await s.org.set("proj_2", makeOrgRecord("proj_2", "user_2"), "any");

      const result = await s.org.list({ userId: "user_1" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("proj_1");
    });
  });

  // --- Active Request Registry ---

  describe("active request registry", () => {
    it("register then get returns the entry", async () => {
      const s = freshStores();
      const entry = {
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now()
      };
      await s.activeRequests.register(entry);

      const result = await s.activeRequests.get("req_1");
      expect(result).toBeDefined();
      expect(result!.requestId).toBe("req_1");
      expect(result!.flowKind).toBe("flow-a");
    });

    it("get non-existent returns undefined", async () => {
      const s = freshStores();
      expect(await s.activeRequests.get("nope")).toBeUndefined();
    });

    it("heartbeat updates lastHeartbeatAt", async () => {
      const s = freshStores();
      const startTime = Date.now() - 10000;
      await s.activeRequests.register({
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        startedAt: startTime,
        lastHeartbeatAt: startTime
      });

      await s.activeRequests.heartbeat("req_1");
      const result = await s.activeRequests.get("req_1");
      expect(result!.lastHeartbeatAt).toBeGreaterThan(startTime);
    });

    it("heartbeat for non-existent is a no-op", async () => {
      const s = freshStores();
      await s.activeRequests.heartbeat("nope"); // should not throw
    });

    it("deregister removes the entry", async () => {
      const s = freshStores();
      await s.activeRequests.register({
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now()
      });

      await s.activeRequests.deregister("req_1");
      expect(await s.activeRequests.get("req_1")).toBeUndefined();
    });

    it("listStale returns entries older than threshold", async () => {
      const s = freshStores();
      const oldTime = Date.now() - 60000;
      const recentTime = Date.now();

      await s.activeRequests.register({
        requestId: "stale_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        startedAt: oldTime,
        lastHeartbeatAt: oldTime
      });
      await s.activeRequests.register({
        requestId: "fresh_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        startedAt: recentTime,
        lastHeartbeatAt: recentTime
      });

      const stale = await s.activeRequests.listStale(30000);
      expect(stale).toHaveLength(1);
      expect(stale[0]!.requestId).toBe("stale_1");
    });

    it("listAll returns all entries", async () => {
      const s = freshStores();
      await s.activeRequests.register({
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now()
      });
      await s.activeRequests.register({
        requestId: "req_2",
        flowKind: "flow-b",
        actionName: "act",
        userId: "user_2",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now()
      });

      const all = await s.activeRequests.listAll();
      expect(all).toHaveLength(2);
    });

    it("register with optional fields round-trips correctly", async () => {
      const s = freshStores();
      await s.activeRequests.register({
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        sessionId: "sess_1",
        userId: "user_1",
        orgId: "proj_1",
        input: { message: "hello" },
        metadata: { source: "test" },
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now()
      });

      const result = await s.activeRequests.get("req_1");
      expect(result!.sessionId).toBe("sess_1");
      expect(result!.orgId).toBe("proj_1");
      expect(result!.input).toEqual({ message: "hello" });
      expect(result!.metadata).toEqual({ source: "test" });
    });
  });

  // --- Complex JSON round-trip ---

  it("complex nested JSON round-trips correctly", async () => {
    const s = freshStores();
    const record = makeSessionRecord("sess_complex", "flow-a", "user_1", {
      state: { nested: { deep: { value: 42 } }, arr: [1, 2, 3] } as Record<string, unknown>,
      resources: { "res-1": { name: "test", data: { x: 1 } } as Record<string, unknown> },
      metadata: { tags: ["a", "b"], config: { key: "val" } }
    });

    await s.session.set("sess_complex", record, "any");
    const result = await s.session.get("sess_complex");
    expect(result!.state).toEqual(record.state);
    expect(result!.resources).toEqual(record.resources);
    expect(result!.metadata).toEqual(record.metadata);
  });

  // --- Drop-in replacement ---

  it("is a drop-in replacement for createInMemoryStores", async () => {
    const s = freshStores();

    // Same operations as the in-memory test in packages/engine/test/stores.test.ts
    await s.session.set("sess_a", makeSessionRecord("sess_a", "flow-a", "user_1"), "any");
    await s.session.set("sess_b", makeSessionRecord("sess_b", "flow-b", "user_2"), "any");
    await s.request.set("req_a", makeRequestRecord("req_a", "flow-a", "run", "user_1", "sess_a"), "any");
    await s.user.set("user_1", makeUserRecord("user_1"), "any");
    await s.org.set("proj_1", makeOrgRecord("proj_1", "user_1"), "any");

    const flowASessions = await s.session.list({ flowKind: "flow-a" });
    const user1Requests = await s.request.list({ userId: "user_1" });
    const userOrgs = await s.org.list({ userId: "user_1" });

    expect(flowASessions).toHaveLength(1);
    expect(flowASessions[0]!.id).toBe("sess_a");
    expect(user1Requests).toHaveLength(1);
    expect(user1Requests[0]!.id).toBe("req_a");
    expect(userOrgs).toHaveLength(1);
    expect((await s.user.get("user_1"))?.userId).toBe("user_1");

    await s.session.delete("sess_b");
    expect(await s.session.get("sess_b")).toBeUndefined();
  });

  // --- Request Event Persistence ---

  describe("request event persistence", () => {
    it("persists and retrieves events in sequence order", async () => {
      const s = freshStores();
      const requestId = "req_events_1";
      await s.request.set(requestId, makeRequestRecord(requestId, "flow-a", "ask", "user_1"), "any");

      const events = [
        {
          stream: "request" as const,
          type: "request.created" as const,
          requestId,
          sequence_number: 1,
          status: "in_progress" as const,
          ts: 100
        },
        {
          stream: "request" as const,
          type: "item.added" as const,
          requestId,
          sequence_number: 2,
          ts: 101,
          item: { id: "item_0", type: "message" as const }
        },
        {
          stream: "request" as const,
          type: "request.completed" as const,
          requestId,
          sequence_number: 3,
          status: "completed" as const,
          ts: 102
        }
      ];

      s.request.persistEvents(requestId, events as any);

      // Allow microtask to flush
      await new Promise((r) => setTimeout(r, 10));

      const retrieved = await s.request.getEvents(requestId);
      expect(retrieved).toHaveLength(3);
      expect(retrieved.map((e: any) => e.sequence_number)).toEqual([1, 2, 3]);
      expect(retrieved[0]!.type).toBe("request.created");
      expect(retrieved[2]!.type).toBe("request.completed");
    });

    it("returns empty array for unknown request", async () => {
      const s = freshStores();
      const events = await s.request.getEvents("nonexistent");
      expect(events).toEqual([]);
    });

    it("overwrites events on re-persist", async () => {
      const s = freshStores();
      const requestId = "req_overwrite";
      await s.request.set(requestId, makeRequestRecord(requestId, "flow-a", "ask", "user_1"), "any");

      s.request.persistEvents(requestId, [
        { stream: "request", type: "request.created", requestId, sequence_number: 1, status: "in_progress", ts: 100 }
      ] as any);

      // Wait for microtask
      await s.request.flushEvents(requestId);

      s.request.persistEvents(requestId, [
        { stream: "request", type: "request.created", requestId, sequence_number: 1, status: "in_progress", ts: 100 },
        { stream: "request", type: "request.completed", requestId, sequence_number: 2, status: "completed", ts: 200 }
      ] as any);

      await s.request.flushEvents(requestId);

      const events = await s.request.getEvents(requestId);
      expect(events).toHaveLength(2);
    });
  });

  // --- runOnce result store (FIX-402) ---

  describe("runOnce result store", () => {
    it("returns { found: false } before any write", async () => {
      const s = freshStores();
      const got = await s.request.getRunOnceResult("req1", "stripe-charge");
      expect(got).toEqual({ found: false });
    });

    it("set then get round-trips JSON-serializable values", async () => {
      const s = freshStores();
      const value = { id: "ch_123", amount: 4200, livemode: false };
      await s.request.setRunOnceResult("req1", "stripe-charge", value);
      const got = await s.request.getRunOnceResult("req1", "stripe-charge");
      expect(got).toEqual({ found: true, value });
    });

    it("upsert overwrites — later writes win on the same (requestId, key)", async () => {
      const s = freshStores();
      await s.request.setRunOnceResult("req1", "k", 1);
      await s.request.setRunOnceResult("req1", "k", 2);
      const got = await s.request.getRunOnceResult("req1", "k");
      expect(got.value).toBe(2);
    });

    it("keys are scoped per request", async () => {
      const s = freshStores();
      await s.request.setRunOnceResult("req1", "k", "A");
      await s.request.setRunOnceResult("req2", "k", "B");
      const r1 = await s.request.getRunOnceResult("req1", "k");
      const r2 = await s.request.getRunOnceResult("req2", "k");
      expect(r1.value).toBe("A");
      expect(r2.value).toBe("B");
    });
  });

  // --- Sequencer checkpoint store (FIX-401) ---

  describe("checkpoint store", () => {
    it("write/read round trip", async () => {
      const s = freshStores();
      await s.checkpoints.write({
        requestId: "r1",
        blockInstanceId: "b1",
        parentBlockInstanceId: null,
        stepIndex: 0,
        state: { count: 5 },
        version: 1,
        createdAt: 1000
      });
      const got = await s.checkpoints.latest("r1", "b1");
      expect(got).not.toBeNull();
      expect(got!.state).toEqual({ count: 5 });
      expect(got!.version).toBe(1);
    });

    it("upsert overwrites — N writes leave one record at the latest version", async () => {
      const s = freshStores();
      for (let v = 1; v <= 5; v += 1) {
        await s.checkpoints.write({
          requestId: "r1",
          blockInstanceId: "b1",
          parentBlockInstanceId: null,
          stepIndex: v,
          state: { count: v },
          version: v,
          createdAt: 1000 + v
        });
      }
      const got = await s.checkpoints.latest("r1", "b1");
      expect(got!.version).toBe(5);
      expect(got!.state).toEqual({ count: 5 });
    });

    it("delete removes record; latest returns null", async () => {
      const s = freshStores();
      await s.checkpoints.write({
        requestId: "r1",
        blockInstanceId: "b1",
        parentBlockInstanceId: null,
        stepIndex: 0,
        state: {},
        version: 1,
        createdAt: 1000
      });
      await s.checkpoints.delete("r1", "b1");
      expect(await s.checkpoints.latest("r1", "b1")).toBeNull();
    });

    it("deleteForRequest removes every checkpoint for the request, leaving others intact", async () => {
      const s = freshStores();
      for (const [r, b] of [["r1", "b1"], ["r1", "b2"], ["r2", "b1"]] as const) {
        await s.checkpoints.write({
          requestId: r,
          blockInstanceId: b,
          parentBlockInstanceId: null,
          stepIndex: 0,
          state: {},
          version: 1,
          createdAt: 1000
        });
      }

      await s.checkpoints.deleteForRequest("r1");

      expect(await s.checkpoints.latest("r1", "b1")).toBeNull();
      expect(await s.checkpoints.latest("r1", "b2")).toBeNull();
      expect(await s.checkpoints.latest("r2", "b1")).not.toBeNull();
    });
  });

  // --- Suspension store retention (FIX-141) ---

  describe("suspension store retention", () => {
    function makeSuspension(
      overrides?: Partial<import("@flow-state-dev/core/types").SuspensionRecord>
    ): import("@flow-state-dev/core/types").SuspensionRecord {
      return {
        suspensionId: "sus_1",
        requestId: "req_1",
        flowKind: "chat",
        actionName: "ask",
        userId: "user_1",
        reason: "human_approval",
        message: "Approve?",
        status: "pending",
        blockInstanceId: "block_1",
        stepIndex: 0,
        createdAt: 1000,
        ...overrides
      };
    }

    it("list({ resolvedBefore }) returns only resolved records before the cutoff", async () => {
      const s = freshStores();
      await s.suspensions.set(
        makeSuspension({ suspensionId: "pending", requestId: "r1", status: "pending" })
      );
      await s.suspensions.set(
        makeSuspension({ suspensionId: "early", requestId: "r2", status: "approved", resolvedAt: 100 })
      );
      await s.suspensions.set(
        makeSuspension({ suspensionId: "late", requestId: "r3", status: "approved", resolvedAt: 300 })
      );

      const results = await s.suspensions.list({ resolvedBefore: 200 });
      expect(results.map((r) => r.suspensionId)).toEqual(["early"]);
    });

    it("list({ createdBefore }) filters by createdAt", async () => {
      const s = freshStores();
      await s.suspensions.set(makeSuspension({ suspensionId: "old", requestId: "r1", createdAt: 100 }));
      await s.suspensions.set(makeSuspension({ suspensionId: "new", requestId: "r2", createdAt: 300 }));

      const results = await s.suspensions.list({ createdBefore: 200 });
      expect(results.map((r) => r.suspensionId)).toEqual(["old"]);
    });

    it("pruneTerminalBefore deletes only terminal records resolved before the cutoff", async () => {
      const s = freshStores();
      await s.suspensions.set(
        makeSuspension({ suspensionId: "t1", requestId: "r1", status: "approved", resolvedAt: 100 })
      );
      await s.suspensions.set(
        makeSuspension({ suspensionId: "t2", requestId: "r2", status: "expired", resolvedAt: 500 })
      );
      await s.suspensions.set(
        makeSuspension({ suspensionId: "p1", requestId: "r3", status: "pending", resolvedAt: 50 })
      );

      const deleted = await s.suspensions.pruneTerminalBefore(200, 100);

      expect(deleted).toBe(1);
      expect(await s.suspensions.get("r1", "t1")).toBeNull();
      expect(await s.suspensions.get("r2", "t2")).not.toBeNull();
      expect(await s.suspensions.get("r3", "p1")).not.toBeNull();
    });

    it("pruneTerminalBefore respects limit and returns the count deleted", async () => {
      const s = freshStores();
      await s.suspensions.set(
        makeSuspension({ suspensionId: "t1", requestId: "r1", status: "approved", resolvedAt: 100 })
      );
      await s.suspensions.set(
        makeSuspension({ suspensionId: "t2", requestId: "r2", status: "rejected", resolvedAt: 100 })
      );

      expect(await s.suspensions.pruneTerminalBefore(200, 1)).toBe(1);
      expect(await s.suspensions.list()).toHaveLength(1);
    });

    it("pruneTerminalBefore returns 0 when nothing matches", async () => {
      const s = freshStores();
      await s.suspensions.set(makeSuspension({ status: "pending" }));

      expect(await s.suspensions.pruneTerminalBefore(Date.now() + 1000, 100)).toBe(0);
    });

    it("migration backfills legacy NULL status/resolved_at columns so they become prunable", async () => {
      // Regression: a terminal suspension resolved before the FIX-141 migration
      // is never re-set(), so its denormalized scalar columns would stay NULL
      // and pruneTerminalBefore (which filters on status/resolved_at) would
      // never reap it. Insert a row raw to simulate the pre-migration shape.
      const db = new Database(":memory:");
      initializeSchema(db);
      const record = makeSuspension({
        suspensionId: "legacy",
        requestId: "rL",
        status: "approved",
        resolvedAt: 100
      });
      db.prepare(
        `INSERT INTO suspension_records (request_id, suspension_id, data, created_at, status, resolved_at)
         VALUES (?, ?, ?, ?, NULL, NULL)`
      ).run("rL", "legacy", JSON.stringify(record), record.createdAt);

      // Re-running schema init backfills the NULL scalar columns from the blob.
      initializeSchema(db);

      const store = createSQLiteSuspensionStore(db);
      expect(await store.pruneTerminalBefore(200, 100)).toBe(1);
      expect(await store.get("rL", "legacy")).toBeNull();
    });
  });

  // --- Trace store (FIX-506) ---
  // Conformance is asserted by the shared `createTraceStoreConformanceTests`
  // suite below; this file no longer carries the old inline duplicates.
});

// `createTraceStoreConformanceTests` opens a fresh registry per case via the
// `createStore` callback and closes it via `cleanup`. The `WeakMap` lookup
// avoids leaking the registry handle out through the conformance API.
const sqliteStoreHandles = new WeakMap<TraceStore, SQLiteStoreRegistry>();

createTraceStoreConformanceTests({
  name: "SQLiteTraceStore",
  createStore: (options) => {
    const handle = createSQLiteStores({
      filename: ":memory:",
      traceStore: options
    });
    sqliteStoreHandles.set(handle.traces, handle);
    return handle.traces;
  },
  cleanup: (store) => {
    sqliteStoreHandles.get(store)?.close();
    sqliteStoreHandles.delete(store);
  }
});
