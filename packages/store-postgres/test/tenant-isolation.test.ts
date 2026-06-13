/**
 * FIX-682: the Postgres adapter isolates session and request stores by tenant.
 * Verifies the NULL-safe `tenant_id IS NOT DISTINCT FROM $n` filter and the
 * present-vs-absent semantics — distinct SQL from the SQLite path — against the
 * PGlite harness.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { RequestRecord, SessionRecord } from "@flow-state-dev/server";
import {
  createPostgresSessionStore,
  createPostgresRequestStore,
  initializeSchema,
  type QueryExecutor
} from "../src";

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

function session(id: string, tenantId?: string): SessionRecord {
  const ts = Date.now();
  return {
    id,
    flowKind: "flow-a",
    userId: "u",
    tenantId,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    journal: []
  };
}

function request(id: string, sessionId: string, tenantId?: string): RequestRecord {
  const ts = Date.now();
  return {
    id,
    flowKind: "flow-a",
    actionName: "run",
    userId: "u",
    sessionId,
    tenantId,
    source: "http",
    status: "completed",
    startedAtMs: ts,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts
  };
}

describe("Postgres adapter — tenant isolation (FIX-682)", () => {
  it("filters request.list by tenant with present-vs-absent semantics", async () => {
    const pglite = new PGlite();
    await initializeSchema(pgliteExecutor(pglite));
    const store = createPostgresRequestStore(pgliteExecutor(pglite), {
      liveTailPool: null
    });

    await store.set("r_a", request("r_a", "s", "acme"), "any");
    await store.set("r_b", request("r_b", "s", "globex"), "any");
    await store.set("r_n", request("r_n", "s", undefined), "any");

    const acme = await store.list({ sessionId: "s", tenantId: "acme" });
    const none = await store.list({ sessionId: "s", tenantId: undefined });
    const all = await store.list({ sessionId: "s" });

    expect(acme.map((r) => r.id)).toEqual(["r_a"]);
    // Explicit-undefined matches only the no-tenant record (NULL-safe).
    expect(none.map((r) => r.id)).toEqual(["r_n"]);
    expect(all.map((r) => r.id).sort()).toEqual(["r_a", "r_b", "r_n"]);
    await pglite.close();
  });

  it("keeps two tenants' session records distinct and filters session.list", async () => {
    const pglite = new PGlite();
    await initializeSchema(pgliteExecutor(pglite));
    const store = createPostgresSessionStore(pgliteExecutor(pglite));

    await store.set("acme:s", session("acme:s", "acme"), "any");
    await store.set("globex:s", session("globex:s", "globex"), "any");

    expect((await store.get("acme:s"))?.tenantId).toBe("acme");
    expect(await store.get("s")).toBeUndefined();

    const acme = await store.list({ userId: "u", tenantId: "acme" });
    expect(acme.map((s) => s.id)).toEqual(["acme:s"]);
    await pglite.close();
  });
}, { timeout: 30000 });
