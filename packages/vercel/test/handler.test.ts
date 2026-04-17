import { describe, it, expect, vi } from "vitest";
import { createVercelHandler, createVercelBareHandler } from "../src/handler";
import type { FlowApiRouter } from "../src/types";

function createMockRouter(overrides?: Partial<FlowApiRouter>): FlowApiRouter {
  const defaultHandler = async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

  return {
    GET: overrides?.GET ?? defaultHandler,
    POST: overrides?.POST ?? defaultHandler,
    PATCH: overrides?.PATCH ?? defaultHandler,
    DELETE: overrides?.DELETE ?? defaultHandler
  };
}

function makeRequest(method = "GET"): Request {
  return new Request("http://localhost/api/flows/test", { method });
}

function makeRouteContext(path: string[] = ["test"]): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path }) };
}

function createSSEResponse(): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: test\n\n"));
      controller.close();
    }
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" }
  });
}

describe("createVercelHandler", () => {
  it("forwards requests to the underlying router", async () => {
    const spy = vi.fn(async () => new Response("ok"));
    const router = createMockRouter({ GET: spy });
    const handler = createVercelHandler(router);

    await handler.GET(makeRequest(), makeRouteContext(["hello"]));

    expect(spy).toHaveBeenCalledOnce();
    const [, ctx] = spy.mock.calls[0];
    expect(ctx.params.path).toEqual(["hello"]);
  });

  it("unwraps async params from Next.js 15", async () => {
    const spy = vi.fn(async () => new Response("ok"));
    const router = createMockRouter({ POST: spy });
    const handler = createVercelHandler(router);

    await handler.POST(
      makeRequest("POST"),
      makeRouteContext(["my-flow", "actions", "run"])
    );

    const [, ctx] = spy.mock.calls[0];
    expect(ctx.params.path).toEqual(["my-flow", "actions", "run"]);
  });

  it("passes through non-SSE responses unchanged", async () => {
    const jsonBody = JSON.stringify({ status: "in_progress" });
    const router = createMockRouter({
      POST: async () => new Response(jsonBody, {
        status: 202,
        headers: { "content-type": "application/json" }
      })
    });

    const handler = createVercelHandler(router);
    const response = await handler.POST(makeRequest("POST"), makeRouteContext());

    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-accel-buffering")).toBeNull();
    expect(await response.text()).toBe(jsonBody);
  });

  it("adds Vercel SSE headers to GET event-stream responses", async () => {
    const router = createMockRouter({ GET: async () => createSSEResponse() });
    const handler = createVercelHandler(router);
    const response = await handler.GET(makeRequest(), makeRouteContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
  });

  it("skips heartbeat wrapping for POST SSE responses", async () => {
    const router = createMockRouter({ POST: async () => createSSEResponse() });
    const handler = createVercelHandler(router);
    const response = await handler.POST(makeRequest("POST"), makeRouteContext());

    const text = await response.text();
    expect(text).toBe("data: test\n\n");
    expect(text).not.toContain(": ping");
  });

  it("accepts a factory function for lazy router creation", async () => {
    const factory = vi.fn(() => createMockRouter());
    const handler = createVercelHandler(factory);

    await handler.GET(makeRequest(), makeRouteContext());
    await handler.GET(makeRequest(), makeRouteContext());

    expect(factory).toHaveBeenCalledOnce();
  });

  it("accepts an async factory function", async () => {
    const factory = vi.fn(async () => createMockRouter());
    const handler = createVercelHandler(factory);

    const response = await handler.GET(makeRequest(), makeRouteContext());
    expect(response.status).toBe(200);
    expect(factory).toHaveBeenCalledOnce();
  });

  it("handles optional catch-all with undefined path", async () => {
    const spy = vi.fn(async () => new Response("ok"));
    const router = createMockRouter({ GET: spy });
    const handler = createVercelHandler(router);

    const ctx = { params: Promise.resolve({ path: undefined as unknown as string[] }) };
    await handler.GET(makeRequest(), ctx);

    const [, routerCtx] = spy.mock.calls[0];
    expect(routerCtx.params).toBeDefined();
  });

  it("calls onAbort when request is aborted", async () => {
    const onAbort = vi.fn();
    const controller = new AbortController();
    const router = createMockRouter();
    const handler = createVercelHandler(router, { onAbort });

    const req = new Request("http://localhost/api/flows/test", {
      signal: controller.signal
    });
    await handler.GET(req, makeRouteContext());

    controller.abort();
    expect(onAbort).toHaveBeenCalledWith(req);
  });

  it("exposes all four HTTP methods", () => {
    const handler = createVercelHandler(createMockRouter());
    expect(handler.GET).toBeTypeOf("function");
    expect(handler.POST).toBeTypeOf("function");
    expect(handler.PATCH).toBeTypeOf("function");
    expect(handler.DELETE).toBeTypeOf("function");
  });
});

describe("createVercelBareHandler", () => {
  it("forwards requests with empty path array", async () => {
    const spy = vi.fn(async () => new Response("ok"));
    const router = createMockRouter({ GET: spy });
    const handler = createVercelBareHandler(router);

    await handler.GET(makeRequest());

    expect(spy).toHaveBeenCalledOnce();
    const [, ctx] = spy.mock.calls[0];
    expect(ctx.params.path).toEqual([]);
  });

  it("exposes GET and POST methods", () => {
    const handler = createVercelBareHandler(createMockRouter());
    expect(handler.GET).toBeTypeOf("function");
    expect(handler.POST).toBeTypeOf("function");
  });

  it("wraps SSE responses with Vercel headers", async () => {
    const router = createMockRouter({ GET: async () => createSSEResponse() });
    const handler = createVercelBareHandler(router);
    const response = await handler.GET(makeRequest());

    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
  });

  it("accepts a factory function for lazy router creation", async () => {
    const factory = vi.fn(() => createMockRouter());
    const handler = createVercelBareHandler(factory);

    await handler.GET(makeRequest());
    await handler.POST(makeRequest("POST"));

    expect(factory).toHaveBeenCalledOnce();
  });
});
