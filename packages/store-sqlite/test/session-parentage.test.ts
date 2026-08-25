/**
 * FIX-1009 parentage filtering for the SQLite session store, plus the additive
 * `parent_session_id` migration.
 *
 * The mode matrix mirrors `packages/engine/test/session-parentage-listing.test.ts`
 * case for case. The SQL adapter cannot import the shared
 * `matchesParentageFilter` predicate (type-only package boundary), so it
 * reproduces it in the `WHERE` builder — which makes an adapter that diverges
 * the exact failure this coverage exists to catch.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionRecord } from "@flow-state-dev/engine";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src";
import { initializeSchema } from "../src/schema";

function makeSessionRecord(id: string, overrides?: Partial<SessionRecord>): SessionRecord {
  const ts = Date.now();
  return {
    id,
    flowKind: "chat",
    userId: "user_1",
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    journal: [],
    ...overrides
  };
}

function tableInfo(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as Array<{ name: string }>
  ).map((r) => r.name);
}

describe("SQLite session parentage filtering", () => {
  let stores: SQLiteStoreRegistry;

  afterEach(() => {
    stores?.close();
  });

  async function seeded(): Promise<SQLiteStoreRegistry> {
    stores = createSQLiteStores({ filename: ":memory:" });
    await stores.session.set("sess_parent", makeSessionRecord("sess_parent"), "any");
    await stores.session.set(
      "sess_child_a",
      makeSessionRecord("sess_child_a", { parentSessionId: "sess_parent" }),
      "any"
    );
    await stores.session.set(
      "sess_child_b",
      makeSessionRecord("sess_child_b", { parentSessionId: "sess_parent" }),
      "any"
    );
    return stores;
  }

  it("defaults to top-level only — a parented row is omitted from an unfiltered list", async () => {
    const s = await seeded();
    expect((await s.session.list()).map((r) => r.id)).toEqual(["sess_parent"]);
  });

  it("still narrows to top-level when other predicates are passed but parentage is not", async () => {
    const s = await seeded();
    const rows = await s.session.list({ flowKind: "chat", userId: "user_1" });
    expect(rows.map((r) => r.id)).toEqual(["sess_parent"]);
  });

  it("explicit \"top-level\" matches the default", async () => {
    const s = await seeded();
    const explicit = await s.session.list({ parentage: "top-level" });
    const implicit = await s.session.list();
    expect(explicit.map((r) => r.id)).toEqual(implicit.map((r) => r.id));
  });

  it("\"all\" returns every session, parented or not", async () => {
    const s = await seeded();
    const rows = await s.session.list({ parentage: "all" });
    expect(rows.map((r) => r.id).sort()).toEqual([
      "sess_child_a",
      "sess_child_b",
      "sess_parent"
    ]);
  });

  it("{ parentOf } returns exactly that parent's children", async () => {
    const s = await seeded();
    const rows = await s.session.list({ parentage: { parentOf: "sess_parent" } });
    expect(rows.map((r) => r.id).sort()).toEqual(["sess_child_a", "sess_child_b"]);
  });

  it("{ parentOf } matching nothing returns an empty list", async () => {
    const s = await seeded();
    expect(await s.session.list({ parentage: { parentOf: "sess_absent" } })).toEqual([]);
  });

  it("does not coerce an empty parentOf into top-level", async () => {
    const s = await seeded();
    expect(await s.session.list({ parentage: { parentOf: "" } })).toEqual([]);
  });

  it("every other predicate behaves identically in all three modes", async () => {
    stores = createSQLiteStores({ filename: ":memory:" });
    await stores.session.set(
      "sess_top_chat",
      makeSessionRecord("sess_top_chat", { flowKind: "chat" }),
      "any"
    );
    await stores.session.set(
      "sess_child_chat",
      makeSessionRecord("sess_child_chat", {
        flowKind: "chat",
        parentSessionId: "sess_top_chat"
      }),
      "any"
    );
    await stores.session.set(
      "sess_child_report",
      makeSessionRecord("sess_child_report", {
        flowKind: "report",
        parentSessionId: "sess_top_chat"
      }),
      "any"
    );

    expect(
      (await stores.session.list({ flowKind: "chat", parentage: "all" })).map((r) => r.id).sort()
    ).toEqual(["sess_child_chat", "sess_top_chat"]);
    expect(
      (
        await stores.session.list({
          flowKind: "chat",
          parentage: { parentOf: "sess_top_chat" }
        })
      ).map((r) => r.id)
    ).toEqual(["sess_child_chat"]);
    expect((await stores.session.list({ flowKind: "chat" })).map((r) => r.id)).toEqual([
      "sess_top_chat"
    ]);
  });

  it("BP-031/BP-035: { parentOf } conjoined with a tenant filter never crosses tenants", async () => {
    stores = createSQLiteStores({ filename: ":memory:" });
    await stores.session.set(
      "acme:sess_child",
      makeSessionRecord("acme:sess_child", {
        tenantId: "acme",
        parentSessionId: "sess_parent"
      }),
      "any"
    );
    await stores.session.set(
      "globex:sess_child",
      makeSessionRecord("globex:sess_child", {
        tenantId: "globex",
        parentSessionId: "sess_parent"
      }),
      "any"
    );

    const rows = await stores.session.list({
      tenantId: "acme",
      parentage: { parentOf: "sess_parent" }
    });
    expect(rows.map((r) => r.id)).toEqual(["acme:sess_child"]);
  });
});

describe("FIX-1009 parent_session_id migration", () => {
  it("adds the column to a pre-FIX-1009 sessions table and preserves rows", () => {
    const db = new Database(":memory:");
    // A sessions table exactly as it existed before this change — no
    // `parent_session_id` column at all.
    db.exec(`
      CREATE TABLE sessions (
        id          TEXT PRIMARY KEY,
        flow_kind   TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        org_id      TEXT,
        tenant_id   TEXT,
        version     INTEGER NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        data        TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO sessions (id, flow_kind, user_id, version, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("sess_legacy", "chat", "user_1", 0, 1, 1, '{"id":"sess_legacy","state":{}}');

    initializeSchema(db);

    expect(tableInfo(db, "sessions")).toContain("parent_session_id");
    // Nullable with no default, so the pre-existing row reads back as
    // top-level — the "no backfill is ever needed" claim (decision 1).
    const row = db
      .prepare(`SELECT parent_session_id FROM sessions WHERE id = ?`)
      .get("sess_legacy");
    expect(row).toEqual({ parent_session_id: null });
    db.close();
  });

  it("a database created before the column opens, migrates and lists as top-level", async () => {
    // A real file, not `:memory:` — the point is to reopen the *same* database
    // through the normal `createSQLiteStores` path the way a deployment would.
    const dir = await mkdtemp(path.join(tmpdir(), "fsd-parentage-migration-"));
    const filename = path.join(dir, "store.db");

    try {
      const legacy = new Database(filename);
      legacy.exec(`
        CREATE TABLE sessions (
          id          TEXT PRIMARY KEY,
          flow_kind   TEXT NOT NULL,
          user_id     TEXT NOT NULL,
          org_id      TEXT,
          tenant_id   TEXT,
          version     INTEGER NOT NULL,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          data        TEXT NOT NULL
        );
      `);
      // The blob has no `parentSessionId` key, which is what every row written
      // before this change looks like.
      legacy
        .prepare(
          `INSERT INTO sessions (id, flow_kind, user_id, version, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "sess_legacy",
          "chat",
          "user_1",
          0,
          1,
          1,
          JSON.stringify({
            id: "sess_legacy",
            flowKind: "chat",
            userId: "user_1",
            state: {},
            version: 0,
            createdAt: 1,
            updatedAt: 1,
            journal: []
          })
        );
      legacy.close();

      const s = createSQLiteStores({ filename });
      try {
        const rows = await s.session.list();
        expect(rows.map((r) => r.id)).toEqual(["sess_legacy"]);
        expect(rows[0]!.parentSessionId).toBeUndefined();
      } finally {
        s.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent across repeated initialization", () => {
    const db = new Database(":memory:");
    initializeSchema(db);
    initializeSchema(db);
    const cols = tableInfo(db, "sessions").filter((c) => c === "parent_session_id");
    expect(cols).toHaveLength(1);
    db.close();
  });
});
