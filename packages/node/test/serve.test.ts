import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFlowState,
  inMemoryStores,
  type FlowApiRouter,
  type StoreAdapter,
} from "@flow-state-dev/server";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { serve, type ServeHandle } from "../src/serve";

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

/** A raw FlowApiRouter for exercising serve()'s routing/health/SSE wiring. */
const fakeRouter: FlowApiRouter = {
  GET: async (_req, ctx) => {
    const [first] = ctx.params.path;
    if (first === "stream") {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("data: one\n\n"));
          controller.enqueue(encoder.encode("data: two\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    return new Response(JSON.stringify({ path: ctx.params.path }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
  POST: async () => new Response(null, { status: 202 }),
  PATCH: async () => new Response(null, { status: 200 }),
  DELETE: async () => new Response(null, { status: 204 }),
};

/** An in-memory adapter whose store init is gated on a manual release, and which counts dispose(). */
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

const handles: ServeHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) {
    await handles.pop()!.close();
  }
});

async function start(...args: Parameters<typeof serve>): Promise<ServeHandle> {
  const handle = await serve(...args);
  handles.push(handle);
  return handle;
}

describe("serve — raw FlowApiRouter", () => {
  it("binds a port and serves /healthz as 200 immediately", async () => {
    const handle = await start(fakeRouter, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${handle.port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("routes API requests through the bridge", async () => {
    const handle = await start(fakeRouter, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/flows/foo/bar`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: ["foo", "bar"] });
  });

  it("streams SSE responses", async () => {
    const handle = await start(fakeRouter, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/flows/stream`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toBe("data: one\n\ndata: two\n\n");
  });

  it("returns 404 for non-API routes when no staticDir is set", async () => {
    const handle = await start(fakeRouter, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${handle.port}/anything`);
    expect(res.status).toBe(404);
  });

  it("rejects and leaks no signal handlers when the bind fails", async () => {
    // Take a port, then try to bind it again — the second listen fails.
    const handle = await start(fakeRouter, { port: 0 });
    const sigtermBefore = process.listenerCount("SIGTERM");
    const sigintBefore = process.listenerCount("SIGINT");

    await expect(serve(fakeRouter, { port: handle.port })).rejects.toBeDefined();

    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
  });
});

describe("serve — FlowState lifecycle", () => {
  it("reports 503 while stores initialize, then 200 once ready", async () => {
    const adapter = gatedAdapter();
    const fs = createFlowState({
      flows: { noop: noopFlow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: adapter } },
    });
    const handle = await start(fs, { port: 0 });

    const before = await fetch(`http://127.0.0.1:${handle.port}/healthz`);
    expect(before.status).toBe(503);
    expect((await before.json()).status).toBe("initializing");

    adapter.release();
    // allow getRouter()'s promise chain to settle
    await new Promise((r) => setTimeout(r, 20));

    const after = await fetch(`http://127.0.0.1:${handle.port}/healthz`);
    expect(after.status).toBe(200);
    expect((await after.json()).status).toBe("ok");
  });

  it("disposes the FlowState stores on close()", async () => {
    const adapter = gatedAdapter();
    adapter.release();
    const fs = createFlowState({
      flows: { noop: noopFlow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: adapter } },
    });
    const handle = await serve(fs, { port: 0 });
    await fs.ready();

    await handle.close();
    expect(adapter.disposed()).toBe(1);
  });
});

describe("serve — static assets", () => {
  it("serves a static directory with SPA fallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fsd-node-static-"));
    await writeFile(join(dir, "index.html"), "<!doctype html><title>app</title>");

    const handle = await start(fakeRouter, { port: 0, staticDir: dir });

    const root = await fetch(`http://127.0.0.1:${handle.port}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain("<title>app</title>");

    // unmatched client route falls back to index.html
    const spa = await fetch(`http://127.0.0.1:${handle.port}/some/client/route`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain("<title>app</title>");
  });
});
