/**
 * A live tail of `GET …/requests/:id/stream` ends when its caller leaves. A
 * host can say the caller left only by aborting the signal it built the
 * request with. On Node, a request's own signal hears that abort only while
 * the request itself is alive, so the route has to hold the request for as
 * long as the stream is open, not just its signal. Otherwise the tail keeps
 * its store subscription open after the caller has gone.
 */
import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../src";
import type { FlowRegistry } from "../src/registry/flow-registry";
import type { ParsedFlowRoute } from "../src/routes/parseFlowRoute";
import { handleRequestStream } from "../src/routes/stream-routes";
import type { StoreRegistry } from "../src/stores/types";

const FLOW_KIND = "disconnect-flow";
const REQUEST_ID = "req_disconnect";

const route = { kind: "request_stream", flowKind: FLOW_KIND, requestId: REQUEST_ID } as Extract<
  ParsedFlowRoute,
  { kind: "request_stream" }
>;

function stubRegistry(): FlowRegistry {
  return {
    get: (kind: string) => (kind === FLOW_KIND ? { kind: FLOW_KIND } : undefined)
  } as unknown as FlowRegistry;
}

describe("live tail whose caller aborts", () => {
  it("ends, though nothing else holds the request", async () => {
    const stores: StoreRegistry = createInMemoryStores();
    await stores.request.set(
      REQUEST_ID,
      {
        id: REQUEST_ID,
        flowKind: FLOW_KIND,
        actionName: "run",
        userId: "alice",
        sessionId: "sess_alice",
        status: "in_progress",
        startedAtMs: 100,
        createdAt: 100,
        updatedAt: 100,
        incarnation: "inc_alice",
        version: 1,
        state: {},
        items: []
      },
      "any"
    );
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const controller = new AbortController();
    // Built in a scope of its own, so once the route returns only it can hold the request.
    const response = await (() =>
      handleRequestStream(new Request("https://x/y/stream", { signal: controller.signal }), route, {
        registry: stubRegistry(),
        stores
      }))();
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    let ended = false;
    const drained = (async () => {
      try {
        while (!(await reader.read()).done);
      } catch {
        // Cancelled below.
      }
      ended = true;
    })();

    try {
      await pause(0);
      gc();
      await pause(0);
      gc();

      controller.abort();
      await Promise.race([drained, pause(1_000)]);
      expect(ended).toBe(true);
    } finally {
      await reader.cancel().catch(() => {});
    }
  });
});
