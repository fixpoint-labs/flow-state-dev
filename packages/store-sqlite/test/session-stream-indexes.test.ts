/**
 * The two ordered reads the session stream repeats about once a second, and
 * the index each needs.
 *
 * Each read takes a page of one session's requests, or one parent's runs,
 * newest-updated first, and stops at the first row older than its floor. That
 * is a bounded read only if the database can walk the followed rows in update
 * order: a temporary b-tree means it sorts the session's whole history before
 * the page limit applies, every second, for every open view. And every row it
 * walks must be one the read keeps: each read names the session's tenant,
 * owner and org, and rows under the same id that another owner or org keeps
 * (a session id can be used again, and a request its owner never made is
 * refused but kept) are walked and discarded unless the index names them too.
 *
 * Index selection only, not a cost bound: `EXPLAIN QUERY PLAN` cannot see
 * filtered rows (see `list-option-widenings.test.ts`'s header). It does name
 * the columns an index search is constrained on, so the check is that the
 * search covers every column the read names and leaves only the order to the
 * index. The cost property is measured on Postgres.
 *
 * Planned on the SQL the store itself emits for the options the stream sends
 * (`sessionStreamReads`).
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "@flow-state-dev/engine";
import { sessionStreamReads } from "@flow-state-dev/engine/testing";
import { initializeSchema } from "../src/schema";
import { createSQLiteRequestStore, createSQLiteSessionStore } from "../src";

type PlanRow = { detail: string };

/** Enough rows, analyzed, that the planner chooses as it would in production. */
function database(): Database.Database {
  const handle = new Database(":memory:");
  initializeSchema(handle);
  const insertSession = handle.prepare(
    "INSERT INTO sessions (id, flow_kind, user_id, org_id, tenant_id, parent_session_id, version, created_at, updated_at, data) VALUES (?, 'chat', ?, 'org_a', ?, ?, 0, ?, ?, '{}')"
  );
  const insertRequest = handle.prepare(
    "INSERT INTO requests (id, flow_kind, user_id, session_id, org_id, tenant_id, status, version, created_at, updated_at, data) VALUES (?, 'chat', ?, ?, 'org_a', ?, ?, 0, ?, ?, '{}')"
  );
  handle.transaction(() => {
    for (let i = 0; i < 2_000; i++) {
      const user = i % 3 === 0 ? "mallory" : "alice";
      const tenant = i % 2 === 0 ? null : "acme";
      insertSession.run(`s_${i}`, user, tenant, `s_${i % 20}`, 1_000 + i, 1_000 + i);
      insertRequest.run(`r_${i}`, user, `s_${i % 20}`, tenant, i % 7 === 0 ? "in_progress" : "completed", 1_000 + i, 1_000 + i);
    }
  })();
  handle.exec("ANALYZE");
  return handle;
}

/**
 * The stores over `handle`, and every statement they run with the parameters
 * it ran with.
 */
function recorded(handle: Database.Database) {
  const sent: Array<{ sql: string; params: unknown[] }> = [];
  const db = new Proxy(handle, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown;
      if (key !== "prepare") return typeof value === "function" ? value.bind(target) : value;
      return (sql: string) => {
        const statement = target.prepare(sql);
        return new Proxy(statement, {
          get(inner, name) {
            const member = Reflect.get(inner, name, inner) as unknown;
            if (typeof member !== "function") return member;
            if (name !== "all" && name !== "get") return member.bind(inner);
            return (...params: unknown[]) => {
              sent.push({ sql, params });
              return (member as (...args: unknown[]) => unknown).apply(inner, params);
            };
          }
        });
      };
    }
  });
  return {
    session: createSQLiteSessionStore(db),
    request: createSQLiteRequestStore(db),
    sent
  };
}

/** A session the stream follows, as the route read it: alice's, in org `org_a`. */
function followed(id: string, tenantId: string | undefined): SessionRecord {
  return {
    id: tenantId === undefined ? id : `${tenantId}:${id}`,
    flowKind: "chat",
    userId: "alice",
    orgId: "org_a",
    tenantId,
    state: {},
    version: 0,
    createdAt: 0,
    updatedAt: 0,
    journal: []
  };
}

/** The plan for the one list read `read` makes on the store. */
async function planOf(read: (stores: ReturnType<typeof recorded>) => Promise<unknown>): Promise<string> {
  const handle = database();
  const stores = recorded(handle);
  await read(stores);
  const lists = stores.sent.filter(({ sql }) => /^\s*SELECT data FROM (requests|sessions)\b/i.test(sql));
  expect(lists).toHaveLength(1);
  const { sql, params } = lists[0]!;
  return (handle.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as PlanRow[])
    .map((r) => r.detail)
    .join(" | ");
}

describe("SQLite index selection for the session stream's reads", () => {
  it.each([
    ["no tenant", "s_3", undefined],
    ["a tenant", "s_3", "acme"]
  ] as const)("the recent-requests read of a caller bound to %s walks the session's own requests in update order", async (_bound, id, tenant) => {
    const detail = await planOf((stores) =>
      stores.request.list(sessionStreamReads.recentRequests(id, followed(id, tenant), tenant, 20))
    );
    expect(detail).not.toContain("USE TEMP B-TREE FOR ORDER BY");
    expect(detail).toContain(
      "SEARCH requests USING INDEX idx_requests_session_tenant_owner_updated (session_id=? AND tenant_id=? AND user_id=? AND org_id=?)"
    );
  });

  it.each([
    ["no tenant", "s_3", undefined],
    ["a tenant", "s_3", "acme"]
  ] as const)("the recent-runs read of a caller bound to %s walks the parent's own children in update order", async (_bound, id, tenant) => {
    const detail = await planOf((stores) =>
      stores.session.list(sessionStreamReads.recentRuns(id, followed(id, tenant), tenant, 20))
    );
    expect(detail).not.toContain("USE TEMP B-TREE FOR ORDER BY");
    expect(detail).toContain(
      "SEARCH sessions USING INDEX idx_sessions_parent_tenant_owner_updated (parent_session_id=? AND tenant_id=? AND user_id=? AND org_id=?)"
    );
  });
});
