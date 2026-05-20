import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type {
  OrgRecord,
  RequestRecord,
  SessionRecord,
  UserRecord
} from "@flow-state-dev/server";
import { createPostgresStores, type PostgresStoreRegistry } from "../src";
import type { QueryExecutor } from "../src";

/** Wrap PGlite to match the QueryExecutor interface */
function pgliteExecutor(pglite: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? 0
      };
    }
  };
}

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

describe("PostgreSQL store adapter", () => {
  let stores: PostgresStoreRegistry;
  let pglite: PGlite;

  afterEach(async () => {
    await stores?.close();
    await pglite?.close();
  });

  async function freshStores(): Promise<PostgresStoreRegistry> {
    pglite = new PGlite();
    const executor = pgliteExecutor(pglite);
    stores = await createPostgresStores({ executor });
    return stores;
  }

  // --- Schema ---

  it("initializes schema idempotently", async () => {
    const s = await freshStores();
    expect(s.session).toBeDefined();
    expect(s.request).toBeDefined();
    expect(s.user).toBeDefined();
    expect(s.org).toBeDefined();
    expect(s.activeRequests).toBeDefined();
  });

  // --- Session Store ---

  describe("session store", () => {
    it("set then get returns the record", async () => {
      const s = await freshStores();
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
      const s = await freshStores();
      expect(await s.session.get("nope")).toBeUndefined();
    });

    it("upsert updates record", async () => {
      const s = await freshStores();
      const record = makeSessionRecord("sess_1", "flow-a", "user_1");
      await s.session.set("sess_1", record, "any");

      const updated = { ...record, version: 1, updatedAt: now() + 100 };
      await s.session.set("sess_1", updated, "any");

      const result = await s.session.get("sess_1");
      expect(result!.version).toBe(1);
    });

    it("delete removes record", async () => {
      const s = await freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"), "any");
      await s.session.delete("sess_1");
      expect(await s.session.get("sess_1")).toBeUndefined();
    });

    it("delete non-existent is a no-op", async () => {
      const s = await freshStores();
      await s.session.delete("nope"); // should not throw
    });

    it("list returns all records sorted by updatedAt desc", async () => {
      const s = await freshStores();
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
      const s = await freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"), "any");
      await s.session.set("sess_2", makeSessionRecord("sess_2", "flow-b", "user_2"), "any");

      const result = await s.session.list({ flowKind: "flow-a" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("sess_1");
    });

    it("list filters by userId", async () => {
      const s = await freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"), "any");
      await s.session.set("sess_2", makeSessionRecord("sess_2", "flow-b", "user_2"), "any");

      const result = await s.session.list({ userId: "user_1" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("sess_1");
    });

    it("list with limit and offset", async () => {
      const s = await freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1", { updatedAt: 100 }), "any");
      await s.session.set("sess_2", makeSessionRecord("sess_2", "flow-a", "user_1", { updatedAt: 200 }), "any");
      await s.session.set("sess_3", makeSessionRecord("sess_3", "flow-a", "user_1", { updatedAt: 300 }), "any");

      const page = await s.session.list({ limit: 1, offset: 1 });
      expect(page).toHaveLength(1);
      expect(page[0]!.id).toBe("sess_2");
    });

    it("list with offset beyond total returns empty", async () => {
      const s = await freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"), "any");
      expect(await s.session.list({ offset: 100 })).toHaveLength(0);
    });

    it("list with limit 0 returns empty", async () => {
      const s = await freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"), "any");
      expect(await s.session.list({ limit: 0 })).toHaveLength(0);
    });
  });

  // --- Request Store ---

  describe("request store", () => {
    it("set then get returns the record", async () => {
      const s = await freshStores();
      const record = makeRequestRecord("req_1", "flow-a", "run", "user_1", "sess_1");
      await s.request.set("req_1", record, "any");

      const result = await s.request.get("req_1");
      expect(result).toBeDefined();
      expect(result!.id).toBe("req_1");
      expect(result!.actionName).toBe("run");
      expect(result!.status).toBe("in_progress");
    });

    it("filters by flowKind", async () => {
      const s = await freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1"), "any");
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-b", "run", "user_1"), "any");

      expect(await s.request.list({ flowKind: "flow-a" })).toHaveLength(1);
    });

    it("filters by sessionId", async () => {
      const s = await freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1", "sess_1"), "any");
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-a", "run", "user_1", "sess_2"), "any");

      const result = await s.request.list({ sessionId: "sess_1" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("req_1");
    });

    it("filters by userId", async () => {
      const s = await freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1"), "any");
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-a", "run", "user_2"), "any");

      expect(await s.request.list({ userId: "user_1" })).toHaveLength(1);
    });

    it("filters by status", async () => {
      const s = await freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1", undefined, { status: "completed" }), "any");
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-a", "run", "user_1", undefined, { status: "in_progress" }), "any");

      const result = await s.request.list({ status: "completed" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("req_1");
    });

    it("filters by status interrupted", async () => {
      const s = await freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1", undefined, { status: "interrupted", interruptedAt: Date.now() }), "any");
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-a", "run", "user_1", undefined, { status: "in_progress" }), "any");

      const result = await s.request.list({ status: "interrupted" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("req_1");
      expect(result[0]!.interruptedAt).toBeDefined();
    });

    it("delete removes and is no-op for non-existent", async () => {
      const s = await freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1"), "any");
      await s.request.delete("req_1");
      expect(await s.request.get("req_1")).toBeUndefined();
      await s.request.delete("nope"); // should not throw
    });

    it("persistItems updates items on the record", async () => {
      const s = await freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1"), "any");

      const items = [makeMessageItem("req_1", "msg_1", 1, "hello")] as any;
      s.request.persistItems("req_1", items);
      await s.request.flushItems("req_1");

      const result = await s.request.get("req_1");
      expect(result!.items).toBeDefined();
      expect(result!.items).toHaveLength(1);
      expect(result!.items![0]!.id).toBe("msg_1");
    });
  });

  // --- FIX-657: request_items table ---

  describe("request_items (FIX-657)", () => {
    it("creates the request_items table and ordering index", async () => {
      const s = await freshStores();
      const executor = pgliteExecutor(pglite);
      const t = await executor.query(
        "SELECT to_regclass('request_items') AS r"
      );
      expect((t.rows[0] as any).r).toBe("request_items");
      const i = await executor.query(
        "SELECT to_regclass('idx_request_items_request_sequence') AS r"
      );
      expect((i.rows[0] as any).r).toBe("idx_request_items_request_sequence");
      // Drop unused binding warning.
      void s;
    });

    it("unnest-based UPSERT lands two rows with typed-array params", async () => {
      const s = await freshStores();
      await s.request.set(
        "req_unnest",
        makeRequestRecord("req_unnest", "flow-a", "run", "u"),
        "any"
      );
      s.request.persistItems("req_unnest", [
        makeMessageItem("req_unnest", "a", 0, "x") as any,
        makeMessageItem("req_unnest", "b", 1, "y") as any
      ]);
      await s.request.flushItems("req_unnest");
      const executor = pgliteExecutor(pglite);
      const result = await executor.query(
        "SELECT count(*) AS c FROM request_items WHERE request_id = $1",
        ["req_unnest"]
      );
      expect(Number((result.rows[0] as any).c)).toBe(2);
    });

    it("upserts only the changed item when one reference changes", async () => {
      const s = await freshStores();
      await s.request.set(
        "req_diff",
        makeRequestRecord("req_diff", "flow-a", "run", "u"),
        "any"
      );
      const a = makeMessageItem("req_diff", "a", 0, "first-a");
      const b = makeMessageItem("req_diff", "b", 1, "first-b");
      s.request.persistItems("req_diff", [a, b] as any);
      await s.request.flushItems("req_diff");

      const b2 = makeMessageItem("req_diff", "b", 1, "second-b");
      // Same reference for `a` (no-op), new reference for `b` (UPSERT).
      s.request.persistItems("req_diff", [a, b2] as any);
      await s.request.flushItems("req_diff");

      const got = await s.request.get("req_diff");
      const items = got!.items!;
      const aRow = items.find((i: any) => i.id === "a") as any;
      const bRow = items.find((i: any) => i.id === "b") as any;
      expect(aRow.content[0].text).toBe("first-a");
      expect(bRow.content[0].text).toBe("second-b");
    });

    it("second flush is a no-op when no references changed", async () => {
      const s = await freshStores();
      await s.request.set(
        "req_noop",
        makeRequestRecord("req_noop", "flow-a", "run", "u"),
        "any"
      );
      const item = makeMessageItem("req_noop", "a", 0, "x");
      s.request.persistItems("req_noop", [item] as any);
      await s.request.flushItems("req_noop");

      // Spy on executor to count UPSERTs after the steady-state is reached.
      const executor = pgliteExecutor(pglite);
      const before = await executor.query(
        "SELECT count(*) AS c FROM request_items WHERE request_id = $1",
        ["req_noop"]
      );
      expect(Number((before.rows[0] as any).c)).toBe(1);

      // Persist the same reference again — should not change row count or data.
      s.request.persistItems("req_noop", [item] as any);
      await s.request.flushItems("req_noop");

      const after = await executor.query(
        "SELECT count(*) AS c FROM request_items WHERE request_id = $1",
        ["req_noop"]
      );
      expect(Number((after.rows[0] as any).c)).toBe(1);
    });

    it("keyed item upsert updates row and sequence on re-emit", async () => {
      const s = await freshStores();
      await s.request.set(
        "req_keyed",
        makeRequestRecord("req_keyed", "flow-a", "run", "u"),
        "any"
      );
      const keyed = "item_component_keyed:task-board";
      const first = makeMessageItem("req_keyed", keyed, 5, "v1");
      s.request.persistItems("req_keyed", [first] as any);
      await s.request.flushItems("req_keyed");
      const second = makeMessageItem("req_keyed", keyed, 12, "v2");
      s.request.persistItems("req_keyed", [second] as any);
      await s.request.flushItems("req_keyed");

      const executor = pgliteExecutor(pglite);
      const got = await executor.query(
        "SELECT sequence, data FROM request_items WHERE request_id = $1",
        ["req_keyed"]
      );
      expect(got.rows).toHaveLength(1);
      expect(Number((got.rows[0] as any).sequence)).toBe(12);
    });

    it("get returns legacy data.items when request_items has no rows", async () => {
      const s = await freshStores();
      const legacyItem = makeMessageItem("legacy_1", "legacy_a", 0, "legacy-x");
      // Seed the legacy shape: items live inside data.items on the
      // requests row, with no rows in request_items.
      const record = makeRequestRecord("legacy_1", "flow-a", "run", "u", "sess", {
        items: [legacyItem as any]
      });
      // Bypass the new strip-on-set by writing the JSONB directly.
      const executor = pgliteExecutor(pglite);
      await executor.query(
        "INSERT INTO requests (id, flow_kind, user_id, session_id, org_id, status, version, created_at, updated_at, data) " +
          "VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9::jsonb)",
        [
          "legacy_1",
          record.flowKind,
          record.userId,
          record.sessionId ?? null,
          record.status,
          record.version,
          record.createdAt,
          record.updatedAt,
          JSON.stringify(record)
        ]
      );
      const got = await s.request.get("legacy_1");
      expect(got!.items).toHaveLength(1);
      expect(got!.items![0]!.id).toBe("legacy_a");
    });

    it("merges legacy data.items with request_items rows, table-wins on collision", async () => {
      const s = await freshStores();
      const legacyA = makeMessageItem("merge_1", "shared", 0, "legacy-version");
      const legacyB = makeMessageItem("merge_1", "legacy-only", 1, "legacy-b");
      const record = makeRequestRecord("merge_1", "flow-a", "run", "u", "sess", {
        items: [legacyA as any, legacyB as any]
      });
      const executor = pgliteExecutor(pglite);
      await executor.query(
        "INSERT INTO requests (id, flow_kind, user_id, session_id, org_id, status, version, created_at, updated_at, data) " +
          "VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9::jsonb)",
        [
          "merge_1",
          record.flowKind,
          record.userId,
          record.sessionId ?? null,
          record.status,
          record.version,
          record.createdAt,
          record.updatedAt,
          JSON.stringify(record)
        ]
      );
      // Write the table version for `shared` with new content (table wins).
      const tableShared = makeMessageItem("merge_1", "shared", 2, "table-version");
      const tableC = makeMessageItem("merge_1", "table-only", 3, "table-c");
      s.request.persistItems("merge_1", [tableShared, tableC] as any);
      await s.request.flushItems("merge_1");

      const got = await s.request.get("merge_1");
      expect(got!.items).toHaveLength(3);
      const sharedRow = got!.items!.find((i) => i.id === "shared") as any;
      expect(sharedRow.content[0].text).toBe("table-version");
      // Ordered by itemIndex: legacy-only (1), shared (2), table-only (3)
      expect(got!.items!.map((i) => i.id)).toEqual([
        "legacy-only",
        "shared",
        "table-only"
      ]);
    });

    it("list default leaves items undefined", async () => {
      const s = await freshStores();
      await s.request.set(
        "req_l1",
        makeRequestRecord("req_l1", "flow-a", "run", "u", "sess_L"),
        "any"
      );
      s.request.persistItems("req_l1", [
        makeMessageItem("req_l1", "a", 0, "x") as any
      ]);
      await s.request.flushItems("req_l1");

      const out = await s.request.list({ sessionId: "sess_L" });
      expect(out).toHaveLength(1);
      expect(out[0]!.items).toBeUndefined();
    });

    it("list with withItems:true populates items, merging legacy + table", async () => {
      const s = await freshStores();
      await s.request.set(
        "req_l2",
        makeRequestRecord("req_l2", "flow-a", "run", "u", "sess_L2"),
        "any"
      );
      s.request.persistItems("req_l2", [
        makeMessageItem("req_l2", "a", 0, "x") as any,
        makeMessageItem("req_l2", "b", 1, "y") as any
      ]);
      await s.request.flushItems("req_l2");

      const out = await s.request.list({ sessionId: "sess_L2", withItems: true });
      expect(out).toHaveLength(1);
      expect(out[0]!.items).toHaveLength(2);
      expect(out[0]!.items!.map((i) => i.id)).toEqual(["a", "b"]);
    });

    it("list with withItems:true against an empty session returns []", async () => {
      const s = await freshStores();
      const out = await s.request.list({
        sessionId: "no_such_session",
        withItems: true
      });
      expect(out).toEqual([]);
    });

    it("set strips items from JSONB serialization", async () => {
      const s = await freshStores();
      const record = makeRequestRecord("req_strip", "flow-a", "run", "u");
      record.items = [makeMessageItem("req_strip", "x", 0, "x") as any];
      await s.request.set("req_strip", record, "any");

      const executor = pgliteExecutor(pglite);
      const got = await executor.query(
        "SELECT data->'items' AS items FROM requests WHERE id = $1",
        ["req_strip"]
      );
      expect((got.rows[0] as any).items).toBeNull();
    });

    it("terminal set clears lastPersistedItems so a re-persist re-upserts", async () => {
      const s = await freshStores();
      await s.request.set(
        "req_term",
        makeRequestRecord("req_term", "flow-a", "run", "u"),
        "any"
      );
      const item = makeMessageItem("req_term", "x", 0, "v1");
      s.request.persistItems("req_term", [item] as any);
      await s.request.flushItems("req_term");

      // Terminal write clears the per-request reference map.
      await s.request.set(
        "req_term",
        makeRequestRecord("req_term", "flow-a", "run", "u", undefined, {
          status: "completed",
          completedAtMs: Date.now()
        }),
        "any"
      );

      // Same item reference, but the prior map is gone — flush issues
      // an UPSERT (idempotent, count unchanged).
      s.request.persistItems("req_term", [item] as any);
      await s.request.flushItems("req_term");
      const executor = pgliteExecutor(pglite);
      const got = await executor.query(
        "SELECT count(*) AS c FROM request_items WHERE request_id = $1",
        ["req_term"]
      );
      expect(Number((got.rows[0] as any).c)).toBe(1);
    });

    it("delete awaits pending flush and removes rows from request_items", async () => {
      const s = await freshStores();
      await s.request.set(
        "req_del",
        makeRequestRecord("req_del", "flow-a", "run", "u"),
        "any"
      );
      s.request.persistItems("req_del", [
        makeMessageItem("req_del", "x", 0, "x") as any
      ]);
      // Do NOT await flushItems — delete must drain the queue itself.
      await s.request.delete("req_del");

      const executor = pgliteExecutor(pglite);
      const got = await executor.query(
        "SELECT count(*) AS c FROM request_items WHERE request_id = $1",
        ["req_del"]
      );
      expect(Number((got.rows[0] as any).c)).toBe(0);
    });

    it("rejects items with id longer than the index row size limit", async () => {
      const s = await freshStores();
      await s.request.set(
        "req_big",
        makeRequestRecord("req_big", "flow-a", "run", "u"),
        "any"
      );
      const oversized = "x".repeat(2700);
      s.request.persistItems("req_big", [
        makeMessageItem("req_big", oversized, 0, "x") as any
      ]);
      await expect(s.request.flushItems("req_big")).rejects.toThrow(
        /exceeds limit/i
      );
    });

    it("1000 sequential persistItems calls coalesce to one row per item", async () => {
      const s = await freshStores();
      await s.request.set(
        "req_coal",
        makeRequestRecord("req_coal", "flow-a", "run", "u"),
        "any"
      );
      const items = [
        makeMessageItem("req_coal", "a", 0, "x"),
        makeMessageItem("req_coal", "b", 1, "y")
      ];
      for (let i = 0; i < 1000; i += 1) {
        s.request.persistItems("req_coal", items as any);
      }
      await s.request.flushItems("req_coal");
      const executor = pgliteExecutor(pglite);
      const got = await executor.query(
        "SELECT count(*) AS c FROM request_items WHERE request_id = $1",
        ["req_coal"]
      );
      expect(Number((got.rows[0] as any).c)).toBe(2);
    });

    it("flushItems drains snapshots queued during an in-flight flush", async () => {
      // Regression for the coalescing race: persistItems(A) queues a flush;
      // while that flush is awaiting the UPSERT, persistItems(B) lands. The
      // early-return contract means no second microtask is scheduled — the
      // in-flight flush must loop and pick up B before settling, otherwise
      // flushItems returns with B's rows still missing from the DB.
      //
      // PGlite's query is synchronous, so a bare `await Promise.resolve()`
      // doesn't yield long enough for the race to materialize. Wrap the
      // executor in a delay-on-INSERT shim so the UPSERT genuinely
      // suspends — that's what real Postgres does.
      pglite = new PGlite();
      const raw = pgliteExecutor(pglite);
      let upsertCount = 0;
      let resolveFirstUpsert: (() => void) | undefined;
      const firstUpsertGate = new Promise<void>((r) => {
        resolveFirstUpsert = r;
      });
      const gate: QueryExecutor = {
        async query(text, values) {
          if (text.startsWith("INSERT INTO request_items")) {
            upsertCount += 1;
            if (upsertCount === 1) await firstUpsertGate;
          }
          return raw.query(text, values);
        }
      };
      stores = await createPostgresStores({ executor: gate });

      await stores.request.set(
        "req_race",
        makeRequestRecord("req_race", "flow-a", "run", "u"),
        "any"
      );
      const a = makeMessageItem("req_race", "a", 0, "x");
      const b = makeMessageItem("req_race", "b", 1, "y");
      stores.request.persistItems("req_race", [a] as any);
      // Let microtasks run so doFlushRequestItems reaches the gated UPSERT.
      await new Promise((r) => setTimeout(r, 10));
      // persistItems(B) lands DURING the awaited first INSERT.
      stores.request.persistItems("req_race", [a, b] as any);
      resolveFirstUpsert!();

      await stores.request.flushItems("req_race");

      const got = await raw.query(
        "SELECT count(*) AS c FROM request_items WHERE request_id = $1",
        ["req_race"]
      );
      expect(Number((got.rows[0] as any).c)).toBe(2);
    });

    it("concurrent persistItems on different requests do not interfere", async () => {
      const s = await freshStores();
      await s.request.set(
        "req_iso_a",
        makeRequestRecord("req_iso_a", "flow-a", "run", "u"),
        "any"
      );
      await s.request.set(
        "req_iso_b",
        makeRequestRecord("req_iso_b", "flow-a", "run", "u"),
        "any"
      );
      s.request.persistItems("req_iso_a", [
        makeMessageItem("req_iso_a", "a", 0, "x") as any
      ]);
      s.request.persistItems("req_iso_b", [
        makeMessageItem("req_iso_b", "b", 0, "y") as any
      ]);
      await Promise.all([
        s.request.flushItems("req_iso_a"),
        s.request.flushItems("req_iso_b")
      ]);
      const executor = pgliteExecutor(pglite);
      const got = await executor.query(
        "SELECT request_id, count(*) AS c FROM request_items GROUP BY request_id ORDER BY request_id"
      );
      expect(got.rows).toHaveLength(2);
      expect(Number((got.rows[0] as any).c)).toBe(1);
      expect(Number((got.rows[1] as any).c)).toBe(1);
    });
  });

  // --- User Store ---

  describe("user store", () => {
    it("CRUD operations", async () => {
      const s = await freshStores();
      await s.user.set("user_1", makeUserRecord("user_1"), "any");

      const result = await s.user.get("user_1");
      expect(result).toBeDefined();
      expect(result!.userId).toBe("user_1");

      await s.user.delete("user_1");
      expect(await s.user.get("user_1")).toBeUndefined();
    });

    it("list returns all sorted by updatedAt desc", async () => {
      const s = await freshStores();
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
      const s = await freshStores();
      await s.org.set("proj_1", makeOrgRecord("proj_1", "user_1"), "any");

      const result = await s.org.get("proj_1");
      expect(result).toBeDefined();
      expect(result!.orgId).toBe("proj_1");
      expect(result!.userId).toBe("user_1");

      await s.org.delete("proj_1");
      expect(await s.org.get("proj_1")).toBeUndefined();
    });

    it("list filters by userId", async () => {
      const s = await freshStores();
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
      const s = await freshStores();
      const entry = {
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        source: "http",
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
      const s = await freshStores();
      expect(await s.activeRequests.get("nope")).toBeUndefined();
    });

    it("heartbeat updates lastHeartbeatAt", async () => {
      const s = await freshStores();
      const startTime = Date.now() - 10000;
      await s.activeRequests.register({
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        source: "http",
        startedAt: startTime,
        lastHeartbeatAt: startTime
      });

      await s.activeRequests.heartbeat("req_1");
      const result = await s.activeRequests.get("req_1");
      expect(result!.lastHeartbeatAt).toBeGreaterThan(startTime);
    });

    it("heartbeat for non-existent is a no-op", async () => {
      const s = await freshStores();
      await s.activeRequests.heartbeat("nope"); // should not throw
    });

    it("deregister removes the entry", async () => {
      const s = await freshStores();
      await s.activeRequests.register({
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        source: "http",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now()
      });

      await s.activeRequests.deregister("req_1");
      expect(await s.activeRequests.get("req_1")).toBeUndefined();
    });

    it("listStale returns entries older than threshold", async () => {
      const s = await freshStores();
      const oldTime = Date.now() - 60000;
      const recentTime = Date.now();

      await s.activeRequests.register({
        requestId: "stale_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        source: "http",
        startedAt: oldTime,
        lastHeartbeatAt: oldTime
      });
      await s.activeRequests.register({
        requestId: "fresh_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        source: "http",
        startedAt: recentTime,
        lastHeartbeatAt: recentTime
      });

      const stale = await s.activeRequests.listStale(30000);
      expect(stale).toHaveLength(1);
      expect(stale[0]!.requestId).toBe("stale_1");
    });

    it("listAll returns all entries", async () => {
      const s = await freshStores();
      await s.activeRequests.register({
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        source: "http",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now()
      });
      await s.activeRequests.register({
        requestId: "req_2",
        flowKind: "flow-b",
        actionName: "act",
        userId: "user_2",
        source: "http",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now()
      });

      const all = await s.activeRequests.listAll();
      expect(all).toHaveLength(2);
    });

    it("register with optional fields round-trips correctly", async () => {
      const s = await freshStores();
      await s.activeRequests.register({
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        sessionId: "sess_1",
        userId: "user_1",
        orgId: "proj_1",
        source: "webhook",
        input: { message: "hello" },
        metadata: { source: "test" },
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now()
      });

      const result = await s.activeRequests.get("req_1");
      expect(result!.sessionId).toBe("sess_1");
      expect(result!.orgId).toBe("proj_1");
      expect(result!.source).toBe("webhook");
      expect(result!.input).toEqual({ message: "hello" });
      expect(result!.metadata).toEqual({ source: "test" });
    });
  });

  // --- Complex JSON round-trip ---

  it("complex nested JSON round-trips correctly", async () => {
    const s = await freshStores();
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
    const s = await freshStores();

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
      const s = await freshStores();
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
      await s.request.flushEvents(requestId);

      const retrieved = await s.request.getEvents(requestId);
      expect(retrieved).toHaveLength(3);
      expect(retrieved.map((e: any) => e.sequence_number)).toEqual([1, 2, 3]);
      expect(retrieved[0]!.type).toBe("request.created");
      expect(retrieved[2]!.type).toBe("request.completed");
    });

    it("returns empty array for unknown request", async () => {
      const s = await freshStores();
      const events = await s.request.getEvents("nonexistent");
      expect(events).toEqual([]);
    });

    it("overwrites events on re-persist", async () => {
      const s = await freshStores();
      const requestId = "req_overwrite";
      await s.request.set(requestId, makeRequestRecord(requestId, "flow-a", "ask", "user_1"), "any");

      s.request.persistEvents(requestId, [
        { stream: "request", type: "request.created", requestId, sequence_number: 1, status: "in_progress", ts: 100 }
      ] as any);
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
      const s = await freshStores();
      const got = await s.request.getRunOnceResult("req1", "stripe-charge");
      expect(got).toEqual({ found: false });
    });

    it("set then get round-trips JSON-serializable values", async () => {
      const s = await freshStores();
      const value = { id: "ch_123", amount: 4200, livemode: false };
      await s.request.setRunOnceResult("req1", "stripe-charge", value);
      const got = await s.request.getRunOnceResult("req1", "stripe-charge");
      expect(got).toEqual({ found: true, value });
    });

    it("upsert overwrites — later writes win on the same (requestId, key)", async () => {
      const s = await freshStores();
      await s.request.setRunOnceResult("req1", "k", 1);
      await s.request.setRunOnceResult("req1", "k", 2);
      const got = await s.request.getRunOnceResult("req1", "k");
      expect(got.value).toBe(2);
    });

    it("keys are scoped per request", async () => {
      const s = await freshStores();
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
      const s = await freshStores();
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
      const s = await freshStores();
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
      const s = await freshStores();
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
  });
});
