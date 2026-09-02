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
import { dispatchThroughSeam } from "@flow-state-dev/core/types";
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

  it("a dispatcher's message to an entry the flow does not declare is refused `no-entry` on the shipped router path", async () => {
    // Every shipped path through `createFlowApiRouter` ends up with a working
    // dispatch operation — `createFlowState` installs one on the shared config
    // before any fork exists, and `http-handlers.ts` installs one on a direct
    // `createFlowApiRouter` caller's own config as a fallback, precisely so
    // that case is never left without one. So `no-dispatch-operation` has no
    // reachable shipped-router-path case to pin here (see
    // `request-host-e2e.test.ts` for the one caller that CAN omit it: a hand-
    // built `runtimeConfig.requestHost`). What IS reachable on this path, and
    // worth pinning, is the seam's other named refusal: admission resolves the
    // entry FIRST, before it ever asks whether it can dispatch, so a message
    // to an entry this flow does not declare is refused `no-entry` rather than
    // silently doing nothing or reaching a caller-addressed handler.
    const seen: Seen = {};
    const probe = handler({
      name: "probe-no-entry",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async (_input, ctx) => {
        // `dispatchThroughSeam` calls the seam function directly — it only
        // THROWS when no seam is wired at all (`NoDispatchSeamError`). A wired
        // seam that refuses returns `{ ok: false, refused, detail }` as a
        // value; only the `dispatcher()` block wrapper turns that into a
        // thrown `DispatchRefusedError`.
        const outcome = await dispatchThroughSeam(ctx, {
          type: "internal",
          target: "missing",
          session: { key: "t" },
          payload: {},
          from: "probe-no-entry"
        });
        if (!outcome.ok) seen.error = `${outcome.refused}: ${outcome.detail}`;
        return {};
      }
    });

    // Declares no `internal` entry at all — the point of the test.
    const flow = defineFlow({
      kind: "shipped-no-entry",
      actions: { run: { inputSchema: z.object({}), block: probe } },
      request: { heartbeatIntervalMs: 10_000 }
    });

    const registry = createFlowRegistry();
    registry.register(flow);

    const router = createFlowApiRouter({
      registry,
      stores: withSharedRegistry(createInMemoryStores())
    });

    await post(router, "shipped-no-entry", "s_no_entry");

    expect(seen.error).toMatch(/no-entry/);
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
    const seen: Seen & { dispatchOutcome?: unknown } = {};
    const core = handler({
      name: "core",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({}),
      execute: async () => ({})
    });
    const probe = handler({
      name: "probe-org",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async (_input, ctx) => {
        try {
          seen.dispatchOutcome = await dispatchThroughSeam(ctx, {
            type: "internal",
            target: "core",
            session: { key: "t" },
            payload: {},
            from: "probe-org"
          });
        } catch (err) {
          seen.error = err instanceof Error ? err.message : String(err);
        }
        return {};
      }
    });

    const flow = defineFlow({
      kind: "shipped-org",
      actions: { run: { inputSchema: z.object({}), block: probe } },
      internal: { core: { block: core } },
      request: { heartbeatIntervalMs: 10_000 }
    })();

    const registry = createFlowRegistry();
    registry.register(flow);

    const stores = withSharedRegistry(createInMemoryStores());
    const started: string[] = [];

    const router = createFlowApiRouter({
      registry,
      stores,
      // A wired host dispatch operation, as an orchestration deployment has.
      // The router carries `requestHost` through untouched, so the dispatch
      // reaches the point where it writes the child session record.
      runtimeConfig: {
        requestHost: {
          dispatchOperation: async (spec: { sessionId: string }) => {
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
    expect(seen.dispatchOutcome).toMatchObject({ ok: true });
    expect(started).toHaveLength(1);

    // The observable: the child the seam created carries the parent's org.
    // Reading `options.orgId` here left it undefined, so the dispatch would
    // have produced a child outside the parent's org — org-scoped child work
    // then runs without the org context its inheritance contract promises.
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
