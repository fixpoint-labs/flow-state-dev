/**
 * FIX-428 migration tests: simulate a database initialised under the
 * pre-rename schema (`projects` table, `project_id` columns) and confirm
 * `initializeSchema` upgrades it in place without dropping data.
 */
import { describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshPglite } from "./shared-pglite";
import { initializeSchema } from "../src/schema";
import { createPostgresWakeStore, type QueryExecutor } from "../src/host";

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

async function columnExists(
  pglite: PGlite,
  table: string,
  column: string
): Promise<boolean> {
  const result = await pglite.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column]
  );
  return result.rows[0]?.exists === true;
}

async function tableExists(pglite: PGlite, table: string): Promise<boolean> {
  const result = await pglite.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1
     ) AS exists`,
    [table]
  );
  return result.rows[0]?.exists === true;
}

describe("project → org schema migration (postgres)", () => {
  it("renames projects table to orgs and preserves rows", async () => {
    const pglite = await freshPglite();
    await pglite.exec(`
      CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        user_id     TEXT,
        version     INTEGER NOT NULL,
        created_at  BIGINT NOT NULL,
        updated_at  BIGINT NOT NULL,
        data        JSONB NOT NULL
      );
    `);
    await pglite.query(
      `INSERT INTO projects (id, user_id, version, created_at, updated_at, data) VALUES ($1, $2, $3, $4, $5, $6)`,
      ["proj_1", "alice", 0, 1, 1, JSON.stringify({ state: {} })]
    );

    await initializeSchema(pgliteExecutor(pglite));

    expect(await tableExists(pglite, "orgs")).toBe(true);
    expect(await tableExists(pglite, "projects")).toBe(false);

    const result = await pglite.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM orgs WHERE id = 'proj_1'`
    );
    expect(result.rows[0]).toEqual({ id: "proj_1", user_id: "alice" });
  });

  it("renames project_id columns on sessions/requests/active_requests and preserves data", async () => {
    const pglite = await freshPglite();
    await pglite.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, flow_kind TEXT NOT NULL, user_id TEXT NOT NULL,
        project_id TEXT, version INTEGER NOT NULL,
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, data JSONB NOT NULL
      );
      CREATE TABLE requests (
        id TEXT PRIMARY KEY, flow_kind TEXT NOT NULL, user_id TEXT NOT NULL,
        session_id TEXT, project_id TEXT, status TEXT NOT NULL,
        version INTEGER NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
        data JSONB NOT NULL
      );
      CREATE TABLE active_requests (
        request_id TEXT PRIMARY KEY, flow_kind TEXT NOT NULL, action_name TEXT NOT NULL,
        session_id TEXT, user_id TEXT NOT NULL, project_id TEXT,
        input TEXT, metadata TEXT,
        started_at BIGINT NOT NULL, last_heartbeat_at BIGINT NOT NULL
      );
    `);
    await pglite.query(
      `INSERT INTO sessions VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ["sess_1", "demo", "alice", "proj_1", 0, 1, 1, "{}"]
    );

    await initializeSchema(pgliteExecutor(pglite));

    expect(await columnExists(pglite, "sessions", "org_id")).toBe(true);
    expect(await columnExists(pglite, "sessions", "project_id")).toBe(false);
    expect(await columnExists(pglite, "requests", "org_id")).toBe(true);
    expect(await columnExists(pglite, "active_requests", "org_id")).toBe(true);

    const session = await pglite.query<{ org_id: string }>(
      `SELECT org_id FROM sessions WHERE id = 'sess_1'`
    );
    expect(session.rows[0]?.org_id).toBe("proj_1");
  });

  it("is a no-op on a fresh database", async () => {
    const pglite = await freshPglite();
    await initializeSchema(pgliteExecutor(pglite));

    expect(await tableExists(pglite, "orgs")).toBe(true);
    expect(await columnExists(pglite, "sessions", "org_id")).toBe(true);
  });

  it("FIX-682: adds tenant_id to existing sessions/requests/active_requests", async () => {
    const pglite = await freshPglite();
    await pglite.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, flow_kind TEXT NOT NULL, user_id TEXT NOT NULL,
        org_id TEXT, version INTEGER NOT NULL,
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, data JSONB NOT NULL
      );
      CREATE TABLE requests (
        id TEXT PRIMARY KEY, flow_kind TEXT NOT NULL, user_id TEXT NOT NULL,
        session_id TEXT, org_id TEXT, status TEXT NOT NULL,
        version INTEGER NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
        data JSONB NOT NULL
      );
      CREATE TABLE active_requests (
        request_id TEXT PRIMARY KEY, flow_kind TEXT NOT NULL, action_name TEXT NOT NULL,
        session_id TEXT, user_id TEXT NOT NULL, org_id TEXT, source TEXT NOT NULL DEFAULT 'http',
        input TEXT, metadata TEXT,
        started_at BIGINT NOT NULL, last_heartbeat_at BIGINT NOT NULL
      );
    `);
    await pglite.query(
      `INSERT INTO sessions (id, flow_kind, user_id, version, created_at, updated_at, data) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ["sess_legacy", "demo", "alice", 0, 1, 1, JSON.stringify({ state: {} })]
    );

    await initializeSchema(pgliteExecutor(pglite));

    expect(await columnExists(pglite, "sessions", "tenant_id")).toBe(true);
    expect(await columnExists(pglite, "requests", "tenant_id")).toBe(true);
    expect(await columnExists(pglite, "active_requests", "tenant_id")).toBe(true);
    // Existing rows read back as no-tenant (NULL).
    const row = await pglite.query<{ tenant_id: string | null }>(
      `SELECT tenant_id FROM sessions WHERE id = 'sess_legacy'`
    );
    expect(row.rows[0]?.tenant_id).toBeNull();
  });

  it("adds a nullable flow_id owner column to existing sessions/requests/active_requests, with no backfill", async () => {
    const pglite = await freshPglite();
    await pglite.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, flow_kind TEXT NOT NULL, user_id TEXT NOT NULL,
        org_id TEXT, tenant_id TEXT, parent_session_id TEXT, version INTEGER NOT NULL,
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, data JSONB NOT NULL
      );
      CREATE TABLE requests (
        id TEXT PRIMARY KEY, flow_kind TEXT NOT NULL, user_id TEXT NOT NULL,
        session_id TEXT, org_id TEXT, tenant_id TEXT, status TEXT NOT NULL,
        version INTEGER NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
        data JSONB NOT NULL
      );
      CREATE TABLE active_requests (
        request_id TEXT PRIMARY KEY, flow_kind TEXT NOT NULL, action_name TEXT NOT NULL,
        session_id TEXT, user_id TEXT NOT NULL, org_id TEXT, tenant_id TEXT,
        source TEXT NOT NULL DEFAULT 'http', input TEXT, metadata TEXT,
        started_at BIGINT NOT NULL, last_heartbeat_at BIGINT NOT NULL, queued_at BIGINT
      );
    `);
    await pglite.query(
      `INSERT INTO sessions (id, flow_kind, user_id, version, created_at, updated_at, data) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ["sess_legacy", "engineer", "alice", 0, 1, 1, JSON.stringify({ state: {} })]
    );

    await initializeSchema(pgliteExecutor(pglite));

    expect(await columnExists(pglite, "sessions", "flow_id")).toBe(true);
    expect(await columnExists(pglite, "requests", "flow_id")).toBe(true);
    expect(await columnExists(pglite, "active_requests", "flow_id")).toBe(true);
    // A pre-existing row is NOT attributed to a copy by its kind name.
    const row = await pglite.query<{ flow_id: string | null }>(
      `SELECT flow_id FROM sessions WHERE id = 'sess_legacy'`
    );
    expect(row.rows[0]?.flow_id).toBeNull();
  });

  it("is idempotent — second call is a no-op", async () => {
    const pglite = await freshPglite();
    await pglite.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, user_id TEXT, version INTEGER NOT NULL,
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, data JSONB NOT NULL
      );
    `);
    await initializeSchema(pgliteExecutor(pglite));
    await expect(initializeSchema(pgliteExecutor(pglite))).resolves.not.toThrow();
  });

  // A wake is kept per resolver identity, so a turn's resolver is its row's
  // key and can't change under it. A database from before that keyed wakes on
  // (tenant, session, entry) alone; its kept wakes name no resolver and must
  // keep coalescing with each other, while a writer under a resolver gets a
  // row of its own.
  const OLD_WAKE_COLUMNS = `
    tenant_key TEXT NOT NULL, session_id TEXT NOT NULL, entry TEXT NOT NULL,
    flow_kind TEXT NOT NULL, user_id TEXT NOT NULL, org_id TEXT NOT NULL,
    due_at BIGINT NOT NULL, land_by BIGINT NOT NULL, version BIGINT NOT NULL,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL`;
  const oldWakeShapes = {
    "with no resolved_by column": `CREATE TABLE wakes (${OLD_WAKE_COLUMNS}, PRIMARY KEY (tenant_key, session_id, entry));`,
    "with a nullable resolved_by outside the key": `CREATE TABLE wakes (${OLD_WAKE_COLUMNS}, resolved_by TEXT, PRIMARY KEY (tenant_key, session_id, entry));`
  };
  for (const [shape, ddl] of Object.entries(oldWakeShapes)) {
    it(`re-keys a wakes table ${shape}; its kept wake still coalesces with no resolver, and a resolver's owe is a row of its own`, async () => {
      const pglite = await freshPglite();
      await pglite.exec(`
        ${ddl}
        INSERT INTO wakes (tenant_key, session_id, entry, flow_kind, user_id, org_id, due_at, land_by, version, created_at, updated_at)
        VALUES ('', 's1', 'dispatch', 'desk', 'u1', 'o1', 5, 6, 1, 1, 1);
      `);
      const executor = pgliteExecutor(pglite);
      await initializeSchema(executor);
      await initializeSchema(executor);
      const key = await pglite.query<{ attname: string }>(
        `SELECT a.attname FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = 'wakes'::regclass AND i.indisprimary
          ORDER BY array_position(i.indkey::int[], a.attnum::int)`
      );
      expect(key.rows.map((r) => r.attname)).toEqual(["tenant_key", "session_id", "entry", "resolved_by"]);
      const store = createPostgresWakeStore(executor);
      const kept = await store.get({ sessionId: "s1", entry: "dispatch" });
      expect(kept).toMatchObject({ dueAt: 5, landBy: 6, version: 1 });
      expect(kept?.resolvedBy).toBeUndefined();
      const input = { sessionId: "s1", entry: "dispatch", flowKind: "desk", userId: "u1", orgId: "o1", dueAt: 9, landBy: 9 };
      const coalesced = await store.owe(input);
      expect(coalesced).toMatchObject({ dueAt: 5, version: 2 });
      expect(coalesced.resolvedBy).toBeUndefined();
      expect(await store.owe({ ...input, resolvedBy: "vault" })).toMatchObject({ resolvedBy: "vault", dueAt: 9, version: 1 });
      expect(await store.listDue(Number.MAX_SAFE_INTEGER, 10)).toHaveLength(2);
    });
  }
}, { timeout: 30000 });
