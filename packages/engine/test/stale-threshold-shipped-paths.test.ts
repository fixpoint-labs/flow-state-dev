/**
 * The resolved stale threshold has to reach startup detection (FIX-999).
 *
 * `createFlowApiRouter` resolves `staleSweepThresholdMs` once via
 * `resolveStaleSweep` and hands it to the periodic sweeper and to the liveness
 * gate. Startup detection, inside `createFlowRouteHandlers`, read a
 * *differently named* `options.staleThresholdMs` instead — a field
 * `CreateFlowApiRouterOptions` does not have — so the value was always
 * `undefined` there and `detectInterruptedRequests` fell back to its own
 * 30-second default.
 *
 * That makes the startup pass reap on a clock nothing else in the deployment
 * uses. It is not only a misconfiguration hazard: the resolved default is 60
 * seconds (`DEFAULT_STALE_SWEEP_THRESHOLD_MS`), so an *unconfigured* server
 * also swept at 30s on startup while its own sweeper and gate used 60s. A
 * healthy cross-process request whose last heartbeat is 31–59 seconds old is
 * marked `interrupted` and deregistered by a restart; the liveness read then
 * says `false` for work that is still running, and reconciliation re-dispatches
 * it — the duplicate-execution outcome this whole area exists to prevent.
 *
 * Driven through `createFlowApiRouter`, the shipped entry point, rather than by
 * calling `detectInterruptedRequests` directly: the direct surface always
 * accepted the threshold, which is precisely why this survived.
 *
 * Both directions are pinned on each case (BP-035) — a row inside the threshold
 * survives, and a row past it is still reaped. Without the second half this
 * would pass just as well if startup detection stopped reaping at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  disposeFlowApiRouter
} from "../src";
import type { FlowApiRouter } from "../src/routes/createFlowApiRouter";
import type { FlowRegistry } from "../src/registry/flow-registry";
import type { StoreRegistry } from "../src/stores/types";

const FLOW_KIND = "stale-threshold-test";
const USER_ID = "u_alice";
const REQUEST_ID = "req_beating";

/** Comfortably above the 30s fallback, comfortably below the configured 300s. */
const FORTY_FIVE_SECONDS_MS = 45_000;
const CONFIGURED_THRESHOLD_MS = 300_000;
const SEVEN_MINUTES_MS = 7 * 60_000;

function buildRegistry(): FlowRegistry {
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: FLOW_KIND,
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler<Record<string, never>, { ok: true }>({
            name: "stale-threshold-run",
            execute: async () => ({ ok: true } as const)
          })
        }
      }
    })({ id: FLOW_KIND })
  );
  return registry;
}

/**
 * A request claimed by a worker `heartbeatAgoMs` ago and beating normally until
 * then. No `queuedAt` — this row is governed by the heartbeat threshold alone,
 * which is what isolates the knob under test from the queued grace.
 */
async function seedBeatingRequest(
  stores: StoreRegistry,
  heartbeatAgoMs: number
): Promise<void> {
  const at = Date.now() - heartbeatAgoMs;
  await stores.activeRequests.register({
    requestId: REQUEST_ID,
    flowKind: FLOW_KIND,
    actionName: "run",
    sessionId: "s_1",
    userId: USER_ID,
    source: "http",
    startedAt: at,
    lastHeartbeatAt: at
  });
  await stores.request.set(
    REQUEST_ID,
    {
      id: REQUEST_ID,
      flowKind: FLOW_KIND,
      actionName: "run",
      userId: USER_ID,
      sessionId: "s_1",
      source: "http",
      status: "in_progress",
      startedAtMs: at,
      state: {},
      version: 0,
      createdAt: at,
      updatedAt: at
    },
    "any"
  );
}

async function statusOf(stores: StoreRegistry): Promise<string | undefined> {
  return (await stores.request.get(REQUEST_ID))?.status;
}

async function isRegistered(stores: StoreRegistry): Promise<boolean> {
  return (await stores.activeRequests.get(REQUEST_ID)) !== undefined;
}

let activeRouter: FlowApiRouter | undefined;

afterEach(async () => {
  if (activeRouter !== undefined) {
    await disposeFlowApiRouter(activeRouter);
    activeRouter = undefined;
  }
  vi.useRealTimers();
});

describe("the resolved stale threshold reaches startup detection (FIX-999)", () => {
  it("a configured threshold keeps a recently-beating row alive past 30s", async () => {
    vi.useFakeTimers();
    const stores = createInMemoryStores();
    await seedBeatingRequest(stores, FORTY_FIVE_SECONDS_MS);

    // Sweeping cadence off, so only the startup pass can touch the row.
    activeRouter = createFlowApiRouter({
      registry: buildRegistry(),
      stores,
      staleSweepIntervalMs: 0,
      staleSweepThresholdMs: CONFIGURED_THRESHOLD_MS
    });

    // Startup detection is fire-and-forget; let its store reads settle.
    await vi.advanceTimersByTimeAsync(1);

    expect(await statusOf(stores)).toBe("in_progress");
    expect(await isRegistered(stores)).toBe(true);
  });

  it("still reaps past the CONFIGURED threshold", async () => {
    vi.useFakeTimers();
    const stores = createInMemoryStores();
    await seedBeatingRequest(stores, SEVEN_MINUTES_MS);

    activeRouter = createFlowApiRouter({
      registry: buildRegistry(),
      stores,
      staleSweepIntervalMs: 0,
      staleSweepThresholdMs: CONFIGURED_THRESHOLD_MS
    });

    await vi.advanceTimersByTimeAsync(1);

    expect(await statusOf(stores)).toBe("interrupted");
    expect(await isRegistered(stores)).toBe(false);
  });

  it("an UNCONFIGURED server sweeps startup on the same 60s default as its sweeper", async () => {
    vi.useFakeTimers();
    const stores = createInMemoryStores();
    await seedBeatingRequest(stores, FORTY_FIVE_SECONDS_MS);

    // No threshold configured at all: `resolveStaleSweep` yields 60s, so a
    // 45s-old heartbeat is healthy. Startup detection's own 30s fallback
    // disagreed with every other path in the same process.
    activeRouter = createFlowApiRouter({
      registry: buildRegistry(),
      stores,
      staleSweepIntervalMs: 0
    });

    await vi.advanceTimersByTimeAsync(1);

    expect(await statusOf(stores)).toBe("in_progress");
    expect(await isRegistered(stores)).toBe(true);
  });

  it("an unconfigured server still reaps past the 60s default", async () => {
    vi.useFakeTimers();
    const stores = createInMemoryStores();
    await seedBeatingRequest(stores, SEVEN_MINUTES_MS);

    activeRouter = createFlowApiRouter({
      registry: buildRegistry(),
      stores,
      staleSweepIntervalMs: 0
    });

    await vi.advanceTimersByTimeAsync(1);

    expect(await statusOf(stores)).toBe("interrupted");
    expect(await isRegistered(stores)).toBe(false);
  });
});
