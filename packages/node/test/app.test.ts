import { describe, expect, it } from "vitest";
import {
  createFlowState,
  inMemoryStores,
  type FlowApiRouter,
  type StoreAdapter,
} from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createServerApp } from "../src/app";

const noopFlow = defineFlow({
  kind: "noop-flow",
  actions: {
    ping: {
      inputSchema: z.object({}).passthrough(),
      block: handler({
        name: "ping",
        inputSchema: z.object({}).passthrough(),
        execute: () => undefined,
      }),
    },
  },
})();

/** A router that reflects what it received, for asserting the app's translation. */
const echoRouter: FlowApiRouter = {
  GET: async (_req, ctx) =>
    new Response(JSON.stringify({ method: "GET", path: ctx.params.path }), {
      status: 200,
      headers: { "content-type": "application/json", "x-custom": "1" },
    }),
  POST: async (req, ctx) =>
    new Response(
      JSON.stringify({ method: "POST", path: ctx.params.path, body: await req.text() }),
      { status: 201, headers: { "content-type": "application/json" } },
    ),
  PATCH: async () => new Response("patched", { status: 200 }),
  DELETE: async () => new Response(null, { status: 204 }),
};

/** An in-memory adapter whose store init is gated on a manual release. */
function gatedAdapter(): StoreAdapter & { release: () => void; disposed: () => number } {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const inner = inMemoryStores();
  let disposed = 0;
  return {
    capabilities: inner.capabilities,
    resolve: async (slots) => {
      await gate;
      return inner.resolve(slots);
    },
    dispose: () => {
      disposed += 1;
    },
    release,
    disposed: () => disposed,
  };
}

/** An in-memory adapter whose store init rejects — a permanent init failure. */
function failingAdapter(): StoreAdapter {
  const inner = inMemoryStores();
  return {
    capabilities: inner.capabilities,
    resolve: async () => {
      throw new Error("store init failed");
    },
    dispose: () => {},
  };
}

const url = (path: string) => `http://localhost${path}`;

describe("createServerApp — translation", () => {
  it("serves /healthz as 200 immediately for a raw router", async () => {
    const { app } = createServerApp(echoRouter);
    const res = await app.fetch(new Request(url("/healthz")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("derives path segments after basePath and passes status/headers through", async () => {
    const { app } = createServerApp(echoRouter);
    const res = await app.fetch(new Request(url("/api/flows/chat/actions/send?x=1")));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("x-custom")).toBe("1");
    expect(await res.json()).toEqual({
      method: "GET",
      path: ["chat", "actions", "send"],
    });
  });

  it("reaches the router at the bare basePath", async () => {
    const { app } = createServerApp(echoRouter);
    const res = await app.fetch(new Request(url("/api/flows")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ method: "GET", path: [] });
  });

  it("reads the body for POST and forwards it to the router", async () => {
    const payload = JSON.stringify({ hello: "world" });
    const { app } = createServerApp(echoRouter);
    const res = await app.fetch(
      new Request(url("/api/flows/chat/actions/send"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      method: "POST",
      path: ["chat", "actions", "send"],
      body: payload,
    });
  });

  it("replies 405 for a method the router does not handle", async () => {
    const { app } = createServerApp(echoRouter);
    const res = await app.fetch(new Request(url("/api/flows/chat"), { method: "PUT" }));
    expect(res.status).toBe(405);
  });

  it("replies 404 with a JSON body for an unmatched route", async () => {
    const { app } = createServerApp(echoRouter);
    const res = await app.fetch(new Request(url("/nope")));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("replies 500 when the router throws before headers are sent", async () => {
    const throwing: FlowApiRouter = {
      ...echoRouter,
      GET: async () => {
        throw new Error("boom");
      },
    };
    const { app } = createServerApp(throwing);
    const res = await app.fetch(new Request(url("/api/flows/chat")));
    // Hono's onError surfaces the throw as a 500.
    expect(res.status).toBe(500);
  });
});

describe("createServerApp — SSE streaming", () => {
  it("passes an SSE response through as a streaming body", async () => {
    const events = ["data: a\n\n", "data: b\n\n", "data: c\n\n"];
    const sseRouter: FlowApiRouter = {
      ...echoRouter,
      GET: async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const e of events) controller.enqueue(encoder.encode(e));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    };
    const { app } = createServerApp(sseRouter);
    const res = await app.fetch(new Request(url("/api/flows/chat/stream")));

    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // body is the streamed ReadableStream, not a buffered string
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(await res.text()).toBe(events.join(""));
  });
});

describe("createServerApp — FlowState readiness", () => {
  it("reports 503 while stores initialize, then 200 once ready", async () => {
    const adapter = gatedAdapter();
    const fs = createFlowState({
      flows: { noop: noopFlow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: adapter } },
    });
    const { app, dispose } = createServerApp(fs);

    const before = await app.fetch(new Request(url("/healthz")));
    expect(before.status).toBe(503);
    expect((await before.json()).status).toBe("initializing");

    // the API also rejects with 503 while initializing
    const apiBefore = await app.fetch(new Request(url("/api/flows/noop/ping")));
    expect(apiBefore.status).toBe(503);

    adapter.release();
    await new Promise((r) => setTimeout(r, 20));

    const after = await app.fetch(new Request(url("/healthz")));
    expect(after.status).toBe(200);
    expect((await after.json()).status).toBe("ok");

    await dispose();
  });

  it("returns 500 from /healthz and the API when init fails permanently", async () => {
    const fs = createFlowState({
      flows: { noop: noopFlow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: failingAdapter() } },
    });
    const { app, dispose } = createServerApp(fs);
    await new Promise((r) => setTimeout(r, 20));

    const health = await app.fetch(new Request(url("/healthz")));
    expect(health.status).toBe(500);
    expect((await health.json()).status).toBe("error");

    const api = await app.fetch(new Request(url("/api/flows/noop/ping")));
    expect(api.status).toBe(500);

    await dispose();
  });

  it("disposes the FlowState stores on dispose()", async () => {
    const adapter = gatedAdapter();
    adapter.release();
    const fs = createFlowState({
      flows: { noop: noopFlow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: adapter } },
    });
    const { dispose } = createServerApp(fs);
    await fs.ready();

    await dispose();
    expect(adapter.disposed()).toBe(1);
  });
});
