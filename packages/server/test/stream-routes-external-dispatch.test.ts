/**
 * Regression for FIX-828: an externally-dispatched request must be streamable
 * the moment it is accepted.
 *
 * The transport host registers the request in the store at enqueue time, so a
 * `GET …/stream` that arrives before the worker starts resolves a live
 * `in_progress` record and tails events — instead of 404ing (the bug) or
 * sitting through the cross-instance wait-loop. These are server-package unit
 * seams: no Redis, no real worker.
 */
import { describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver
} from "../src";
import { handleRequestStream } from "../src/routes/stream-routes";
import { createInitialRequestRecord } from "../src/context/initial-request-record";
import { detectInterruptedRequests } from "../src/execution/request-recovery";
import type { FlowDispatcher } from "../src/transports/dispatcher";
import type { FlowRegistry } from "../src/registry/flow-registry";
import type { ParsedFlowRoute } from "../src/routes/parseFlowRoute";

const FLOW_KIND = "external-dispatch-test";

function buildRegistry(): FlowRegistry {
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: FLOW_KIND,
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler<{ value: string }, { ok: true }>({
            name: "external-dispatch-run",
            execute: () => ({ ok: true })
          })
        }
      }
    })({ id: FLOW_KIND })
  );
  return registry;
}

/**
 * A FlowDispatcher whose worker never starts: `dispatch` resolves a handle
 * whose `finished` stays pending, modelling a queued job no worker has claimed.
 * Having no `dispatchLocal` marks it external to the host.
 */
function pendingExternalDispatcher(): FlowDispatcher {
  return {
    dispatch: vi.fn(async (env) => ({
      requestId: env.requestId,
      finished: new Promise<never>(() => {}),
      abort: () => {}
    })),
    close: vi.fn(async () => {})
  };
}

function streamRoute(
  requestId: string
): Extract<ParsedFlowRoute, { kind: "request_stream" }> {
  return { kind: "request_stream", flowKind: FLOW_KIND, requestId } as Extract<
    ParsedFlowRoute,
    { kind: "request_stream" }
  >;
}

describe("external dispatch — enqueue-time stream discoverability (FIX-828)", () => {
  it("streams before the worker starts instead of 404ing", async () => {
    const registry = buildRegistry();
    const stores = createInMemoryStores();
    const host = createInboundTransportHost({
      registry,
      stores,
      resolvePrincipal: defaultBodyUserIdPrincipalResolver,
      runtimeConfig: {},
      dispatcher: pendingExternalDispatcher()
    });

    const handle = host.dispatch({
      source: "http",
      flowKind: FLOW_KIND,
      action: "run",
      input: { value: "hi" },
      sessionId: "s_1",
      principal: { userId: "u_1" }
    });

    // Await the enqueue-time writes structurally rather than relying on
    // microtask ordering: `handle.materialized` resolves once activeRequests +
    // the in_progress record have committed. This is also what the HTTP adapter
    // awaits before acking the 202. With a truly async store the GET could
    // otherwise arrive before the writes land — the stream-routes wait-loop is
    // the production guard for that residual cross-instance race.
    await handle.materialized;

    // The worker has not run yet; the client's GET arrives now. Pre-fix this
    // finds neither a record nor an activeRequests entry and 404s.
    const controller = new AbortController();
    const request = new Request("https://x/stream", { signal: controller.signal });
    const response = await handleRequestStream(request, streamRoute(handle.requestId), {
      registry,
      stores
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    controller.abort(); // tear down the background live-tail subscription
  });

  it("a materialized in_progress record live-tails immediately, skipping the wait-loop", async () => {
    const registry = buildRegistry();
    const stores = createInMemoryStores();
    const requestId = "req_materialized";
    const ts = Date.now();

    await stores.activeRequests.register({
      requestId,
      flowKind: FLOW_KIND,
      actionName: "run",
      userId: "u_1",
      sessionId: "s_1",
      source: "http",
      startedAt: ts,
      lastHeartbeatAt: ts
    });
    await stores.request.set(
      requestId,
      createInitialRequestRecord(
        { requestId, flowKind: FLOW_KIND, actionName: "run", userId: "u_1", sessionId: "s_1", source: "http" },
        ts
      ),
      "any"
    );

    // The wait-loop is the only path that consults activeRequests.get; the
    // live-tail branch never does. Asserting it was never called pins that we
    // went straight to live-tail with no 3s polling delay.
    const activeGetSpy = vi.spyOn(stores.activeRequests, "get");
    const controller = new AbortController();
    const request = new Request("https://x/stream", { signal: controller.signal });
    const response = await handleRequestStream(request, streamRoute(requestId), {
      registry,
      stores
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(activeGetSpy).not.toHaveBeenCalled();
    controller.abort();
  });

  it("a genuinely unknown requestId still 404s", async () => {
    const registry = buildRegistry();
    const stores = createInMemoryStores();

    const request = new Request("https://x/stream");
    const response = await handleRequestStream(request, streamRoute("req_unknown"), {
      registry,
      stores
    });

    expect(response.status).toBe(404);
  });

  it("an enqueue-time record whose worker never starts is reaped by the sweeper", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_orphan";
    const stale = Date.now() - 60_000;

    // Same shape the host writes at enqueue time, but stale: the worker never
    // claimed the job, so it never heartbeat.
    await stores.activeRequests.register({
      requestId,
      flowKind: FLOW_KIND,
      actionName: "run",
      userId: "u_1",
      sessionId: "s_1",
      source: "http",
      startedAt: stale,
      lastHeartbeatAt: stale
    });
    await stores.request.set(
      requestId,
      createInitialRequestRecord(
        { requestId, flowKind: FLOW_KIND, actionName: "run", userId: "u_1", sessionId: "s_1", source: "http" },
        stale
      ),
      "any"
    );

    const interrupted = await detectInterruptedRequests({ stores, staleThresholdMs: 30_000 });

    expect(interrupted).toHaveLength(1);
    expect((await stores.request.get(requestId))?.status).toBe("interrupted");
    expect(await stores.activeRequests.get(requestId)).toBeUndefined();
  });
});
