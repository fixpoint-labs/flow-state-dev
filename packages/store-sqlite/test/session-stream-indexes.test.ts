/**
 * The two ordered reads the session stream repeats about once a second, and
 * the index each needs.
 *
 * Each read takes a page of one session's requests, or one parent's runs,
 * newest-updated first, and stops at the first row older than its floor. That
 * is a bounded read only if the database can walk the rows in update order: a
 * temporary b-tree means it sorts the session's whole history before the page
 * limit applies, every second, for every open view.
 *
 * Index selection only, not a cost bound: `EXPLAIN QUERY PLAN` cannot see
 * filtered rows (see `list-option-widenings.test.ts`'s header). The cost
 * property is measured on Postgres.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { initializeSchema } from "../src/schema";

type PlanRow = { detail: string };

function plan(db: Database.Database, sql: string, params: unknown[]): string {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as PlanRow[])
    .map((r) => r.detail)
    .join(" | ");
}

/** Enough rows, analyzed, that the planner chooses as it would in production. */
function db(): Database.Database {
  const handle = new Database(":memory:");
  initializeSchema(handle);
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

describe("SQLite index selection for the session stream's reads", () => {
  it("the recent-requests read walks one session's requests in update order", () => {
    // `request.list({ sessionId, tenantId, orderBy: "updatedAt", limit, offset })`
    const detail = plan(
      db(),
      `SELECT data FROM requests WHERE session_id = ? AND tenant_id IS ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      ["s_3", null, 20, 0]
    );
    expect(detail).not.toContain("USE TEMP B-TREE FOR ORDER BY");
    expect(detail).toContain("SEARCH");
    expect(detail).not.toContain("SCAN requests");
    expect(detail).toContain("idx_requests_session_tenant_updated");
  });

  it("the recent-runs read walks one parent's children in update order", () => {
    // `session.list({ parentage: { parentOf }, orderBy: "updatedAt", limit, offset, userId, orgId, tenantId })`
    const detail = plan(
      db(),
      `SELECT data FROM sessions WHERE user_id = ? AND tenant_id IS ? AND org_id IS ? AND parent_session_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      ["alice", null, null, "p_3", 20, 0]
    );
    expect(detail).not.toContain("USE TEMP B-TREE FOR ORDER BY");
    expect(detail).toContain("SEARCH");
    expect(detail).not.toContain("SCAN sessions");
    expect(detail).toContain("idx_sessions_parent_scope_updated");
  });
});
