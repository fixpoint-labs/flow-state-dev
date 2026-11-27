// FIX-2942.
/**
 * The helpers' sessions carry the kind a real session birth gives the same
 * caller.
 *
 * Why this matters: a session's kind decides whether a run in it may name
 * another session. A helper that left it off would plant a session that reads
 * as a machine's (no kind, no request to classify it by), so a block under
 * test would be refused every named reach a production run of the same
 * caller is admitted, and a child it dispatched would be born a machine's.
 * Each case compares the helper's session with one an HTTP door's run gives
 * birth to.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowRegistry, defaultBodyUserIdPrincipalResolver } from "@flow-state-dev/engine";
import { createInboundTransportHost, createInMemoryStores } from "@flow-state-dev/engine/host";
import { createTestContext, testFlow } from "../src";

const run = handler({ name: "run", inputSchema: z.object({}).passthrough(), outputSchema: z.object({}).passthrough(), execute: () => ({}) });
const flow = defineFlow({ kind: "notes", actions: { run } })();

/** The kind a session gets when an HTTP caller's run gives birth to it. */
async function bornOverHttp(): Promise<string | undefined> {
  const registry = createFlowRegistry();
  registry.register(flow);
  const stores = createInMemoryStores();
  const host = createInboundTransportHost({ registry, stores, resolvePrincipal: defaultBodyUserIdPrincipalResolver, runtimeConfig: {} });
  const principal = await host.resolvePrincipal({
    source: "http",
    envelope: { flowKind: "notes", action: "run", input: {}, metadata: { body: { userId: "u1" } } }
  });
  await host.dispatch({ source: "http", flowKind: "notes", action: "run", input: {}, sessionId: "born", principal, responseEmitter: null }).finished;
  return (await stores.session.get("born"))?.principalKind;
}

describe("the helpers' session kind", () => {
  it("is a person's on the session testFlow seeds, as on an HTTP birth", async () => {
    const stores = createInMemoryStores();
    await testFlow({ flow, action: "run", input: {}, userId: "u1", sessionId: "s1", stores });
    const expected = await bornOverHttp();
    expect(expected).toBe("person");
    expect((await stores.session.get("s1"))?.principalKind).toBe(expected);
  });

  it("is a person's on the session createTestContext seeds, and on the one it lets the run create", async () => {
    const expected = await bornOverHttp();
    const seeded = await createTestContext({ sessionId: "s1", seed: { session: { state: {} } } });
    expect((await seeded.stores.session.get("s1"))?.principalKind).toBe(expected);
    const created = await createTestContext({ sessionId: "s2" });
    expect((await created.stores.session.get("s2"))?.principalKind).toBe(expected);
  });
});
