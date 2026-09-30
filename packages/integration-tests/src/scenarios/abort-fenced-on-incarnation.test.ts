/**
 * A cancel lands on the request its caller checked, and on nothing else that
 * holds the id.
 *
 * The abort route reads the record, checks the caller owns it, and then writes
 * the intent. Between the read and the write the id can change hands in two
 * ways, and the route must answer each one correctly:
 *
 *   (a) The owner's own retry re-stamps the record under the same id. That is
 *       still the owner's request: same incarnation, rewritten `createdAt`.
 *       The cancel must land and the run must end `aborted`.
 *   (b) The checked request finished, its record went, and a later request
 *       took the id. That request never received this cancel: it must keep
 *       running, and its record must not carry the intent.
 *
 * Both legs run a real flow through `runAction` on one shared store and cancel
 * it through the flow router's abort route, in the same process as the run, so
 * the route's in-process fire is on the path too. The interleave is staged by
 * wrapping the store's `get` for the one call the route's owner check makes.
 *
 * The give-up timer in the parked block is the falsifier: a cancel that never
 * arrives surfaces as a `completed` run rather than a hung test.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  runAction
} from "@flow-state-dev/engine";
import type { RequestRecord, StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";

const FLOW_KIND = "abort-fence";
const USER_ID = "u_fence";

type Park = {
  /** Resolves once the run is inside its block, so the cancel meets a live run. */
  started: Promise<void>;
  /** Whether the run's own signal fired before its give-up timer. */
  abortedWhenDone?: boolean;
};

/**
 * A block that parks until its signal fires or `selfCompleteMs` passes, and
 * throws on abort so the run settles `aborted` the way a real cancelled step
 * does.
 */
function parkingFlow(park: Park & { markStarted: () => void }, selfCompleteMs: number) {
  return defineFlow({
    kind: FLOW_KIND,
    actions: {
      run: {
        inputSchema: z.unknown(),
        block: handler({
          name: "park",
          inputSchema: z.unknown(),
          outputSchema: z.string(),
          execute: async (_input: unknown, ctx: BlockContext) => {
            park.markStarted();
            const outcome = await new Promise<"aborted" | "self-completed">((resolve) => {
              if (ctx.signal?.aborted === true) return resolve("aborted");
              const timer = setTimeout(() => resolve("self-completed"), selfCompleteMs);
              ctx.signal?.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  resolve("aborted");
                },
                { once: true }
              );
            });
            park.abortedWhenDone = outcome === "aborted";
            if (outcome === "aborted") throw new DOMException("Aborted", "AbortError");
            return outcome;
          }
        })
      }
    }
  })({ id: FLOW_KIND });
}

function newPark(): Park & { markStarted: () => void } {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  return { started, markStarted };
}

function run(flow: ReturnType<typeof parkingFlow>, stores: StoreRegistry, requestId: string) {
  return runAction({
    flow,
    actionName: "run",
    input: {},
    requestId,
    userId: USER_ID,
    orgId: DEFAULT_ORG_ID,
    stores,
    runtimeConfig: { modelResolver: createMockModelResolver({}) }
  });
}

/**
 * POST the flow router's abort route. The route's owner-check read of
 * `requestId` returns `read(fresh)`, and `between` runs after that read and
 * before the route writes anything.
 */
async function abortThroughRouter(
  flow: ReturnType<typeof parkingFlow>,
  stores: StoreRegistry,
  requestId: string,
  interleave: {
    read?: (fresh: RequestRecord | undefined) => RequestRecord | undefined;
    between?: () => Promise<void>;
  }
): Promise<number> {
  const registry = createFlowRegistry();
  registry.register(flow);
  const router = createFlowApiRouter({ registry, stores, detectInterruptedOnStartup: false });

  const get = stores.request.get.bind(stores.request);
  let intercepted = false;
  stores.request.get = async (id: string) => {
    const fresh = await get(id);
    if (intercepted || id !== requestId) return fresh;
    intercepted = true;
    const seen = interleave.read === undefined ? fresh : interleave.read(fresh);
    await interleave.between?.();
    return seen;
  };
  try {
    const response = await router.POST(
      new Request(`http://localhost/api/flows/${FLOW_KIND}/requests/${requestId}/abort`, {
        method: "POST"
      }),
      { params: { path: [FLOW_KIND, "requests", requestId, "abort"] } }
    );
    return response.status;
  } finally {
    stores.request.get = get;
  }
}

describe("a cancel is fenced on the request its caller checked", () => {
  it("(a) stops the owner's run after their own retry re-stamped its record", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_fence_handoff";
    const park = newPark();
    const flow = parkingFlow(park, 3_000);

    const running = run(flow, stores, requestId);
    await park.started;
    const before = (await stores.request.get(requestId))!;

    const status = await abortThroughRouter(flow, stores, requestId, {
      // The owner's retry under the same id: the same request, re-stamped
      // with a later `createdAt` and its incarnation kept.
      between: async () => {
        const current = (await stores.request.get(requestId))!;
        await stores.request.set(
          requestId,
          { ...current, createdAt: current.createdAt + 1_000 },
          "any"
        );
      }
    });

    await running;
    const record = (await stores.request.get(requestId))!;

    // Precondition: the hand-off really rewrote `createdAt`, and kept the
    // incarnation, so only an identity fence can recognise the request.
    expect(record.createdAt).not.toBe(before.createdAt);
    expect(record.incarnation).toBe(before.incarnation);

    expect(status).toBe(204);
    expect(park.abortedWhenDone).toBe(true);
    expect(record.status).toBe("aborted");
    expect(record.abortRequested).toBe(true);
  });

  it("(b) leaves a later request under the same id running and unmarked", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_fence_reused";

    // The request the caller checks: captured while it runs, then finished.
    const firstPark = newPark();
    const first = run(parkingFlow(firstPark, 0), stores, requestId);
    await firstPark.started;
    const checked = (await stores.request.get(requestId))!;
    expect(checked.status).toBe("in_progress");
    await first;

    // Its record goes, and a later request by the same owner takes the id.
    await stores.request.delete(requestId);
    const laterPark = newPark();
    const flow = parkingFlow(laterPark, 300);
    const later = run(flow, stores, requestId);
    await laterPark.started;

    // The route's owner check read the checked request before it finished.
    const status = await abortThroughRouter(flow, stores, requestId, {
      read: () => checked
    });

    await later;
    const record = (await stores.request.get(requestId))!;

    expect(record.incarnation).not.toBe(checked.incarnation);
    expect(status).toBe(404);
    expect(laterPark.abortedWhenDone).toBe(false);
    expect(record.status).toBe("completed");
    expect(record.abortRequested).not.toBe(true);
  });
});
