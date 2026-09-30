/**
 * Shared end-to-end conformance for what session retention leaves behind
 * when it deletes a request. Every `StoreRegistry` backend runs it via
 * `@flow-state-dev/engine/testing`.
 *
 * Request ids are caller-supplied, and retention frees them. A later request,
 * from another user, may take a freed id; the stream route then replays that
 * id's persisted events from sequence 0. Whatever the previous run left in
 * the store reaches the new owner. The case drives the real path: HTTP action
 * POSTs, retention evicting the request after a later run in the same
 * session, the id reused from another session, and a replay over the HTTP
 * stream route.
 *
 * The previous run is deliberately longer than the new one. Stores that
 * upsert events by `(requestId, sequence_number)` would otherwise overwrite
 * every leftover row and hide the leak.
 */
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFlowRegistry } from "../../registry/flow-registry";
import {
  createFlowApiRouter,
  disposeFlowApiRouter
} from "../../routes/createFlowApiRouter";
import type { StoreRegistry } from "../types";

export type CreateRequestRetentionConformanceTestsOptions = {
  /** Display name surfaced in the `describe` block, e.g. `"SQLite stores"`. */
  name: string;
  /** Build a fresh, empty store registry. Called per test. */
  createStores: () => StoreRegistry | Promise<StoreRegistry>;
  /** Optional teardown hook for backends with external resources. */
  cleanup?: (stores: StoreRegistry) => Promise<void> | void;
};

const FLOW = "retention-conformance";
const REUSED_ID = "req_retention_reused";
/** Live-tail liveness timeout for the case; retention's grace window is twice it. */
const LIVENESS_MS = 50;

/** Emits `count` messages carrying `secret`, so a stream shows whose run it is. */
function buildFlow(): FlowInstance {
  const inputSchema = z.object({ secret: z.string(), count: z.number() });
  return defineFlow({
    kind: FLOW,
    actions: {
      run: {
        inputSchema,
        block: handler({
          name: "say",
          inputSchema,
          outputSchema: z.object({}),
          execute: (input, ctx) => {
            for (let i = 0; i < input.count; i += 1) {
              ctx.emit.message(`${input.secret} #${i}`);
            }
            return {};
          }
        })
      }
    },
    // Every run has at least one item, so maxItems: 1 keeps only the newest.
    session: { retention: { maxItems: 1 } }
  })() as unknown as FlowInstance;
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition not reached within 5s");
}

/**
 * Alice's run takes the id and is evicted by retention; Bob then takes the
 * freed id for a shorter run. Returns what retention left under the id and
 * Bob's replay of it from the start.
 */
async function runReusedIdScenario(stores: StoreRegistry): Promise<{
  leftAfterRetention: number;
  replay: string;
}> {
  const registry = createFlowRegistry();
  registry.registerMany([buildFlow()]);
  // No stale sweeper: its interval would outlive the case and keep querying
  // stores the cleanup hook has already closed.
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });

  async function post(
    sessionId: string,
    userId: string,
    requestId: string,
    input: { secret: string; count: number }
  ): Promise<void> {
    const response = await router.POST(
      new Request(`http://localhost/api/flows/${FLOW}/${sessionId}/actions/run`, {
        method: "POST",
        body: JSON.stringify({ userId, orgId: DEFAULT_ORG_ID, requestId, input })
      }),
      { params: { path: [FLOW, sessionId, "actions", "run"] } }
    );
    expect(response.status).toBe(202);
    // The record turns `completed` before the run's tail (retention, then
    // leaving the active registry) has run. Wait for the tail too, so the
    // next step sees retention's result and teardown never races a write.
    await waitFor(async () => (await stores.request.get(requestId))?.status === "completed");
    await waitFor(async () => (await stores.activeRequests.get(requestId)) === undefined);
    await stores.request.flushEvents(requestId);
  }

  // Retention leaves a finished request alone for twice the live-tail
  // liveness timeout. Shorten the timeout so the case can wait that out.
  const previousLiveness = process.env.LIVE_TAIL_LIVENESS_MS;
  process.env.LIVE_TAIL_LIVENESS_MS = String(LIVENESS_MS);
  try {
    await post("s_alice", "alice", REUSED_ID, { secret: "alice-secret", count: 5 });
    await new Promise((resolve) => setTimeout(resolve, 3 * LIVENESS_MS));
    await post("s_alice", "alice", "req_alice_next", { secret: "alice-next", count: 1 });
    await waitFor(async () => (await stores.request.get(REUSED_ID)) === undefined);
    const leftAfterRetention = (await stores.request.getEvents(REUSED_ID)).length;

    await post("s_bob", "bob", REUSED_ID, { secret: "bob-secret", count: 1 });
    const response = await router.GET(
      new Request(`http://localhost/api/flows/${FLOW}/requests/${REUSED_ID}/stream`),
      { params: { path: [FLOW, "requests", REUSED_ID, "stream"] } }
    );
    expect(response.status).toBe(200);
    return { leftAfterRetention, replay: await response.text() };
  } finally {
    if (previousLiveness === undefined) delete process.env.LIVE_TAIL_LIVENESS_MS;
    else process.env.LIVE_TAIL_LIVENESS_MS = previousLiveness;
    await disposeFlowApiRouter(router);
  }
}

/**
 * Register the retention reused-id conformance cases against a backend. Call
 * inside a test file's top-level scope.
 */
export function createRequestRetentionConformanceTests(
  options: CreateRequestRetentionConformanceTestsOptions
): void {
  const { name, createStores, cleanup } = options;

  describe(`${name} (retention and a reused request id)`, () => {
    it("retention takes a request's events with its record, so a reused id replays only its new owner's run", async () => {
      const stores = await createStores();
      try {
        const { leftAfterRetention, replay } = await runReusedIdScenario(stores);
        expect(leftAfterRetention).toBe(0);
        expect(replay).toContain("bob-secret");
        expect(replay).not.toContain("alice-secret");
      } finally {
        if (cleanup !== undefined) await cleanup(stores);
      }
    });
  });
}
