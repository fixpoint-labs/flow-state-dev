/**
 * FIX-428 migration tests: simulate a database initialised under the
 * pre-rename schema (`projects` table, `project_id` columns) and confirm
 * `initializeSchema` upgrades it in place without dropping data.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { initializeSchema } from "../src/schema";
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
    const pglite = new PGlite();
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
    await pglite.close();
  });

  it("renames project_id columns on sessions/requests/active_requests and preserves data", async () => {
    const pglite = new PGlite();
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
    await pglite.close();
  });

  it("is a no-op on a fresh database", async () => {
    const pglite = new PGlite();
    await initializeSchema(pgliteExecutor(pglite));

    expect(await tableExists(pglite, "orgs")).toBe(true);
    expect(await columnExists(pglite, "sessions", "org_id")).toBe(true);
    await pglite.close();
  });

  it("FIX-682: adds tenant_id to existing sessions/requests/active_requests", async () => {
    const pglite = new PGlite();
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
    await pglite.close();
  });

  it("is idempotent — second call is a no-op", async () => {
    const pglite = new PGlite();
    await pglite.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, user_id TEXT, version INTEGER NOT NULL,
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, data JSONB NOT NULL
      );
    `);
    await initializeSchema(pgliteExecutor(pglite));
    await expect(initializeSchema(pgliteExecutor(pglite))).resolves.not.toThrow();
    await pglite.close();
  });
}, { timeout: 30000 });
