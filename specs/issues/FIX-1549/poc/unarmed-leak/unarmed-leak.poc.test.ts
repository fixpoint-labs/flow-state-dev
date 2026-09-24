/**
 * FIX-1549 review POC: in a registry that never registered Workforce's private
 * roster writer (the drafted D1's unarmed state), can an unbranded org-scoped
 * collection read another member's user-owned roster row?
 *
 * Retained spec evidence, not production code: run.sh copies it into
 * packages/engine/test for one run and removes it. The roster admission check
 * is stubbed to a no-op, which is exactly what an unarmed registry does. The
 * row is planted store-direct, as a row written by another process, an earlier
 * deployment, or another app over the same store would sit.
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("@flow-state-dev/core/types", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  assertRosterCollectionIsNotDeep: () => {},
}));
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "../src";
import { createMockModelResolver } from "@flow-state-dev/testing";

const verified = {
  resolvePrincipal: (c: { request?: Request }) => {
    const u = c.request?.headers.get("x-u"); const o = c.request?.headers.get("x-o");
    return u && o ? { userId: u, orgId: o } : null;
  },
};
const PATTERN = process.env.PAT ?? "[a]/[b]/[c]/[d]";
const wide = defineResourceCollection({
  pattern: PATTERN, scope: "org", flowIsolation: false,
  stateSchema: z.object({}).passthrough(), client: { state: { read: true } },
});
const out = defineResourceCollection({
  pattern: "out/*", scope: "org", stateSchema: z.object({ seen: z.string() }),
});
const peek = handler({
  name: "peek", inputSchema: z.object({}), outputSchema: z.object({ ok: z.boolean() }),
  resources: { wide, out },
  execute: async (_i, ctx) => {
    const rows = await (ctx.resources.wide as unknown as ResourceCollectionRef).list();
    await (ctx.resources.out as unknown as ResourceCollectionRef).create("x", {
      seen: rows.map((r) => `${r.path}=${JSON.stringify(r.state)}`).join("|"),
    });
    return { ok: true };
  },
});
const app = defineFlow({ kind: "app", resources: { wide, out },
  actions: { peek: { inputSchema: z.object({}), block: peek } }, authentication: verified });

describe("unarmed registry", () => {
  it(`bob lists alice's private roster row through ${PATTERN}`, async () => {
    const stores = inMemoryStores();
    const primary = await stores.resolve(["primary"]);
    await primary.resourceState!.set("org", "acme", "workforce/roster/~alice/research",
      { instructions: "ALICE-PRIVATE" }, "any");
    const state = createFlowState({ flows: { app: app() }, resolvePrincipal: verified.resolvePrincipal,
      stores: { default: { primary: stores } }, modelResolver: createMockModelResolver({}) });
    const router = (await state.getRouter()) as any;
    const runtime = await state.getRuntime();
    const call = async (method: string, path: string[], body?: unknown) => {
      const r = await router[method](new Request(`http://t/api/flows/${path.join("/")}`, { method,
        headers: { "content-type": "application/json", "x-u": "bob", "x-o": "acme" },
        ...(body ? { body: JSON.stringify(body) } : {}) }), { params: { path } });
      const t = await r.text(); return { status: r.status, json: t ? JSON.parse(t) : undefined };
    };
    const s = await call("POST", ["app", "sessions"], { userId: "bob" });
    const sid = s.json.session.id as string;
    const posted = await call("POST", ["app", sid, "actions", "peek"], { userId: "bob", input: {} });
    const rid = posted.json.request.id;
    for (let i = 0; i < 100; i++) {
      const st = (await call("GET", ["app", "requests", rid, "status"])).json?.status;
      if (st && !["pending","in_progress","running","queued"].includes(st)) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const seen = await runtime.stores.resourceState.getByPrefix("org", "acme", "out/");
    console.log("bob's handle list:", JSON.stringify(seen));
    expect(JSON.stringify(seen)).toContain("ALICE-PRIVATE");
  });
});
