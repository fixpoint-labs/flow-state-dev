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
import {
  createFlowApiRouter,
  createFlowRegistry,
  createFlowState,
  createInMemoryStores,
  inMemoryStores,
  runAction
} from "../../src";
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

/**
 * Assemble a workstream core onto a flow instance.
 *
 * `workstream` is not an app-author surface — the framework builds it from a
 * board's drain bindings, which nothing populates yet. Detached dispatch
 * refuses `no-workstream-core` without it, so a test that needs to reach the
 * child-session write has to stand it up the way the framework will. This is
 * the precondition, not the thing under test.
 */
function withWorkstreamCore<T>(flow: T): T {
  (flow as { workstream?: unknown }).workstream = {
    block: handler({
      name: "core",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({}),
      execute: async () => ({})
    })
  };
  return flow;
}

/**
 * A real HTTP action request. `sessionId: undefined` OMITS the field, which is
 * a supported call — execution generates and persists an ephemeral session for
 * it. `orgId` goes through the default principal resolver, which reads it from
 * the body for an unauthenticated app.
 */
async function post(
  router: ReturnType<typeof createFlowApiRouter>,
  kind: string,
  sessionId: string | undefined,
  orgId?: string
): Promise<void> {
  const res = await router.POST(
    new Request(`http://localhost/api/flows/${kind}/actions/run`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        userId: "u_alice",
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(orgId !== undefined ? { orgId } : {}),
        input: {}
      })
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

  it("an OMITTED sessionId still gets the seam — the ephemeral session is a real session", async () => {
    const seen: Seen = {};
    const registry = createFlowRegistry();
    registry.register(probeFlow("shipped-ephemeral", seen, []));

    const router = createFlowApiRouter({
      registry,
      stores: withSharedRegistry(createInMemoryStores())
    });

    // No `sessionId` in the body. Execution generates and PERSISTS one, so the
    // request has a valid `ctx.session` and real lineage to authorise by.
    // Gating the seam on `options.sessionId` withheld it from exactly these
    // requests, and `requireRequestHost` threw inside an otherwise normal call.
    await post(router, "shipped-ephemeral", undefined);

    expect(seen.error).toBeUndefined();
    expect(seen.hasHost).toBe(true);
  });

  it("the seam binds the session's RESOLVED org, not the dispatch's omitted one", async () => {
    const seen: Seen = {};
    const registry = createFlowRegistry();
    registry.register(withWorkstreamCore(probeFlow("shipped-org", seen, [])()));

    const stores = withSharedRegistry(createInMemoryStores());
    const started: string[] = [];

    const router = createFlowApiRouter({
      registry,
      stores,
      // A wired host start operation, as an orchestration deployment has. The
      // router carries `startOperation` through untouched, so `startDetached`
      // reaches the point where it writes the child session record.
      runtimeConfig: {
        requestHost: {
          startOperation: async (spec: { sessionId: string }) => {
            started.push(spec.sessionId);
            return { requestId: "req_child" };
          }
        }
      }
    });

    // A session already bound to an org, as any earlier request left it.
    const ts = Date.now();
    await stores.session.set(
      "s_org_bound",
      {
        id: "s_org_bound",
        state: {},
        version: 0,
        createdAt: ts,
        updatedAt: ts,
        flowKind: "shipped-org",
        userId: "u_alice",
        orgId: "org_acme",
        journal: []
      },
      "any"
    );

    // The dispatch OMITS orgId. That is legal — only a *differing* org is
    // rejected — and execution resolves the authoritative org from the session
    // record. The seam must close over that, not over the absent option.
    await post(router, "shipped-org", "s_org_bound");

    expect(seen.error).toBeUndefined();
    // Dispatch was admitted — otherwise the org assertion below would pass
    // vacuously on a refusal that never wrote a child.
    expect(seen.startRefusal).toMatchObject({ ok: true });
    expect(started).toHaveLength(1);

    // The observable: the child the seam created carries the parent's org.
    // Reading `options.orgId` here left it undefined, so `startDetached`
    // produced a child outside the parent's org — org-scoped child work then
    // runs without the org context its inheritance contract promises.
    const child = await stores.session.get(started[0]!);
    expect(child?.orgId).toBe("org_acme");
  });
});

/**
 * The WORKER path (FIX-999). `createFlowState` hands one runtime config to both
 * `createFlowApiRouter` and `worker.startWorker`; the BullMQ adapter forwards it
 * unchanged to worker-side `runAction`. Stamping the seam onto the router's
 * local copy therefore fixed HTTP and left every colocated / worker-only
 * execution without it.
 *
 * This drives the worker's call shape directly: the runtime config the adapter
 * would receive, passed to `runAction` exactly as `bullmq/src/worker.ts` does.
 */
describe("request-host seam on the shipped worker path", () => {
  it("the runtime handed to worker.startWorker carries the seam", async () => {
    const seen: Seen = {};
    const flow = probeFlow("worker-seam", seen, [])();

    const state = createFlowState({
      flows: { workerSeam: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: (() => undefined) as never
    });

    // The exact object `worker.startWorker(runtime)` is given.
    const runtime = await state.getRuntime();

    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u_alice",
      sessionId: "s_worker",
      source: "bullmq",
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig
    });

    // Before the shared-config fix this threw with the production symptom —
    // the same "no runtime host is wired" failure the router fix removed from
    // the HTTP path, still live on every worker execution.
    expect(seen.error).toBeUndefined();
    expect(seen.hasHost).toBe(true);

    await state.dispose();
  });
});
