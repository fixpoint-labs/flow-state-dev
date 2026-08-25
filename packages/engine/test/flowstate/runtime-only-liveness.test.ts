/**
 * A runtime-only init must not advertise a sweeper it never started (FIX-999).
 *
 * `createFlowState` resolves the sweeper facts in `#buildRuntime()` and stamps
 * them onto the SHARED runtime config — the one `worker.startWorker` gets. But
 * the sweeper itself is constructed inside `createFlowApiRouter`, which is only
 * reached through `getRouter()` / `ready()`.
 *
 * So a deployment that initializes solely through `getRuntime()` — `fsdev run`
 * and `fsdev chat` both do, and so does any worker-only consumer — got a config
 * claiming a 30s sweep cadence with nothing sweeping. The liveness gate's third
 * arm exists precisely to refuse in that situation ("nothing ever removes a
 * crashed worker's entry from a shared registry, so it reads live forever"),
 * and the optimistic stamp walked straight past it.
 *
 * The consequence is the one the gate calls out as deadlocking rather than
 * merely overspending: `readLiveness` treats a `queuedAt` entry as
 * unconditionally live and defers the bound to the sweep, so an abandoned
 * queued row reads live forever and reconciliation waits on work nobody is
 * doing.
 *
 * Both directions are pinned (BP-035): the runtime-only path refuses, and the
 * router path — which really does construct a sweeper — still enables the verb.
 * Without the second half this would pass equally well if liveness were simply
 * turned off everywhere.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler, requireRequestHost } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createFlowState,
  createInMemoryStores,
  disposeFlowApiRouter,
  inMemoryStores,
  runAction,
  type StoreAdapter
} from "../../src";
import type { FlowApiRouter } from "../../src/routes/createFlowApiRouter";
import type { StoreRegistry } from "../../src/stores/types";

const QUEUED_REQUEST_ID = "req_abandoned";
const ELEVEN_MINUTES_MS = 11 * 60_000;

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

/**
 * A store adapter over one shared-registry in-memory registry.
 *
 * Memoized because the test seeds rows through the same registry the runtime
 * later reads: a fresh resolve per call would hand the runtime an empty one.
 */
function sharedInMemoryStores(): StoreAdapter & { registry: () => StoreRegistry } {
  const inner = inMemoryStores();
  let resolved: StoreRegistry | undefined;
  return {
    capabilities: inner.capabilities,
    resolve: async (slots) => {
      if (resolved === undefined) {
        resolved = withSharedRegistry((await inner.resolve(slots)) as StoreRegistry);
      }
      return resolved;
    },
    registry: () => {
      if (resolved === undefined) throw new Error("stores not resolved yet");
      return resolved;
    }
  };
}

type Seen = { hasHost?: boolean; hasLiveness?: boolean; error?: string };

/** A flow whose action reports what the seam looked like from inside a block. */
function probeFlow(kind: string, seen: Seen) {
  const probe = handler({
    name: "probe",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async (_input, ctx) => {
      try {
        const host = requireRequestHost(ctx);
        seen.hasHost = true;
        seen.hasLiveness = host.livenessOf !== undefined;
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

/** A row accepted into an external queue and never claimed. */
async function seedAbandonedQueuedRow(stores: StoreRegistry, kind: string): Promise<void> {
  const at = Date.now() - ELEVEN_MINUTES_MS;
  await stores.activeRequests.register({
    requestId: QUEUED_REQUEST_ID,
    flowKind: kind,
    actionName: "run",
    sessionId: "s_queued",
    userId: "u_alice",
    source: "http",
    startedAt: at,
    lastHeartbeatAt: at,
    queuedAt: at
  });
}

let activeRouter: FlowApiRouter | undefined;

afterEach(async () => {
  if (activeRouter !== undefined) {
    await disposeFlowApiRouter(activeRouter);
    activeRouter = undefined;
  }
  vi.useRealTimers();
});

describe("liveness is not advertised on a runtime-only init (FIX-999)", () => {
  it("the premise: nothing sweeps when only getRuntime() is called", async () => {
    vi.useFakeTimers();
    const seen: Seen = {};
    const flow = probeFlow("runtime-only-premise", seen)();
    const adapter = sharedInMemoryStores();

    const state = createFlowState({
      flows: { probe: flow },
      stores: { default: { primary: adapter } },
      modelResolver: (() => undefined) as never
    });

    // getRouter()/ready() is never called — this is the whole topology.
    const runtime = await state.getRuntime();
    await seedAbandonedQueuedRow(runtime.stores, "runtime-only-premise");

    // Far past both the default 30s cadence and the 10-minute queued grace.
    await vi.advanceTimersByTimeAsync(15 * 60_000);

    // Still there: no sweeper exists to reap it, so the read's deferred bound
    // never arrives and this row would answer `true` forever.
    expect(await runtime.stores.activeRequests.get(QUEUED_REQUEST_ID)).toBeDefined();

    await state.dispose();
  });

  it("refuses the liveness verb on the worker/runtime-only path", async () => {
    const seen: Seen = {};
    const flow = probeFlow("runtime-only-gate", seen)();
    const adapter = sharedInMemoryStores();

    const state = createFlowState({
      flows: { probe: flow },
      stores: { default: { primary: adapter } },
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

    expect(seen.error).toBeUndefined();
    // The seam is still present — the refusal is a named decision, not an
    // absent bundle. Only the verb is withheld.
    expect(seen.hasHost).toBe(true);
    expect(seen.hasLiveness).toBe(false);

    await state.dispose();
  });

  it("OTHER DIRECTION: the router path really does sweep, so it still enables the verb", async () => {
    const seen: Seen = {};
    const registry = createFlowRegistry();
    registry.register(probeFlow("router-still-live", seen));

    // Same defaults a deployment that configures nothing gets.
    activeRouter = createFlowApiRouter({
      registry,
      stores: withSharedRegistry(createInMemoryStores())
    });

    const res = await activeRouter.POST(
      new Request("http://localhost/api/flows/router-still-live/actions/run", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ userId: "u_alice", sessionId: "s_live", input: {} })
      }),
      { params: { path: ["router-still-live", "actions", "run"] } }
    );
    const reader = res.body?.getReader();
    while (reader !== undefined) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(seen.error).toBeUndefined();
    expect(seen.hasHost).toBe(true);
    expect(seen.hasLiveness).toBe(true);
  });
});
