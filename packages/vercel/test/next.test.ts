import { describe, expect, it } from "vitest";
import type { FlowApiRouter, FlowState } from "@flow-state-dev/server";
import { createVercelNextHandler } from "../src/next";

describe("createVercelNextHandler", () => {
  it("resolves the router lazily and applies Vercel SSE shaping", async () => {
    let getRouterCalls = 0;

    const fakeRouter = {
      GET: async () =>
        new Response("data: hi\n\n", {
          headers: { "content-type": "text/event-stream" }
        }),
      POST: async () => new Response("ok"),
      PATCH: async () => new Response("ok"),
      DELETE: async () => new Response("ok")
    } as unknown as FlowApiRouter;

    const fakeFlowState = {
      getRouter: async () => {
        getRouterCalls += 1;
        return fakeRouter;
      }
    } as unknown as FlowState;

    const { GET, POST, PATCH, DELETE } = createVercelNextHandler(fakeFlowState);
    expect(typeof GET).toBe("function");
    expect(typeof POST).toBe("function");
    expect(typeof PATCH).toBe("function");
    expect(typeof DELETE).toBe("function");
    expect(getRouterCalls).toBe(0);

    const res = await GET(new Request("http://localhost/api/flows"), {
      params: Promise.resolve({ path: [] })
    });

    expect(getRouterCalls).toBe(1);
    // createVercelHandler injects the Vercel proxy SSE headers.
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("cache-control")).toContain("no-transform");
  });
});
