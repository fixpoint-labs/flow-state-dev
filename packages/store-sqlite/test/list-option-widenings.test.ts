/**
 * FIX-1010 — the list-option widenings on the SQLite adapter, plus the index
 * selection the two new query shapes depend on.
 *
 * The behaviour matrix mirrors `packages/engine/test/list-option-widenings.test.ts`
 * case for case. This adapter cannot import the shared predicates (type-only
 * package boundary), so it reproduces them in its `WHERE` and `ORDER BY`
 * builders — an adapter that diverges is the exact failure this coverage
 * exists to catch.
 *
 * **What the plan assertions are, and what they are NOT.** They assert *index
 * selection*: a `SEARCH` rather than a `SCAN`, naming an index that covers the
 * shape's selective equality predicates, and no temporary b-tree for the
 * ordered shapes. They are **not** a cost bound, and must not be described as
 * one. SQLite exposes no `EXPLAIN ANALYZE`, no per-node row counters through
 * `better-sqlite3`, and `EXPLAIN QUERY PLAN` output is insensitive to filtered
 * rows — it reports the identical plan whether the query discards one row or
 * five hundred. A plan-shape differential would therefore read green against
 * exactly the linear growth the cost property prohibits, which is worse than
 * no check because it manufactures confidence. The cost guarantee is verified
 * on Postgres and is a stated limitation here.
 *
 * Closeable if the driver ever exposes `sqlite3_stmt_scanstatus` (needs the
 * `SQLITE_ENABLE_STMT_SCANSTATUS` build flag) or a progress-handler step
 * count. Neither is available today.
 */
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { RequestRecord, SessionRecord } from "@flow-state-dev/engine";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src";
import { createSQLiteRequestStore } from "../src/request-store";
import { initializeSchema } from "../src/schema";

let stores: SQLiteStoreRegistry | undefined;

afterEach(() => {
  stores?.close();
  stores = undefined;
});

function fresh(): SQLiteStoreRegistry {
  stores = createSQLiteStores({ filename: ":memory:" });
  return stores;
}

function session(id: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    flowKind: "chat",
    userId: "alice",
    state: {},
    version: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    journal: [],
    ...overrides
  };
}

function request(id: string, overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id,
    flowKind: "chat",
    actionName: "run",
    userId: "alice",
    sessionId: "sess",
    source: "http",
    status: "completed",
    startedAtMs: 1_000,
    state: {},
    version: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides
  };
}

describe("SQLite list-option widenings", () => {
  it("session orgId filters exactly, NULL-safely, and only when the key is present", async () => {
    const s = fresh();
    await s.session.set("bound", session("bound", { orgId: "acme", parentSessionId: "p" }), "any");
    await s.session.set("other", session("other", { orgId: "globex", parentSessionId: "p" }), "any");
    await s.session.set("unbound", session("unbound", { parentSessionId: "p" }), "any");

    const parentage = { parentOf: "p" } as const;
    expect((await s.session.list({ orgId: "acme", parentage })).map((r) => r.id)).toEqual([
      "bound"
    ]);
    // `IS ?` rather than `=` — an equality predicate never matches a NULL.
    expect(
      (await s.session.list({ orgId: undefined, parentage })).map((r) => r.id)
    ).toEqual(["unbound"]);
    expect((await s.session.list({ parentage })).map((r) => r.id).sort()).toEqual([
      "bound",
      "other",
      "unbound"
    ]);
  });

  it("request orgId filters exactly, with the same present-vs-absent rule", async () => {
    const s = fresh();
    await s.request.set("r_acme", request("r_acme", { orgId: "acme" }), "any");
    await s.request.set("r_unbound", request("r_unbound"), "any");

    expect((await s.request.list({ orgId: "acme" })).map((r) => r.id)).toEqual(["r_acme"]);
    expect((await s.request.list({ orgId: undefined })).map((r) => r.id)).toEqual([
      "r_unbound"
    ]);
    expect((await s.request.list({})).length).toBe(2);
  });

  /**
   * The in-process mirror of this matrix asserts that a record encoding
   * "unbound" as `null` is the same record as one omitting the key. This is
   * that case on SQLite — the adapter that was already right, kept honest so
   * the two cannot drift apart again.
   *
   * Org and tenant share one case here, unlike the in-process suite where they
   * are separate predicates: on this adapter both are the same `IS ?`
   * emission, so splitting them would assert the same mechanism twice.
   */
  it("treats a null-encoded org or tenant binding as unbound", async () => {
    const s = fresh();
    await s.session.set(
      "nulled",
      session("nulled", {
        parentSessionId: "p",
        ...({ orgId: null, tenantId: null } as Partial<SessionRecord>)
      }),
      "any"
    );
    await s.request.set(
      "r_nulled",
      request("r_nulled", {
        ...({ orgId: null, tenantId: null } as Partial<RequestRecord>)
      }),
      "any"
    );

    const parentage = { parentOf: "p" } as const;
    expect(
      (await s.session.list({ orgId: undefined, parentage })).map((r) => r.id)
    ).toEqual(["nulled"]);
    expect(
      (await s.session.list({ tenantId: undefined, parentage })).map((r) => r.id)
    ).toEqual(["nulled"]);
    expect((await s.request.list({ orgId: undefined })).map((r) => r.id)).toEqual([
      "r_nulled"
    ]);
    expect((await s.request.list({ tenantId: undefined })).map((r) => r.id)).toEqual([
      "r_nulled"
    ]);
  });

  it("a status array matches set membership; a single status still matches by equality", async () => {
    const s = fresh();
    for (const status of ["in_progress", "suspended", "completed", "failed"] as const) {
      await s.request.set(`r_${status}`, request(`r_${status}`, { status }), "any");
    }

    expect(
      (await s.request.list({ status: ["in_progress", "suspended"] }))
        .map((r) => r.id)
        .sort()
    ).toEqual(["r_in_progress", "r_suspended"]);
    expect((await s.request.list({ status: "failed" })).map((r) => r.id)).toEqual([
      "r_failed"
    ]);
    expect(await s.request.list({ status: [] })).toEqual([]);
    expect((await s.request.list({})).length).toBe(4);
  });

  it("orderBy: none emits no ORDER BY, and limit 1 still returns one row", async () => {
    const s = fresh();
    for (const status of ["in_progress", "suspended"] as const) {
      await s.request.set(`r_${status}`, request(`r_${status}`, { status }), "any");
    }

    const rows = await s.request.list({
      status: ["in_progress", "suspended"],
      orderBy: "none",
      limit: 1
    });
    expect(rows).toHaveLength(1);
  });

  it("session orderBy: createdAt is stable when updatedAt is rewritten; the default still moves", async () => {
    const s = fresh();
    for (let i = 0; i < 4; i++) {
      await s.session.set(
        `s_${i}`,
        session(`s_${i}`, { parentSessionId: "p", createdAt: 1_000 + i, updatedAt: 1_000 + i }),
        "any"
      );
    }
    const options = { parentage: { parentOf: "p" } as const, orderBy: "createdAt" as const };
    const before = (await s.session.list(options)).map((r) => r.id);

    const moved = await s.session.get("s_0");
    await s.session.set(
      "s_0",
      { ...(moved as SessionRecord), latestRequestId: "req_x", updatedAt: 9_999 },
      "any"
    );

    expect((await s.session.list(options)).map((r) => r.id)).toEqual(before);
    expect((await s.session.list({ parentage: { parentOf: "p" } }))[0]!.id).toBe("s_0");
  });

  it("request orderBy: startedAtMs breaks an exact tie on id, stably", async () => {
    const s = fresh();
    for (const id of ["r_a", "r_d", "r_b", "r_c"]) {
      await s.request.set(id, request(id, { startedAtMs: 5_000, createdAt: 5_000 }), "any");
    }

    const first = await s.request.list({ orderBy: "startedAtMs", limit: 1 });
    const second = await s.request.list({ orderBy: "startedAtMs", limit: 1 });
    // SQLite orders TEXT by binary comparison. Each adapter is internally
    // consistent, which is all the rule requires — cross-adapter identity is
    // explicitly NOT asserted anywhere, because request ids are
    // caller-supplied and collation genuinely differs.
    expect(first[0]!.id).toBe("r_d");
    expect(second[0]!.id).toBe(first[0]!.id);
  });
});

// ---------------------------------------------------------------------------
// Index selection — NOT a cost bound. See the file header.
// ---------------------------------------------------------------------------

type PlanRow = { detail: string };

function plan(db: Database.Database, sql: string, params: unknown[]): string {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as PlanRow[])
    .map((r) => r.detail)
    .join(" | ");
}

describe("SQLite index selection for the FIX-1010 query shapes", () => {
  function db(): Database.Database {
    const handle = new Database(":memory:");
    initializeSchema(handle);
    // A planner will pick a scan over an index on a tiny table whatever the
    // shape, so seed enough rows and ANALYZE — otherwise this asserts the
    // fixture, not the schema.
    const insertSession = handle.prepare(
      "INSERT INTO sessions (id, flow_kind, user_id, org_id, tenant_id, parent_session_id, version, created_at, updated_at, data) VALUES (?, 'chat', 'alice', NULL, NULL, ?, 0, ?, ?, '{}')"
    );
    const insertRequest = handle.prepare(
      "INSERT INTO requests (id, flow_kind, user_id, session_id, org_id, tenant_id, status, version, created_at, updated_at, data) VALUES (?, 'chat', 'alice', ?, NULL, NULL, ?, 0, ?, ?, '{}')"
    );
    handle.transaction(() => {
      for (let i = 0; i < 2_000; i++) {
        insertSession.run(`s_${i}`, `p_${i % 20}`, 1_000 + i, 1_000 + i);
        insertRequest.run(`r_${i}`, `s_${i % 20}`, i % 7 === 0 ? "in_progress" : "completed", 1_000 + i, 1_000 + i);
      }
    })();
    handle.exec("ANALYZE");
    return handle;
  }

  it("the child listing searches an index and needs no temp b-tree to order", () => {
    const detail = plan(
      db(),
      `SELECT data FROM sessions WHERE parent_session_id = ? AND user_id = ? AND flow_kind = ? AND org_id IS ? AND tenant_id IS ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      ["p_3", "alice", "chat", null, null, 25, 0]
    );
    expect(detail).toContain("SEARCH");
    expect(detail).not.toContain("SCAN sessions");
    // The scope index, because the route always sends the tenant and org keys.
    // SQLite differs from Postgres here and the difference is the reason both
    // indexes exist: SQLite accepts `IS ?` against NULL as an index equality,
    // so this one index serves the bound and unbound callers alike, while
    // Postgres will not use it for an unbound caller at all (a `NULL` test is
    // not an equality for sort-order purposes there) and falls back to the
    // parent-only index. Neither adapter is served by one index alone.
    expect(detail).toContain("idx_sessions_parent_scope_created");
    // A temporary b-tree here means the page limit applies after sorting the
    // parent's whole child set.
    expect(detail).not.toContain("USE TEMP B-TREE FOR ORDER BY");
  });

  /**
   * The caller that omits the tenant and org keys entirely — an admin or debug
   * listing, where absence means "no filter" rather than "match unbound". The
   * scope index cannot serve it (its second and third columns are
   * unconstrained, so the ordering suffix is unreachable), which is what keeps
   * the parent-only index earning its place on this adapter too.
   */
  it("the key-absent child listing still searches an ordered index", () => {
    const detail = plan(
      db(),
      `SELECT data FROM sessions WHERE parent_session_id = ? AND user_id = ? AND flow_kind = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      ["p_3", "alice", "chat", 25, 0]
    );
    expect(detail).toContain("SEARCH");
    expect(detail).not.toContain("SCAN sessions");
    expect(detail).toContain("idx_sessions_parent_created");
    expect(detail).not.toContain("USE TEMP B-TREE FOR ORDER BY");
  });

  it("the most-recent-run read searches an index and needs no temp b-tree", () => {
    const detail = plan(
      db(),
      `SELECT data FROM requests WHERE session_id = ? AND user_id = ? AND flow_kind = ? AND org_id IS ? AND tenant_id IS ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      ["s_3", "alice", "chat", null, null]
    );
    expect(detail).toContain("SEARCH");
    expect(detail).not.toContain("SCAN requests");
    expect(detail).toContain("idx_requests_session_created");
    expect(detail).not.toContain("USE TEMP B-TREE FOR ORDER BY");
  });

  it("the existence check searches the already-shipped session/status index, unordered", () => {
    const detail = plan(
      db(),
      `SELECT data FROM requests WHERE session_id = ? AND status IN (?, ?) AND user_id = ? AND flow_kind = ? AND org_id IS ? AND tenant_id IS ? LIMIT 1`,
      ["s_3", "in_progress", "suspended", "alice", "chat", null, null]
    );
    expect(detail).toContain("SEARCH");
    expect(detail).not.toContain("SCAN requests");
    // `idx_requests_session_status` already ships and is exactly this shape's
    // two selective predicates — this read adds no index of its own. Asserted
    // so a later reader does not add a third.
    expect(detail).toContain("idx_requests_session_status");
    // No ordering at all: the sort is what would grow with the set this check
    // selects on (a request whose approval gate expires stays non-terminal
    // forever), and `LIMIT 1` only bounds the work if nothing sorts first.
    expect(detail).not.toContain("ORDER BY");
    expect(detail).not.toContain("TEMP B-TREE");
  });

  /**
   * The plan assertions above build their own SQL, so they cannot see the
   * store re-adding an order of its own. This one watches the statement the
   * store actually prepares.
   */
  it("the existence check emits no ORDER BY through the store itself", async () => {
    const handle = new Database(":memory:");
    initializeSchema(handle);
    const statements: string[] = [];
    const originalPrepare = handle.prepare.bind(handle);
    (handle as unknown as { prepare: unknown }).prepare = (sql: string) => {
      statements.push(sql);
      return originalPrepare(sql);
    };
    const store = createSQLiteRequestStore(handle);

    try {
      await store.list({
        sessionId: "sess",
        status: ["in_progress", "suspended"],
        orderBy: "none",
        limit: 1
      });

      const listStatements = statements.filter((sql) =>
        sql.startsWith("SELECT data FROM requests")
      );
      expect(listStatements.length).toBeGreaterThan(0);
      expect(listStatements.every((sql) => !sql.includes("ORDER BY"))).toBe(true);

      // And the shipped orderings still emit one, so this proves the mode
      // rather than a broken builder.
      statements.length = 0;
      await store.list({ sessionId: "sess", orderBy: "startedAtMs", limit: 1 });
      expect(
        statements
          .filter((sql) => sql.startsWith("SELECT data FROM requests"))
          .every((sql) => sql.includes("ORDER BY created_at DESC, id DESC"))
      ).toBe(true);
    } finally {
      handle.close();
    }
  });
});
