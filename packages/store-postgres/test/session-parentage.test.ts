/**
 * FIX-1009 parentage filtering for the Postgres session store, plus the
 * additive `parent_session_id` migration.
 *
 * The mode matrix mirrors `packages/engine/test/session-parentage-listing.test.ts`
 * and the SQLite suite case for case. This adapter cannot import the shared
 * `matchesParentageFilter` predicate (type-only package boundary), so it
 * reproduces it in the `WHERE` builder — an adapter that diverges is the exact
 * failure this coverage exists to catch.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { SessionRecord } from "@flow-state-dev/engine";
import { createPostgresStores, initializeSchema, type PostgresStoreRegistry } from "../src";
import type { QueryExecutor } from "../src";

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

async function freshStores(): Promise<PostgresStoreRegistry> {
  const pglite = new PGlite();
  const executor = pgliteExecutor(pglite);
  await initializeSchema(executor);
  return createPostgresStores({ executor });
}

describe("Postgres session parentage filtering", () => {
  async function seeded(): Promise<PostgresStoreRegistry> {
    const s = await freshStores();
    await s.session.set("sess_parent", makeSessionRecord("sess_parent"), "any");
    await s.session.set(
      "sess_child_a",
      makeSessionRecord("sess_child_a", { parentSessionId: "sess_parent" }),
      "any"
    );
    await s.session.set(
      "sess_child_b",
      makeSessionRecord("sess_child_b", { parentSessionId: "sess_parent" }),
      "any"
    );
    return s;
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
    const s = await freshStores();
    await s.session.set(
      "sess_top_chat",
      makeSessionRecord("sess_top_chat", { flowKind: "chat" }),
      "any"
    );
    await s.session.set(
      "sess_child_chat",
      makeSessionRecord("sess_child_chat", {
        flowKind: "chat",
        parentSessionId: "sess_top_chat"
      }),
      "any"
    );
    await s.session.set(
      "sess_child_report",
      makeSessionRecord("sess_child_report", {
        flowKind: "report",
        parentSessionId: "sess_top_chat"
      }),
      "any"
    );

    expect(
      (await s.session.list({ flowKind: "chat", parentage: "all" })).map((r) => r.id).sort()
    ).toEqual(["sess_child_chat", "sess_top_chat"]);
    expect(
      (
        await s.session.list({ flowKind: "chat", parentage: { parentOf: "sess_top_chat" } })
      ).map((r) => r.id)
    ).toEqual(["sess_child_chat"]);
    expect((await s.session.list({ flowKind: "chat" })).map((r) => r.id)).toEqual([
      "sess_top_chat"
    ]);
  });

  it("BP-031/BP-035: { parentOf } conjoined with a tenant filter never crosses tenants", async () => {
    const s = await freshStores();
    await s.session.set(
      "acme:sess_child",
      makeSessionRecord("acme:sess_child", {
        tenantId: "acme",
        parentSessionId: "sess_parent"
      }),
      "any"
    );
    await s.session.set(
      "globex:sess_child",
      makeSessionRecord("globex:sess_child", {
        tenantId: "globex",
        parentSessionId: "sess_parent"
      }),
      "any"
    );

    const rows = await s.session.list({
      tenantId: "acme",
      parentage: { parentOf: "sess_parent" }
    });
    expect(rows.map((r) => r.id)).toEqual(["acme:sess_child"]);
  });
});

describe("FIX-1009 parent_session_id migration (postgres)", () => {
  /** A `sessions` table exactly as it existed before this change. */
  async function legacyDatabase(): Promise<PGlite> {
    const pglite = new PGlite();
    await pglite.exec(`
      CREATE TABLE sessions (
        id          TEXT PRIMARY KEY,
        flow_kind   TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        org_id      TEXT,
        tenant_id   TEXT,
        version     INTEGER NOT NULL,
        created_at  BIGINT NOT NULL,
        updated_at  BIGINT NOT NULL,
        data        JSONB NOT NULL
      );
    `);
    return pglite;
  }

  it("adds the column to a pre-FIX-1009 sessions table and preserves rows", async () => {
    const pglite = await legacyDatabase();
    await pglite.query(
      `INSERT INTO sessions (id, flow_kind, user_id, version, created_at, updated_at, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ["sess_legacy", "chat", "user_1", 0, 1, 1, JSON.stringify({ id: "sess_legacy", state: {} })]
    );

    await initializeSchema(pgliteExecutor(pglite));

    const result = await pglite.query<{ parent_session_id: string | null }>(
      `SELECT parent_session_id FROM sessions WHERE id = $1`,
      ["sess_legacy"]
    );
    // Nullable with no default, so the pre-existing row reads back as
    // top-level — the "no backfill is ever needed" claim (decision 1).
    expect(result.rows[0]?.parent_session_id).toBeNull();
  });

  it("a database created before the column opens, migrates and lists as top-level", async () => {
    const pglite = await legacyDatabase();
    // The blob has no `parentSessionId` key, which is what every row written
    // before this change looks like.
    await pglite.query(
      `INSERT INTO sessions (id, flow_kind, user_id, version, created_at, updated_at, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
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
      ]
    );

    const executor = pgliteExecutor(pglite);
    await initializeSchema(executor);
    const stores = await createPostgresStores({ executor });

    const rows = await stores.session.list();
    expect(rows.map((r) => r.id)).toEqual(["sess_legacy"]);
    expect(rows[0]!.parentSessionId).toBeUndefined();
  });

  it("is idempotent across repeated initialization", async () => {
    const pglite = new PGlite();
    const executor = pgliteExecutor(pglite);
    await initializeSchema(executor);
    await initializeSchema(executor);

    const result = await pglite.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'sessions'
         AND column_name = 'parent_session_id'`
    );
    expect(Number(result.rows[0]?.count)).toBe(1);
  });
});
