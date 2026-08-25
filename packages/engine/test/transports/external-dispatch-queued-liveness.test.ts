/**
 * Regression for FIX-999: a request that is queued with an EXTERNAL dispatcher
 * and not yet claimed by a worker must not be read as dead.
 *
 * The host registers the request at enqueue time and deliberately does not
 * heartbeat it — the worker that will run it lives in another process and has
 * not started. Age therefore measures queue wait, not worker death. Reading it
 * as death makes the liveness verb answer `false` for perfectly valid work, and
 * lets the sweeper mark the record `interrupted`; reconciliation may then retry
 * it before the original worker ever runs it. Duplicate execution is the exact
 * failure this seam exists to prevent.
 *
 * The round-1 queued-heartbeat fix covers the IN-PROCESS deferred branch only
 * (the host holds that run, so it can keep the entry warm). It does not reach
 * this path and cannot: the enqueuing process hands off at `queue.add` and
 * returns 202, so nothing there has the lifetime or the standing to beat for a
 * job it is not running.
 *
 * These drive the real host registration and the real stores — no injected
 * registry entry standing in for the thing under test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver
} from "../../src";
import { readLiveness } from "../../src/context/liveness-read";
import { detectInterruptedRequests } from "../../src/execution/request-recovery";
import { runAction } from "../../src/execution/runAction";
import type { FlowDispatcher } from "../../src/transports/dispatcher";
import type { FlowRegistry } from "../../src/registry/flow-registry";
import type { StoreRegistry } from "../../src/stores/types";

const FLOW_KIND = "queued-liveness-test";
const STALE_THRESHOLD_MS = 30_000;

/** Released in `afterEach` so a deliberately-hanging worker run never leaks. */
let releaseWorker: (() => void) | undefined;

function buildRegistry(): FlowRegistry {
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: FLOW_KIND,
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler<{ value: string }, { ok: true }>({
            name: "queued-liveness-run",
            // Models a worker that has claimed the job and is still working:
            // it never returns on its own, so the entry stays registered and
            // the sweeper's view of it is the thing under test.
            execute: () =>
              new Promise<{ ok: true }>((resolve) => {
                releaseWorker = () => resolve({ ok: true });
              })
          })
        }
      }
    })({ id: FLOW_KIND })
  );
  return registry;
}

/**
 * A dispatcher that accepts the job and whose worker never starts — the queue
 * has a backlog. `dispatch` resolving is the enqueue; `finished` staying
 * pending is the backlog. No `dispatchLocal`, which is what marks it external
 * to the host.
 */
function backloggedExternalDispatcher(): FlowDispatcher {
  return {
    dispatch: vi.fn(async (env) => ({
      requestId: env.requestId,
      finished: new Promise<never>(() => {}),
      abort: () => {}
    })),
    close: vi.fn(async () => {})
  };
}

/** Enqueue one request through the real host and return its id. */
async function enqueueViaHost(
  registry: FlowRegistry,
  stores: StoreRegistry
): Promise<string> {
  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {},
    dispatcher: backloggedExternalDispatcher()
  });

  const handle = host.dispatch({
    source: "http",
    flowKind: FLOW_KIND,
    action: "run",
    input: { value: "hi" },
    sessionId: "s_1",
    principal: { userId: "u_1" }
  });

  // Resolves once the enqueue-time writes committed AND the dispatcher
  // accepted the job — the same signal the HTTP adapter acks a 202 on.
  await handle.accepted;
  return handle.requestId;
}

/** The seam's own read, against the entry the host actually wrote. */
async function liveness(
  stores: StoreRegistry,
  requestId: string
): Promise<boolean | undefined> {
  const answers = await readLiveness([requestId], {
    registry: stores.activeRequests,
    staleThresholdMs: STALE_THRESHOLD_MS,
    flowKind: FLOW_KIND,
    principal: { userId: "u_1", tenantId: undefined },
    isDescendantSession: async (sessionId) => sessionId === "s_1"
  });
  return answers[requestId];
}

afterEach(() => {
  releaseWorker?.();
  releaseWorker = undefined;
  vi.useRealTimers();
});

describe("external dispatch — queued requests are not dead requests (FIX-999)", () => {
  it("a queued job whose backlog outlasts the stale threshold still reads as live", async () => {
    vi.useFakeTimers();
    const registry = buildRegistry();
    const stores = createInMemoryStores();
    const requestId = await enqueueViaHost(registry, stores);

    // Still fresh the instant it is accepted — true before and after the fix.
    expect(await liveness(stores, requestId)).toBe(true);

    // A backlog four times the threshold. `setSystemTime` moves the clock
    // without firing timers, which is exactly the situation: no worker has
    // claimed the job, so nothing is beating for it.
    vi.setSystemTime(Date.now() + STALE_THRESHOLD_MS * 4);

    // Pre-fix this is `false`: the entry's age is read as death, so the verb
    // reports a perfectly valid queued job as not live.
    expect(await liveness(stores, requestId)).toBe(true);
  });

  it("the sweeper leaves a queued-but-unclaimed row in_progress and registered", async () => {
    vi.useFakeTimers();
    const registry = buildRegistry();
    const stores = createInMemoryStores();
    const requestId = await enqueueViaHost(registry, stores);

    vi.setSystemTime(Date.now() + STALE_THRESHOLD_MS * 4);

    const interrupted = await detectInterruptedRequests({
      stores,
      staleThresholdMs: STALE_THRESHOLD_MS
    });

    // Pre-fix: interrupted has length 1, the record is `interrupted`, and the
    // entry is gone — so reconciliation is free to retry a job the queue is
    // still holding.
    expect(interrupted).toHaveLength(0);
    expect((await stores.request.get(requestId))?.status).toBe("in_progress");
    expect(await stores.activeRequests.get(requestId)).toBeDefined();
  });

  it("a queued row is not permanently un-reapable: past the queued grace it is reaped", async () => {
    vi.useFakeTimers();
    const registry = buildRegistry();
    const stores = createInMemoryStores();
    const requestId = await enqueueViaHost(registry, stores);

    // Past the grace the job is treated as lost — the queue dropped it, or it
    // was never really accepted. Without this the fix would trade a false
    // "interrupted" for a row that lingers in_progress forever.
    vi.setSystemTime(Date.now() + 11 * 60_000);

    const interrupted = await detectInterruptedRequests({
      stores,
      staleThresholdMs: STALE_THRESHOLD_MS
    });

    expect(interrupted).toHaveLength(1);
    expect((await stores.request.get(requestId))?.status).toBe("interrupted");
    expect(await stores.activeRequests.get(requestId)).toBeUndefined();
    // And the verb stops claiming it is live, because the entry is gone.
    expect(await liveness(stores, requestId)).toBe(false);
  });

  it("once a worker claims the job the entry is ordinarily heartbeat-governed again", async () => {
    vi.useFakeTimers();
    const registry = buildRegistry();
    const stores = createInMemoryStores();
    const requestId = await enqueueViaHost(registry, stores);

    // The worker picks the job up. This is the real claim: `runAction`
    // re-registers the whole entry with fresh timestamps and starts its own
    // heartbeat, which is what drops the queued marker.
    const flow = registry.get(FLOW_KIND);
    expect(flow).toBeDefined();
    void runAction({
      flow: flow!,
      actionName: "run",
      input: { value: "hi" },
      userId: "u_1",
      sessionId: "s_1",
      requestId,
      source: "http",
      stores,
      runtimeConfig: {}
    });

    // Let the registration land.
    await vi.advanceTimersByTimeAsync(1);

    const claimed = await stores.activeRequests.get(requestId);
    expect(claimed).toBeDefined();
    expect(claimed?.queuedAt).toBeUndefined();

    // The worker now dies: the clock moves but its heartbeat timer never fires.
    vi.setSystemTime(Date.now() + STALE_THRESHOLD_MS * 4);

    expect(await liveness(stores, requestId)).toBe(false);

    const interrupted = await detectInterruptedRequests({
      stores,
      staleThresholdMs: STALE_THRESHOLD_MS
    });
    expect(interrupted).toHaveLength(1);
    expect(await stores.activeRequests.get(requestId)).toBeUndefined();
  });
});
