/**
 * FIX-682 store-key isolation. Two tenants sharing one session id must produce
 * physically distinct session records and never cross tenants in request
 * history, while the public session identity stays bare. Recovery must
 * re-dispatch a retry within the original tenant.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createResponseEmitter,
  retryRequest,
  runAction
} from "../src";
import { resolveSessionStorageKey } from "../src/stores/scope-keys";

/** Flow whose action bumps session `count` and records the identity it saw. */
function buildCountingFlow(seen?: { sessionIdentityId?: string }) {
  const bump = handler({
    name: "bump",
    inputSchema: z.object({ by: z.number() }),
    outputSchema: z.object({ count: z.number() }),
    execute: async (input, ctx) => {
      if (seen !== undefined) seen.sessionIdentityId = ctx.session.identity.id;
      const current = (ctx.session.state as { count?: number }).count ?? 0;
      const count = current + input.by;
      await ctx.session.patchState({ count });
      return { count };
    }
  });
  return defineFlow({
    kind: "counter-flow",
    session: { stateSchema: z.object({ count: z.number().default(0) }) },
    actions: { run: { inputSchema: z.object({ by: z.number() }), block: bump } }
  });
}

async function run(
  stores: ReturnType<typeof createInMemoryStores>,
  opts: { tenantId?: string; by: number; requestId: string; seen?: { sessionIdentityId?: string } }
): Promise<void> {
  await runAction({
    flow: buildCountingFlow(opts.seen),
    actionName: "run",
    input: { by: opts.by },
    userId: "u",
    sessionId: "s",
    requestId: opts.requestId,
    tenantId: opts.tenantId,
    stores,
    responseEmitter: createResponseEmitter({ requestId: opts.requestId }),
    runtimeConfig: {}
  });
}

describe("tenant store-key isolation", () => {
  it("gives two tenants distinct session records for the same session id", async () => {
    const stores = createInMemoryStores();
    await run(stores, { tenantId: "acme", by: 1, requestId: "r_a" });
    await run(stores, { tenantId: "globex", by: 2, requestId: "r_b" });

    const a = await stores.session.get(resolveSessionStorageKey("s", "acme"));
    const b = await stores.session.get(resolveSessionStorageKey("s", "globex"));
    const bare = await stores.session.get("s");

    expect((a?.state as { count?: number }).count).toBe(1);
    expect(a?.tenantId).toBe("acme");
    expect((b?.state as { count?: number }).count).toBe(2);
    expect(b?.tenantId).toBe("globex");
    // Neither tenant request created a bare-key session record.
    expect(bare).toBeUndefined();
  });

  it("keeps the session identity bare under a tenant", async () => {
    const stores = createInMemoryStores();
    const seen: { sessionIdentityId?: string } = {};
    await run(stores, { tenantId: "acme", by: 1, requestId: "r_a", seen });
    expect(seen.sessionIdentityId).toBe("s");
  });

  it("isolates request history by tenant with present-vs-absent semantics", async () => {
    const stores = createInMemoryStores();
    await run(stores, { tenantId: "acme", by: 1, requestId: "r_a1" });
    await run(stores, { tenantId: "acme", by: 1, requestId: "r_a2" });
    await run(stores, { tenantId: "globex", by: 1, requestId: "r_b1" });
    await run(stores, { by: 1, requestId: "r_none" }); // no tenant, same session id

    const acme = await stores.request.list({ sessionId: "s", tenantId: "acme" });
    const globex = await stores.request.list({ sessionId: "s", tenantId: "globex" });
    const noneTenant = await stores.request.list({ sessionId: "s", tenantId: undefined });
    const all = await stores.request.list({ sessionId: "s" });

    expect(acme.map((r) => r.id).sort()).toEqual(["r_a1", "r_a2"]);
    expect(globex.map((r) => r.id)).toEqual(["r_b1"]);
    // Explicit-undefined matches only the no-tenant record, not acme/globex.
    expect(noneTenant.map((r) => r.id)).toEqual(["r_none"]);
    // Absent tenant key = admin "list everything" across tenants.
    expect(all.map((r) => r.id).sort()).toEqual(["r_a1", "r_a2", "r_b1", "r_none"]);
  });

  it("rejects a cross-tenant key collision via a crafted session id", async () => {
    // The `${tenantId}:${sessionId}` key is ambiguous: a no-tenant caller
    // passing sessionId "acme:s" resolves to the same key as tenant acme's
    // session "s". The tenant-binding check must reject it (same userId, so the
    // userId guard does not catch this — only the tenant guard does).
    const stores = createInMemoryStores();
    await run(stores, { tenantId: "acme", by: 1, requestId: "r_a" });

    await expect(
      runAction({
        flow: buildCountingFlow(),
        actionName: "run",
        input: { by: 99 },
        userId: "u",
        sessionId: "acme:s", // crafted to collide with key `acme:s`
        requestId: "r_attack",
        // no tenantId — attacker omits the header
        stores,
        responseEmitter: createResponseEmitter({ requestId: "r_attack" }),
        runtimeConfig: {}
      })
    ).rejects.toThrow(/tenant/i);

    // Acme's session state is untouched by the bypass attempt.
    const acme = await stores.session.get(resolveSessionStorageKey("s", "acme"));
    expect((acme?.state as { count?: number }).count).toBe(1);
  });

  it("re-dispatches a retry within the original tenant", async () => {
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(buildCountingFlow());
    await run(stores, { tenantId: "acme", by: 1, requestId: "r_orig" });

    const { newRequestId, liveStream } = await retryRequest({
      originalRequestId: "r_orig",
      stores,
      flowRegistry: registry,
      runtimeConfig: {}
    });
    // Drain the retry's live stream to completion.
    const reader = liveStream.readable.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    const retried = await stores.request.get(newRequestId);
    expect(retried?.tenantId).toBe("acme");
    expect(retried?.sessionId).toBe("s");
    // The retry landed in the acme-namespaced session, bumping it again.
    const acmeSession = await stores.session.get(resolveSessionStorageKey("s", "acme"));
    expect((acmeSession?.state as { count?: number }).count).toBe(2);
  });
});
