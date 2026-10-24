/**
 * `createInProcessFetch` — the one function that turns a Web `Request` into a
 * flow API router call, for a caller with no web server. These pin what a
 * fetcher handed to a client must do: reach the router from the URL's path
 * alone, under `basePath`, as `source: "http"`, waiting for store init.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createFlowState,
  createInProcessFetch,
  inMemoryStores,
  type FlowApiRouter,
  type FlowState
} from "../src";

/** A router that reflects what it received, for asserting the translation. */
const echoRouter: FlowApiRouter = {
  GET: async (_req, ctx) => Response.json({ method: "GET", path: ctx.params.path }),
  POST: async (req, ctx) =>
    Response.json({ method: "POST", path: ctx.params.path, body: await req.text() }, { status: 201 }),
  PATCH: async () => new Response("patched", { status: 200 }),
  DELETE: async () => new Response(null, { status: 204 })
};

const echoFlow = defineFlow({
  kind: "echo",
  actions: {
    say: {
      inputSchema: z.object({ text: z.string() }),
      block: handler({
        name: "echo-say",
        inputSchema: z.object({ text: z.string() }),
        execute: (input: { text: string }) => ({ said: input.text })
      })
    }
  }
})();

function flowState(): FlowState {
  return createFlowState({
    flows: { echo: echoFlow },
    stores: { default: { primary: inMemoryStores() } }
  });
}

describe("createInProcessFetch", () => {
  it("routes by the URL's path under the default base path, whatever the origin", async () => {
    const fetcher = createInProcessFetch(echoRouter);
    const res = await fetcher("http://any.origin.invalid/api/flows/chat/requests/r%201/status");
    expect(res.status).toBe(200);
    // Each segment is decoded once, the shape Next hands the router.
    expect(await res.json()).toEqual({ method: "GET", path: ["chat", "requests", "r 1", "status"] });
  });

  it("passes the method, body and a custom base path through", async () => {
    const fetcher = createInProcessFetch(echoRouter, { basePath: "/flows" });
    const res = await fetcher(new URL("http://x.invalid/flows/chat/actions/send"), {
      method: "post",
      body: "{\"a\":1}"
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ method: "POST", path: ["chat", "actions", "send"], body: "{\"a\":1}" });
  });

  it("hands a Request with no init to the router untouched", async () => {
    // A host passes its runtime's own Request; re-wrapping one can throw
    // (`@hono/node-server`'s lightweight Request) or drop what it carries.
    let received: Request | undefined;
    const fetcher = createInProcessFetch({
      ...echoRouter,
      GET: async (req, ctx) => {
        received = req;
        return Response.json({ method: "GET", path: ctx.params.path });
      }
    });
    const sent = new Request("http://x.invalid/api/flows/", { method: "GET" });
    const res = await fetcher(sent);
    expect(await res.json()).toEqual({ method: "GET", path: [] });
    expect(received).toBe(sent);
  });

  it("hands over a Request from another class by its URL, not as a stringified object", async () => {
    // A host's Request need not be this realm's global one: `@hono/node-server`
    // brings its own, and a test that installs DOM globals swaps the global.
    // Taken for a string, it would read as "/[object Request]" and answer 404.
    let received: unknown;
    const fetcher = createInProcessFetch({
      ...echoRouter,
      GET: async (req, ctx) => {
        received = req;
        return Response.json({ method: "GET", path: ctx.params.path });
      }
    });
    const foreign = { url: "http://x.invalid/api/flows/sessions", method: "GET", headers: new Headers() };
    expect(foreign instanceof Request).toBe(false);
    const res = await fetcher(foreign as unknown as Request);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ method: "GET", path: ["sessions"] });
    expect(received).toBe(foreign);
  });

  it("applies init to a Request of either class the way new Request(request, init) does", async () => {
    // A wrapper that forwards a Request while adding headers or a signal must
    // not lose it: a Request of another class taken for a string would read as
    // "/[object Request]" and answer 404, its headers and body gone.
    const seen: Array<{ path: string[] | undefined; token: string | null; body: string }> = [];
    const fetcher = createInProcessFetch({
      ...echoRouter,
      POST: async (req, ctx) => {
        seen.push({ path: ctx.params.path, token: req.headers.get("x-token"), body: await req.text() });
        return new Response(null, { status: 201 });
      }
    });
    const foreign = () => ({
      url: "http://x.invalid/api/flows/chat/actions/send",
      method: "POST",
      headers: new Headers({ "x-token": "from-request" }),
      body: new Response("payload").body,
      signal: new AbortController().signal
    });
    const real = () =>
      new Request("http://x.invalid/api/flows/chat/actions/send", {
        method: "POST",
        headers: { "x-token": "from-request" },
        body: "payload"
      });
    const override = { headers: { "x-token": "from-init" } };

    for (const make of [foreign, real]) {
      expect((await fetcher(make() as unknown as Request, {})).status).toBe(201);
      expect((await fetcher(make() as unknown as Request, override)).status).toBe(201);
    }
    const expected = [
      { path: ["chat", "actions", "send"], token: "from-request", body: "payload" },
      { path: ["chat", "actions", "send"], token: "from-init", body: "payload" }
    ];
    expect(seen).toEqual([...expected, ...expected]);
  });

  it("answers 405 for a method the router does not handle, HEAD included", async () => {
    const fetcher = createInProcessFetch(echoRouter);
    for (const method of ["PUT", "HEAD", "OPTIONS"]) {
      const res = await fetcher("http://x.invalid/api/flows/sessions", { method });
      expect(res.status).toBe(405);
    }
  });

  it("answers 404 for a path outside the base path, without calling the router", async () => {
    const fetcher = createInProcessFetch(echoRouter);
    const res = await fetcher("http://x.invalid/elsewhere/chat/sessions", { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
  });

  it("answers 500 when the flow state failed to initialize", async () => {
    const broken = {
      getRouter: () => Promise.reject(new Error("store unreachable")),
      getRuntime: () => Promise.reject(new Error("store unreachable")),
      ready: () => Promise.reject(new Error("store unreachable")),
      dispose: async () => {}
    } as unknown as FlowState;
    const fetcher = createInProcessFetch(broken);
    const res = await fetcher("http://x.invalid/api/flows/");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Server failed to initialize" });
  });

  it("runs a real action and reads its status back through the engine, no server", async () => {
    const state = flowState();
    const fetcher = createInProcessFetch(state);
    try {
      const sent = await fetcher("http://x.invalid/api/flows/echo/actions/say", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u1", input: { text: "hi" } })
      });
      expect(sent.status).toBeLessThan(300);
      const body = (await sent.json()) as { request?: { id: string }; requestId?: string };
      const requestId = body.request?.id ?? body.requestId;
      expect(requestId).toEqual(expect.any(String));

      const status = await fetcher(`http://x.invalid/api/flows/echo/requests/${requestId}/status`);
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ id: requestId });
    } finally {
      await state.dispose();
    }
  });
});
