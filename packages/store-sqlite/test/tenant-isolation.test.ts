/**
 * FIX-682: the SQLite adapter isolates session and request stores by tenant.
 * Verifies the NULL-safe `tenant_id IS ?` filter and present-vs-absent
 * semantics that the in-memory/filesystem layer enforce via
 * `matchesTenantFilter` — the SQL path is distinct logic worth direct coverage.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { RequestRecord, SessionRecord } from "@flow-state-dev/server";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src";

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

describe("SQLite adapter — tenant isolation (FIX-682)", () => {
  let stores: SQLiteStoreRegistry;

  beforeEach(() => {
    stores = createSQLiteStores({ filename: ":memory:" });
  });

  afterEach(() => {
    stores.close();
  });

  it("keeps two tenants' session records distinct under namespaced keys", async () => {
    await stores.session.set("acme:s", session("acme:s", "acme"), "any");
    await stores.session.set("globex:s", session("globex:s", "globex"), "any");

    expect((await stores.session.get("acme:s"))?.tenantId).toBe("acme");
    expect((await stores.session.get("globex:s"))?.tenantId).toBe("globex");
    expect(await stores.session.get("s")).toBeUndefined();
  });

  it("filters request.list by tenant with present-vs-absent semantics", async () => {
    await stores.request.set("r_a", request("r_a", "s", "acme"), "any");
    await stores.request.set("r_b", request("r_b", "s", "globex"), "any");
    await stores.request.set("r_n", request("r_n", "s", undefined), "any");

    const acme = await stores.request.list({ sessionId: "s", tenantId: "acme" });
    const none = await stores.request.list({ sessionId: "s", tenantId: undefined });
    const all = await stores.request.list({ sessionId: "s" });

    expect(acme.map((r) => r.id)).toEqual(["r_a"]);
    // Explicit-undefined matches only the no-tenant record (NULL-safe IS).
    expect(none.map((r) => r.id)).toEqual(["r_n"]);
    // Absent tenant key = no filter.
    expect(all.map((r) => r.id).sort()).toEqual(["r_a", "r_b", "r_n"]);
  });

  it("filters session.list by tenant", async () => {
    await stores.session.set("acme:s", session("acme:s", "acme"), "any");
    await stores.session.set("globex:s", session("globex:s", "globex"), "any");

    const acme = await stores.session.list({ userId: "u", tenantId: "acme" });
    expect(acme.map((s) => s.id)).toEqual(["acme:s"]);
  });
});
