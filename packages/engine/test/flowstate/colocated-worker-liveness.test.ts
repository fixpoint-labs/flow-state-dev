/**
 * A colocated worker must see the sweeper its own process is running (FIX-999).
 *
 * `createFlowState` builds ONE runtime config and hands it to two consumers:
 * `worker.startWorker(runtime)` during runtime init, and `createFlowApiRouter`
 * in `#doInit()`. The sweeper facts stamped in `#buildRuntime()` deliberately
 * omit `staleSweepIntervalMs`, because at that moment nothing sweeps — the
 * sweeper is constructed by the router, which only `getRouter()` / `ready()`
 * reaches. `runtime-only-liveness.test.ts` pins that refusal.
 *
 * The router then resolves the cadence and stamps it onto a router-LOCAL copy
 * of the config. So in `worker.mode: "colocated"` — dispatch and processing in
 * one process, the local-dev default — `ready()` starts a real sweeper and the
 * worker still holds a config that says none is running. Every job that worker
 * executes fails the gate's third arm with `sweeper-not-running` and gets no
 * `ctx.requestHost.livenessOf`, even though this process is sweeping.
 *
 * Fail-closed is the right answer for worker-only init. It is the wrong answer
 * for a colocated worker whose router is actively sweeping, and the two are
 * indistinguishable from inside the worker unless the fact propagates.
 *
 * Both directions are pinned (BP-035): a colocated worker gets the verb once
 * `ready()` has started the sweeper, and the same topology still refuses before
 * `ready()` — otherwise this would pass equally well if the gate were simply
 * removed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, requireRequestHost } from "@flow-state-dev/core";
import {
  createFlowState,
  inMemoryStores,
  runAction,
  type StoreAdapter
} from "../../src";
import type { FlowState, FlowStateRuntime } from "../../src/flowstate/types";
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

/** A store adapter over one shared-registry in-memory registry. */
function sharedInMemoryStores(): StoreAdapter {
  const inner = inMemoryStores();
  let resolved: StoreRegistry | undefined;
  return {
    capabilities: inner.capabilities,
    resolve: async (slots) => {
      if (resolved === undefined) {
        resolved = withSharedRegistry((await inner.resolve(slots)) as StoreRegistry);
      }
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

/**
 * A colocated FlowState whose worker adapter captures the exact runtime object
 * `startWorker` is handed — the one every worker-side `runAction` executes
 * against.
 */
function colocatedState(kind: string, seen: Seen): {
  state: FlowState;
  captured: () => FlowStateRuntime;
} {
  let capturedRuntime: FlowStateRuntime | undefined;

  const state = createFlowState({
    flows: { probe: probeFlow(kind, seen)() },
    stores: { default: { primary: sharedInMemoryStores() } },
    modelResolver: (() => undefined) as never,
    worker: {
      mode: "colocated",
      createDispatcher: () => undefined as never,
      startWorker: (runtime) => {
        capturedRuntime = runtime;
        return { close: async () => {} };
      }
    }
  });

  return {
    state,
    captured: () => {
      if (capturedRuntime === undefined) throw new Error("startWorker was never called");
      return capturedRuntime;
    }
  };
}

/** Execute one job exactly as the colocated worker would. */
async function runAsWorker(runtime: FlowStateRuntime, kind: string, sessionId: string) {
  await runAction({
    flow: runtime.registry.get(kind)!,
    actionName: "run",
    input: {},
    userId: "u_alice",
    sessionId,
    source: "bullmq",
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig
  });
}

let disposeState: (() => Promise<void>) | undefined;

afterEach(async () => {
  await disposeState?.();
  disposeState = undefined;
});

describe("a colocated worker sees its own process's sweeper (FIX-999)", () => {
  it("enables the liveness verb on the worker path once ready() has started the sweeper", async () => {
    const seen: Seen = {};
    const { state, captured } = colocatedState("colocated-live", seen);
    disposeState = () => state.dispose();

    // `ready()` builds the router, which constructs the stale-request sweeper.
    // From here this process really is sweeping.
    await state.ready();

    await runAsWorker(captured(), "colocated-live", "s_colocated");

    expect(seen.error).toBeUndefined();
    expect(seen.hasHost).toBe(true);
    expect(seen.hasLiveness).toBe(true);
  });

  it("hands the worker a config that already describes the sweeper, at startWorker time", async () => {
    // `#buildRuntime` calls `startWorker` and returns; `#doInit` only resumes
    // after that, so a cadence recorded there arrives too late for anything the
    // worker consumes on the way up. A real colocated worker starts consuming
    // the moment it is started, and the host it builds for such a job is
    // constructed once — so a job claimed in that window carries the
    // `sweeper-not-running` refusal for its whole life, after `ready()` has
    // started the sweeper it was refusing on behalf of.
    //
    // Asserted on the value the worker is HANDED, synchronously, rather than by
    // racing a job against the rest of init: the defect is that the config
    // handed over is false at the moment of handover, and a race would make
    // this test pass or fail on scheduling.
    const seen: Seen = {};
    let cadenceAtStartWorker: number | undefined;
    let sawStartWorker = false;
    let startupJob: Promise<void> | undefined;

    const state = createFlowState({
      flows: { probe: probeFlow("colocated-startup", seen)() },
      stores: { default: { primary: sharedInMemoryStores() } },
      modelResolver: (() => undefined) as never,
      worker: {
        mode: "colocated",
        createDispatcher: () => undefined as never,
        startWorker: (runtime) => {
          sawStartWorker = true;
          cadenceAtStartWorker = runtime.runtimeConfig.requestHost?.staleSweepIntervalMs;
          // And drive a job from inside the window, as a consuming worker does.
          startupJob = runAsWorker(runtime, "colocated-startup", "s_startup");
          return { close: async () => {} };
        }
      }
    });
    disposeState = () => state.dispose();

    await state.ready();
    await startupJob;

    expect(sawStartWorker).toBe(true);
    expect(cadenceAtStartWorker).toBe(30_000);
    expect(seen.error).toBeUndefined();
    expect(seen.hasLiveness).toBe(true);
  });

  it("OTHER DIRECTION: the same topology still refuses before ready() starts one", async () => {
    const seen: Seen = {};
    const { state, captured } = colocatedState("colocated-not-ready", seen);
    disposeState = () => state.dispose();

    // Runtime init starts the worker; the router — and therefore the sweeper —
    // has not been built. Nothing is sweeping yet, and the gate must say so.
    await state.getRuntime();

    await runAsWorker(captured(), "colocated-not-ready", "s_not_ready");

    expect(seen.error).toBeUndefined();
    expect(seen.hasHost).toBe(true);
    expect(seen.hasLiveness).toBe(false);
  });
});
