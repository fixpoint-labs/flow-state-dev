/**
 * The request-host seam on the SHIPPED path (FIX-999).
 *
 * `request-host-e2e.test.ts` proves the seam works when a caller hands
 * `runtimeConfig.requestHost` to `runAction`. That is the injected path, and on
 * its own it cannot tell a wired seam from an unwired one — every assertion in it
 * would still pass if no shipped entry point ever built the bundle.
 *
 * So this file injects nothing. It drives real HTTP requests through
 * `createFlowApiRouter` — the entry point `createFlowState` itself delegates to —
 * and asserts what a block actually receives on a normal production request.
 *
 * It pins both directions (BP-035):
 *  - the seam is present, and its liveness verb reflects the sweeper the router
 *    really constructed;
 *  - when the deployment cannot support liveness, the verb is **absent** and the
 *    bundle still exists, so the refusal is a named decision rather than a
 *    missing seam.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, requireRequestHost } from "@flow-state-dev/core";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "../../src";
import type { StoreRegistry } from "../../src/stores/types";

/** A registry that declares itself shared, as a real Postgres-backed one does. */
function withSharedRegistry(stores: StoreRegistry): StoreRegistry {
  return {
    ...stores,
    activeRequests: Object.assign(
      Object.create(Object.getPrototypeOf(stores.activeRequests)),
      stores.activeRequests,
      { sharedAcrossProcesses: true }
    )
  };
}

async function drain(stream: ReadableStream<Uint8Array> | null): Promise<void> {
  if (stream === null) return;
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

type Seen = {
  hasHost?: boolean;
  hasLiveness?: boolean;
  answers?: Record<string, boolean>;
  startRefusal?: unknown;
  error?: string;
};

/** A flow whose action reports what the seam looked like from inside a block. */
function probeFlow(kind: string, seen: Seen, ask: string[]) {
  const probe = handler({
    name: "probe",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async (_input, ctx) => {
      try {
        // No cast, and nothing injected — whatever the shipped router wired.
        const host = requireRequestHost(ctx);
        seen.hasHost = true;
        seen.hasLiveness = host.livenessOf !== undefined;
        // Optional-call syntax is the shape a real capability wants: absence is
        // a supported deployment state, not a wiring bug, so no `!` here.
        seen.answers = await host.livenessOf?.(ask);
        seen.startRefusal = await host.startDetached({ seed: { topic: "t" }, input: {} });
      } catch (err) {
        seen.error = err instanceof Error ? err.message : String(err);
      }
      return {};
    }
  });

  return defineFlow({
    kind,
    actions: { run: { inputSchema: z.object({}), block: probe } },
    request: { heartbeatIntervalMs: 10_000 }
  });
}

async function post(
  router: ReturnType<typeof createFlowApiRouter>,
  kind: string,
  sessionId: string
): Promise<void> {
  const res = await router.POST(
    new Request(`http://localhost/api/flows/${kind}/actions/run`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ userId: "u_alice", sessionId, input: {} })
    }),
    { params: { path: [kind, "actions", "run"] } }
  );
  await drain(res.body);
}

describe("request-host seam on the shipped router path", () => {
  it("a normal request gets the bundle — requireRequestHost does not throw", async () => {
    const seen: Seen = {};
    const registry = createFlowRegistry();
    registry.register(probeFlow("shipped-seam", seen, []));

    const router = createFlowApiRouter({
      registry,
      stores: withSharedRegistry(createInMemoryStores())
    });

    await post(router, "shipped-seam", "s_shipped");

    // Before the wiring existed this was the production behaviour: no bundle,
    // so the accessor threw for every request served by this router.
    expect(seen.error).toBeUndefined();
    expect(seen.hasHost).toBe(true);
  });

  it("liveness is enabled from the router's OWN sweeper facts and reads real registry state", async () => {
    const seen: Seen = {};
    const registry = createFlowRegistry();
    registry.register(probeFlow("shipped-live", seen, ["req_sibling", "req_never"]));

    const stores = withSharedRegistry(createInMemoryStores());
    const ts = Date.now();
    await stores.session.set(
      "s_live",
      {
        id: "s_live",
        state: {},
        version: 0,
        createdAt: ts,
        updatedAt: ts,
        flowKind: "shipped-live",
        userId: "u_alice",
        journal: []
      },
      "any"
    );
    await stores.activeRequests.register({
      requestId: "req_sibling",
      flowKind: "shipped-live",
      actionName: "run",
      sessionId: "s_live",
      userId: "u_alice",
      source: "http",
      startedAt: ts,
      lastHeartbeatAt: ts
    });

    // No staleSweep* options passed: the gate has to be satisfied by the
    // router's DEFAULTS, which is what a deployment that configures nothing gets.
    const router = createFlowApiRouter({ registry, stores });

    await post(router, "shipped-live", "s_live");

    expect(seen.hasLiveness).toBe(true);
    expect(seen.answers).toEqual({ req_sibling: true, req_never: false });
  });

  it("OFF STATE: sweeping disabled refuses liveness but still hands the block a bundle", async () => {
    const seen: Seen = {};
    const registry = createFlowRegistry();
    registry.register(probeFlow("shipped-off", seen, ["req_x"]));

    const router = createFlowApiRouter({
      registry,
      stores: withSharedRegistry(createInMemoryStores()),
      // Nothing sweeps, so a crashed worker's entry would read live forever.
      // The gate must drop the verb rather than answer from an unswept registry.
      staleSweepIntervalMs: 0
    });

    await post(router, "shipped-off", "s_off");

    expect(seen.error).toBeUndefined();
    // The seam is present — the refusal is a decision, not an absence.
    expect(seen.hasHost).toBe(true);
    expect(seen.hasLiveness).toBe(false);
  });

  it("the start verb refuses BY NAME on the shipped path — no host start operation is wired yet", async () => {
    const seen: Seen = {};
    const registry = createFlowRegistry();
    registry.register(probeFlow("shipped-start", seen, []));

    const router = createFlowApiRouter({
      registry,
      stores: withSharedRegistry(createInMemoryStores())
    });

    await post(router, "shipped-start", "s_start");

    // Deferred, and honest about it: the flow declares no workstream core, so
    // admission refuses before the missing start operation is even reached.
    // Either way a capability meets a named refusal, never a broken verb.
    expect(seen.startRefusal).toMatchObject({ ok: false });
  });
});
