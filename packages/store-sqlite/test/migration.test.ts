/**
 * FIX-428 migration tests: simulate a database initialised under the
 * pre-rename schema (`projects` table, `project_id` columns) and confirm
 * `initializeSchema` upgrades it in place without dropping data.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { initializeSchema } from "../src/schema";

function tableInfo(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as Array<{ name: string }>
  ).map((r) => r.name);
}

describe("project → org schema migration", () => {
  it("renames projects table to orgs and preserves rows", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        user_id     TEXT,
        version     INTEGER NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        data        TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO projects (id, user_id, version, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?)`
    ).run("proj_1", "alice", 0, 1, 1, '{"state":{}}');

    initializeSchema(db);

    const tables = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toContain("orgs");
    expect(tables).not.toContain("projects");

    const row = db.prepare(`SELECT id, user_id FROM orgs WHERE id = ?`).get("proj_1");
    expect(row).toEqual({ id: "proj_1", user_id: "alice" });
    db.close();
  });

  it("renames project_id columns on sessions/requests/active_requests and preserves data", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sessions (
        id          TEXT PRIMARY KEY,
        flow_kind   TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        project_id  TEXT,
        version     INTEGER NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        data        TEXT NOT NULL
      );
      CREATE TABLE requests (
        id          TEXT PRIMARY KEY,
        flow_kind   TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        session_id  TEXT,
        project_id  TEXT,
        status      TEXT NOT NULL,
        version     INTEGER NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        data        TEXT NOT NULL
      );
      CREATE TABLE active_requests (
        request_id        TEXT PRIMARY KEY,
        flow_kind         TEXT NOT NULL,
        action_name       TEXT NOT NULL,
        session_id        TEXT,
        user_id           TEXT NOT NULL,
        project_id        TEXT,
        input             TEXT,
        metadata          TEXT,
        started_at        INTEGER NOT NULL,
        last_heartbeat_at INTEGER NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO sessions (id, flow_kind, user_id, project_id, version, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("sess_1", "demo", "alice", "proj_1", 0, 1, 1, "{}");
    db.prepare(
      `INSERT INTO requests (id, flow_kind, user_id, session_id, project_id, status, version, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("req_1", "demo", "alice", "sess_1", "proj_1", "completed", 0, 1, 1, "{}");

    initializeSchema(db);

    expect(tableInfo(db, "sessions")).toContain("org_id");
    expect(tableInfo(db, "sessions")).not.toContain("project_id");
    expect(tableInfo(db, "requests")).toContain("org_id");
    expect(tableInfo(db, "requests")).not.toContain("project_id");
    expect(tableInfo(db, "active_requests")).toContain("org_id");

    const session = db.prepare(`SELECT org_id FROM sessions WHERE id = ?`).get("sess_1");
    expect(session).toEqual({ org_id: "proj_1" });
    const request = db.prepare(`SELECT org_id FROM requests WHERE id = ?`).get("req_1");
    expect(request).toEqual({ org_id: "proj_1" });
    db.close();
  });

  it("is a no-op on a fresh database (no projects table, no project_id columns)", () => {
    const db = new Database(":memory:");
    initializeSchema(db);

    expect(tableInfo(db, "sessions")).toContain("org_id");
    expect(tableInfo(db, "sessions")).not.toContain("project_id");
    expect(tableInfo(db, "orgs")).toEqual(
      expect.arrayContaining(["id", "user_id"])
    );
    db.close();
  });

  it("FIX-438: adds `source` column to existing active_requests tables", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE active_requests (
        request_id        TEXT PRIMARY KEY,
        flow_kind         TEXT NOT NULL,
        action_name       TEXT NOT NULL,
        session_id        TEXT,
        user_id           TEXT NOT NULL,
        org_id            TEXT,
        input             TEXT,
        metadata          TEXT,
        started_at        INTEGER NOT NULL,
        last_heartbeat_at INTEGER NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO active_requests (request_id, flow_kind, action_name, user_id, started_at, last_heartbeat_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("req_legacy", "demo", "run", "alice", 1, 1);

    initializeSchema(db);

    expect(tableInfo(db, "active_requests")).toContain("source");
    const row = db
      .prepare(`SELECT source FROM active_requests WHERE request_id = ?`)
      .get("req_legacy") as { source: string };
    expect(row.source).toBe("http");
    db.close();
  });

  it("FIX-682: adds `tenant_id` column to existing sessions/requests/active_requests", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, flow_kind TEXT NOT NULL, user_id TEXT NOT NULL,
        org_id TEXT, version INTEGER NOT NULL, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE requests (
        id TEXT PRIMARY KEY, flow_kind TEXT NOT NULL, user_id TEXT NOT NULL,
        session_id TEXT, org_id TEXT, status TEXT NOT NULL, version INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE active_requests (
        request_id TEXT PRIMARY KEY, flow_kind TEXT NOT NULL, action_name TEXT NOT NULL,
        session_id TEXT, user_id TEXT NOT NULL, org_id TEXT, source TEXT NOT NULL DEFAULT 'http',
        input TEXT, metadata TEXT, started_at INTEGER NOT NULL, last_heartbeat_at INTEGER NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO sessions (id, flow_kind, user_id, version, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("sess_legacy", "demo", "alice", 0, 1, 1, '{"state":{}}');

    initializeSchema(db);

    expect(tableInfo(db, "sessions")).toContain("tenant_id");
    expect(tableInfo(db, "requests")).toContain("tenant_id");
    expect(tableInfo(db, "active_requests")).toContain("tenant_id");
    // Existing rows read back as no-tenant (NULL) — pre-isolation semantics.
    const row = db
      .prepare(`SELECT tenant_id FROM sessions WHERE id = ?`)
      .get("sess_legacy") as { tenant_id: string | null };
    expect(row.tenant_id).toBeNull();
    db.close();
  });

  it("is idempotent — calling initializeSchema twice doesn't break", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        user_id     TEXT,
        version     INTEGER NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        data        TEXT NOT NULL
      );
    `);

    initializeSchema(db);
    expect(() => initializeSchema(db)).not.toThrow();
    db.close();
  });
});
