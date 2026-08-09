/**
 * The queued grace has to be reachable from the paths that actually sweep (FIX-999).
 *
 * `detectInterruptedRequests` has accepted `queuedGraceMs` since the queued-entry
 * fix landed, but no shipped caller passed it and no public option reached it. A
 * deployment whose legitimate backlog runs longer than the ten-minute fallback
 * therefore could not raise it without bypassing the framework's own sweepers:
 * its queued row was marked `interrupted` and deregistered while the dispatcher
 * still held the job, which is the duplicate-execution outcome the grace exists
 * to prevent.
 *
 * Three shipped paths sweep, so all three are driven here through their real
 * entry points rather than by calling `detectInterruptedRequests` directly — a
 * direct call is exactly the surface that already worked and could not have
 * caught this:
 *
 *  - the router's periodic `createStaleRequestSweeper`,
 *  - startup detection inside `createFlowRouteHandlers`,
 *  - the client-poked `POST /users/:userId/check-interrupted` route.
 *
 * Both directions are pinned on each (BP-035): a configured grace keeps a queued
 * row alive past the default, and past the *configured* grace that same row is
 * still reaped. Without the second half this trades a false `interrupted` for a
 * row that lingers `in_progress` forever.
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

const FLOW_KIND = "queued-grace-test";
const USER_ID = "u_alice";
const REQUEST_ID = "req_queued";

/** Longer than the ten-minute fallback, which is the whole point. */
const CONFIGURED_GRACE_MS = 30 * 60_000;
const TWENTY_MINUTES_MS = 20 * 60_000;
const ELEVEN_MINUTES_MS = 11 * 60_000;
const THIRTY_ONE_MINUTES_MS = 31 * 60_000;

function buildRegistry(): FlowRegistry {
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: FLOW_KIND,
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler<Record<string, never>, { ok: true }>({
            name: "queued-grace-run",
            execute: async () => ({ ok: true } as const)
          })
        }
      }
    })({ id: FLOW_KIND })
  );
  return registry;
}

/**
 * A row accepted into an external queue `queuedAgoMs` ago and never claimed.
 * `queuedAt` present is what marks it unclaimed; `lastHeartbeatAt` is equally
 * old because nothing is beating for a job no worker is running yet, so it is
 * stale under any ordinary threshold and only the grace keeps it alive.
 */
async function seedQueuedRequest(
  stores: StoreRegistry,
  queuedAgoMs: number
): Promise<void> {
  const at = Date.now() - queuedAgoMs;
  await stores.activeRequests.register({
    requestId: REQUEST_ID,
    flowKind: FLOW_KIND,
    actionName: "run",
    sessionId: "s_1",
    userId: USER_ID,
    source: "http",
    startedAt: at,
    lastHeartbeatAt: at,
    queuedAt: at
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

/** The DevTool's on-demand sweep, driven as a real HTTP request. */
async function postCheckInterrupted(router: FlowApiRouter): Promise<Response> {
  return router.POST(
    new Request(
      `http://localhost/api/flows/users/${USER_ID}/check-interrupted`,
      { method: "POST", headers: { "content-type": "application/json" } }
    ),
    { params: { path: ["users", USER_ID, "check-interrupted"] } }
  );
}

let activeRouter: FlowApiRouter | undefined;

afterEach(async () => {
  if (activeRouter !== undefined) {
    await disposeFlowApiRouter(activeRouter);
    activeRouter = undefined;
  }
  vi.useRealTimers();
});

describe("queued grace is configurable from the shipped sweeper paths (FIX-999)", () => {
  describe("the router's periodic sweeper", () => {
    it("a configured grace keeps a queued row alive past the ten-minute default", async () => {
      vi.useFakeTimers();
      const stores = createInMemoryStores();
      await seedQueuedRequest(stores, TWENTY_MINUTES_MS);

      // Startup detection is off so the periodic sweeper is unambiguously the
      // thing under test; it gets its own case below.
      activeRouter = createFlowApiRouter({
        registry: buildRegistry(),
        stores,
        detectInterruptedOnStartup: false,
        staleSweepIntervalMs: 1_000,
        queuedGraceMs: CONFIGURED_GRACE_MS
      });

      await vi.advanceTimersByTimeAsync(1_100);

      // Pre-fix: the option does not exist on the router, so the sweeper falls
      // back to ten minutes, marks this row interrupted and deregisters it —
      // while the dispatcher still holds the job.
      expect(await statusOf(stores)).toBe("in_progress");
      expect(await isRegistered(stores)).toBe(true);
    });

    it("past the CONFIGURED grace the same row is still reaped", async () => {
      vi.useFakeTimers();
      const stores = createInMemoryStores();
      await seedQueuedRequest(stores, THIRTY_ONE_MINUTES_MS);

      activeRouter = createFlowApiRouter({
        registry: buildRegistry(),
        stores,
        detectInterruptedOnStartup: false,
        staleSweepIntervalMs: 1_000,
        queuedGraceMs: CONFIGURED_GRACE_MS
      });

      await vi.advanceTimersByTimeAsync(1_100);

      expect(await statusOf(stores)).toBe("interrupted");
      expect(await isRegistered(stores)).toBe(false);
    });

    it("omitting the option still gets exactly ten minutes", async () => {
      vi.useFakeTimers();
      const stores = createInMemoryStores();
      await seedQueuedRequest(stores, ELEVEN_MINUTES_MS);

      activeRouter = createFlowApiRouter({
        registry: buildRegistry(),
        stores,
        detectInterruptedOnStartup: false,
        staleSweepIntervalMs: 1_000
      });

      await vi.advanceTimersByTimeAsync(1_100);

      expect(await statusOf(stores)).toBe("interrupted");
      expect(await isRegistered(stores)).toBe(false);
    });
  });

  describe("startup detection", () => {
    it("honours the configured grace", async () => {
      vi.useFakeTimers();
      const stores = createInMemoryStores();
      await seedQueuedRequest(stores, TWENTY_MINUTES_MS);

      // Sweeping cadence off, so only the startup pass can touch the row.
      activeRouter = createFlowApiRouter({
        registry: buildRegistry(),
        stores,
        staleSweepIntervalMs: 0,
        queuedGraceMs: CONFIGURED_GRACE_MS
      });

      // Startup detection is fire-and-forget; let its store reads settle.
      await vi.advanceTimersByTimeAsync(1);

      expect(await statusOf(stores)).toBe("in_progress");
      expect(await isRegistered(stores)).toBe(true);
    });

    it("still reaps past the configured grace", async () => {
      vi.useFakeTimers();
      const stores = createInMemoryStores();
      await seedQueuedRequest(stores, THIRTY_ONE_MINUTES_MS);

      activeRouter = createFlowApiRouter({
        registry: buildRegistry(),
        stores,
        staleSweepIntervalMs: 0,
        queuedGraceMs: CONFIGURED_GRACE_MS
      });

      await vi.advanceTimersByTimeAsync(1);

      expect(await statusOf(stores)).toBe("interrupted");
      expect(await isRegistered(stores)).toBe(false);
    });
  });

  describe("the check-interrupted recovery route", () => {
    it("honours the configured grace", async () => {
      const stores = createInMemoryStores();
      await seedQueuedRequest(stores, TWENTY_MINUTES_MS);

      activeRouter = createFlowApiRouter({
        registry: buildRegistry(),
        stores,
        detectInterruptedOnStartup: false,
        staleSweepIntervalMs: 0,
        queuedGraceMs: CONFIGURED_GRACE_MS
      });

      const res = await postCheckInterrupted(activeRouter);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ interrupted: [] });

      expect(await statusOf(stores)).toBe("in_progress");
      expect(await isRegistered(stores)).toBe(true);
    });

    it("still reaps past the configured grace", async () => {
      const stores = createInMemoryStores();
      await seedQueuedRequest(stores, THIRTY_ONE_MINUTES_MS);

      activeRouter = createFlowApiRouter({
        registry: buildRegistry(),
        stores,
        detectInterruptedOnStartup: false,
        staleSweepIntervalMs: 0,
        queuedGraceMs: CONFIGURED_GRACE_MS
      });

      const res = await postCheckInterrupted(activeRouter);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { interrupted: { requestId: string }[] };
      expect(body.interrupted.map((i) => i.requestId)).toEqual([REQUEST_ID]);

      expect(await statusOf(stores)).toBe("interrupted");
      expect(await isRegistered(stores)).toBe(false);
    });
  });
});
