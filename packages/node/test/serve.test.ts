import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFlowState,
  inMemoryStores,
  type FlowApiRouter,
  type InboundTransportAdapter,
  type StoreAdapter,
} from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { serve, type ServeHandle, type ServeOptions } from "../src/serve";
import { createPageHtmlTransform } from "../src/index";

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

/** An in-memory adapter whose store init rejects — simulating a permanent init failure. */
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
    // Non-API routes are delegated to the router (so dedicated adapter paths are
    // served); with no matching route and no staticDir, that surfaces as a 404.
    const router404: FlowApiRouter = {
      ...fakeRouter,
      GET: async () =>
        new Response(JSON.stringify({ error: "flow_not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    };
    const handle = await start(router404, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${handle.port}/anything`);
    expect(res.status).toBe(404);
  });

  it("does not register signal handlers when handleSignals is false", async () => {
    const sigtermBefore = process.listenerCount("SIGTERM");
    const sigintBefore = process.listenerCount("SIGINT");

    await start(fakeRouter, { port: 0, handleSignals: false });

    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
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

  it("returns 500 from /healthz when initialization fails permanently", async () => {
    const fs = createFlowState({
      flows: { noop: noopFlow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: failingAdapter() } },
    });
    const handle = await start(fs, { port: 0 });
    // let the rejected getRouter() settle so initError is recorded
    await new Promise((r) => setTimeout(r, 20));

    const res = await fetch(`http://127.0.0.1:${handle.port}/healthz`);
    // 500 (not 503) so a PaaS fails the deploy fast instead of retrying.
    expect(res.status).toBe(500);
    expect((await res.json()).status).toBe("error");
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

  it("leaves the FlowState to its owner when disposeOnClose is false", async () => {
    // Two servers over one runtime: the one that closes first must not take
    // the runtime away from the other.
    const adapter = gatedAdapter();
    adapter.release();
    const fs = createFlowState({
      flows: { noop: noopFlow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: adapter } },
    });
    const handle = await serve(fs, { port: 0, disposeOnClose: false });
    await fs.ready();

    await handle.close();
    expect(adapter.disposed()).toBe(0);
    await fs.dispose();
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

  it("serves a dedicated adapter GET route before the SPA fallback", async () => {
    // In `fsdev dev` the SPA `get("*")` matches GET before the not-found
    // fallback; a dedicated adapter GET route outside basePath must still win.
    const dir = await mkdtemp(join(tmpdir(), "fsd-node-static-"));
    await writeFile(join(dir, "index.html"), "<!doctype html><title>app</title>");

    const adapter: InboundTransportAdapter = {
      source: "test-dedicated",
      createBindings: () => ({
        routes: [
          {
            method: "GET",
            path: "/custom/:id",
            handler: (_req, ctx) =>
              Promise.resolve(
                new Response(JSON.stringify({ served: ctx.params.id }), {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }),
              ),
          },
        ],
      }),
    };
    const fs = createFlowState({
      flows: { noop: noopFlow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: inMemoryStores() } },
      adapters: [adapter],
    });
    const handle = await start(fs, { port: 0, staticDir: dir });
    await fs.ready();

    // The dedicated GET route is served, not the SPA HTML.
    const dedicated = await fetch(`http://127.0.0.1:${handle.port}/custom/abc`);
    expect(dedicated.status).toBe(200);
    expect(await dedicated.json()).toEqual({ served: "abc" });

    // A genuinely-unmatched client route still falls back to the SPA.
    const spa = await fetch(`http://127.0.0.1:${handle.port}/some/client/route`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain("<title>app</title>");
  });

  it("serves real static files without blocking while the FlowState initializes", async () => {
    // A real file is served from disk during a slow store cold start without
    // awaiting init — the gate is never released here, so a blocking impl would
    // hang and time this test out.
    const dir = await mkdtemp(join(tmpdir(), "fsd-node-static-"));
    await writeFile(join(dir, "index.html"), "<!doctype html><title>app</title>");
    await writeFile(join(dir, "app.js"), "console.log('hi')");
    const adapter = gatedAdapter();
    const fs = createFlowState({
      flows: { noop: noopFlow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: adapter } },
    });
    const handle = await start(fs, { port: 0, staticDir: dir });

    const asset = await fetch(`http://127.0.0.1:${handle.port}/app.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("console.log");

    adapter.release();
  });

  it("serves a dedicated GET route that arrives during cold start, not SPA HTML", async () => {
    // A non-file path is offered to the dedicated dispatch, which blocks on init:
    // a dedicated GET route (e.g. an OAuth callback) fired while the store is
    // still initializing is served once ready, not shadowed by the SPA index.
    const dir = await mkdtemp(join(tmpdir(), "fsd-node-static-"));
    await writeFile(join(dir, "index.html"), "<!doctype html><title>app</title>");
    const store = gatedAdapter();
    const adapter: InboundTransportAdapter = {
      source: "test-oauth",
      createBindings: () => ({
        routes: [
          {
            method: "GET",
            path: "/oauth/callback",
            handler: () =>
              Promise.resolve(
                new Response(JSON.stringify({ ok: true }), {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }),
              ),
          },
        ],
      }),
    };
    const fs = createFlowState({
      flows: { noop: noopFlow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: store } },
      adapters: [adapter],
    });
    const handle = await start(fs, { port: 0, staticDir: dir });

    const pending = fetch(`http://127.0.0.1:${handle.port}/oauth/callback`);
    store.release();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("serve() — devtoolConfig injection", () => {
  async function staticDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "fsd-node-devtool-"));
    await writeFile(join(dir, "index.html"), "<!doctype html><html><head></head><body></body></html>");
    return dir;
  }

  it("injects the config into loopback HTML and marks it no-store", async () => {
    const dir = await staticDir();
    const handle = await start(fakeRouter, {
      port: 0,
      host: "127.0.0.1",
      staticDir: dir,
      devtoolConfig: { userId: "owner", bearerToken: "s3cret" },
    });
    const res = await fetch(`http://127.0.0.1:${handle.port}/`);
    const html = await res.text();
    expect(html).toContain('window.__FSD_DEVTOOL_CONFIG__ = {"userId":"owner","bearerToken":"s3cret"}');
    // The token-bearing document must not be cached.
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does NOT inject on a non-loopback bind (token stays off the network)", async () => {
    const dir = await staticDir();
    const handle = await start(fakeRouter, {
      port: 0,
      host: "0.0.0.0",
      staticDir: dir,
      devtoolConfig: { userId: "owner", bearerToken: "s3cret" },
    });
    const res = await fetch(`http://127.0.0.1:${handle.port}/`);
    const html = await res.text();
    expect(html).not.toContain("__FSD_DEVTOOL_CONFIG__");
    expect(html).not.toContain("s3cret");
    expect(res.headers.get("cache-control")).not.toBe("no-store");
  });
});

describe("serve() — pageMeta", () => {
  async function staticDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "fsd-node-meta-"));
    await writeFile(join(dir, "index.html"), "<!doctype html><html><head></head><body></body></html>");
    await writeFile(join(dir, "about.html"), "<!doctype html><html><head></head><body>about</body></html>");
    await writeFile(join(dir, "app.js"), "console.log('</head>')");
    return dir;
  }

  it("writes the meta tags into the index, another HTML file, and the SPA fallback", async () => {
    const dir = await staticDir();
    const handle = await start(fakeRouter, {
      port: 0,
      host: "127.0.0.1",
      staticDir: dir,
      pageMeta: { "fsdev-devtool-url": "http://127.0.0.1:5555/" },
    });
    const tag = '<meta name="fsdev-devtool-url" content="http://127.0.0.1:5555/"></head>';
    for (const path of ["/", "/about.html", "/some/client/route"]) {
      const html = await (await fetch(`http://127.0.0.1:${handle.port}${path}`)).text();
      expect(html, path).toContain(tag);
    }
    // A non-HTML asset is served as it is on disk.
    const js = await (await fetch(`http://127.0.0.1:${handle.port}/app.js`)).text();
    expect(js).toBe("console.log('</head>')");
  });

  it("writes the meta tags on a non-loopback host too (they are not secrets)", async () => {
    const dir = await staticDir();
    const handle = await start(fakeRouter, {
      port: 0,
      host: "0.0.0.0",
      staticDir: dir,
      pageMeta: { "app-scheme": "dark" },
    });
    const html = await (await fetch(`http://127.0.0.1:${handle.port}/`)).text();
    expect(html).toContain('<meta name="app-scheme" content="dark">');
  });

  it("escapes a value so it cannot close the attribute or the tag", async () => {
    const dir = await staticDir();
    const handle = await start(fakeRouter, {
      port: 0,
      staticDir: dir,
      pageMeta: { "x": `a"><script>alert(1)</script>&` },
    });
    const html = await (await fetch(`http://127.0.0.1:${handle.port}/`)).text();
    expect(html).toContain('<meta name="x" content="a&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;">');
    expect(html).not.toContain("<script>alert(1)");
  });

  it("writes the meta tags beside the devtool config, in one pass", async () => {
    const dir = await staticDir();
    const handle = await start(fakeRouter, {
      port: 0,
      host: "127.0.0.1",
      staticDir: dir,
      devtoolConfig: { userId: "owner" },
      pageMeta: { "app-scheme": "dark" },
    });
    const html = await (await fetch(`http://127.0.0.1:${handle.port}/`)).text();
    expect(html).toContain(
      '<meta name="app-scheme" content="dark"><script>window.__FSD_DEVTOOL_CONFIG__ = {"userId":"owner"};</script></head>',
    );
  });

  it("leaves HTML byte-identical, with no cache-control, when neither option is set", async () => {
    const dir = await staticDir();
    const handle = await start(fakeRouter, { port: 0, staticDir: dir, pageMeta: {} });
    for (const path of ["/", "/about.html", "/some/client/route"]) {
      const res = await fetch(`http://127.0.0.1:${handle.port}${path}`);
      const onDisk = await readFile(join(dir, path === "/about.html" ? "about.html" : "index.html"), "utf8");
      expect(await res.text(), path).toBe(onDisk);
      expect(res.headers.get("cache-control"), path).toBeNull();
    }
  });
});

describe("serve() — pageHandler", () => {
  type Handler = NonNullable<ServeOptions["pageHandler"]>;

  async function staticDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "fsd-node-handler-"));
    await writeFile(join(dir, "index.html"), "<!doctype html><html><head></head><body>built</body></html>");
    await writeFile(join(dir, "app.js"), "built-asset");
    return dir;
  }

  /** A handler that answers `/src/*` itself, passes everything else on, and records every URL it saw. */
  function recordingHandler(): Handler & { seen: string[] } {
    const seen: string[] = [];
    const handler: Handler = (req, res, next) => {
      seen.push(`${req.method} ${req.url}`);
      if (req.url?.startsWith("/src/")) {
        res.writeHead(200, { "content-type": "application/javascript" });
        res.end(`from-handler ${req.url}`);
        return;
      }
      next();
    };
    return Object.assign(handler, { seen });
  }

  it("answers a non-file GET, and passes the rest on to the SPA fallback", async () => {
    const handler = recordingHandler();
    const handle = await start(fakeRouter, {
      port: 0,
      staticDir: await staticDir(),
      pageHandler: handler,
      pageMeta: { "app-scheme": "dark" },
    });
    const own = await fetch(`http://127.0.0.1:${handle.port}/src/main.tsx`);
    expect(own.status).toBe(200);
    expect(await own.text()).toBe("from-handler /src/main.tsx");

    const fallback = await (await fetch(`http://127.0.0.1:${handle.port}/some/client/route?x=1`)).text();
    expect(fallback).toContain("built");
    expect(fallback).toContain('<meta name="app-scheme" content="dark">');
    expect(handler.seen).toEqual(["GET /src/main.tsx", "GET /some/client/route?x=1"]);
  });

  it("never sees a real file, an API request, the health check, or a non-GET", async () => {
    const handler = recordingHandler();
    const handle = await start(fakeRouter, { port: 0, staticDir: await staticDir(), pageHandler: handler });
    const base = `http://127.0.0.1:${handle.port}`;
    expect(await (await fetch(`${base}/app.js`)).text()).toBe("built-asset");
    expect((await fetch(`${base}/api/flows/foo`)).status).toBe(200);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    await fetch(`${base}/src/x.ts`, { method: "POST" });
    expect(handler.seen).toEqual([]);
  });

  it("serves a dedicated GET route ahead of the handler, during cold start too", async () => {
    const handler = recordingHandler();
    const store = gatedAdapter();
    const adapter: InboundTransportAdapter = {
      source: "test-oauth",
      createBindings: () => ({
        routes: [
          {
            method: "GET",
            path: "/src/oauth/callback",
            handler: () => Promise.resolve(new Response("dedicated", { status: 200 })),
          },
        ],
      }),
    };
    const fs = createFlowState({
      flows: { noop: noopFlow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: store } },
      adapters: [adapter],
    });
    const handle = await start(fs, { port: 0, staticDir: await staticDir(), pageHandler: handler });

    const pending = fetch(`http://127.0.0.1:${handle.port}/src/oauth/callback`);
    store.release();
    const res = await pending;
    expect(await res.text()).toBe("dedicated");
    expect(handler.seen).toEqual([]);
  });

  it("works without a staticDir: what the handler passes on is a 404", async () => {
    const handler = recordingHandler();
    const handle = await start(fakeRouter, { port: 0, pageHandler: handler });
    expect(await (await fetch(`http://127.0.0.1:${handle.port}/src/a.ts`)).text()).toBe("from-handler /src/a.ts");
    expect((await fetch(`http://127.0.0.1:${handle.port}/elsewhere`)).status).toBe(404);
  });

  it("turns an error the handler passes on into a 500", async () => {
    const handle = await start(fakeRouter, {
      port: 0,
      staticDir: await staticDir(),
      pageHandler: (_req, _res, next) => next(new Error("boom")),
    });
    expect((await fetch(`http://127.0.0.1:${handle.port}/x`)).status).toBe(500);
  });

  it("can write its own index with the same transform serve() uses", async () => {
    const dir = await staticDir();
    const pageOptions = { host: "127.0.0.1", devtoolConfig: { userId: "owner" }, pageMeta: { "app-scheme": "dark" } };
    const transform = createPageHtmlTransform(pageOptions)!;
    const ownIndex = "<!doctype html><html><head></head><body>built</body></html>";
    const handle = await start(fakeRouter, {
      port: 0,
      ...pageOptions,
      staticDir: dir,
      pageHandler: (req, res, next) => {
        if (req.url !== "/own") return next();
        res.writeHead(200, { "content-type": "text/html" });
        res.end(transform(ownIndex));
      },
    });
    const own = await (await fetch(`http://127.0.0.1:${handle.port}/own`)).text();
    const served = await (await fetch(`http://127.0.0.1:${handle.port}/`)).text();
    expect(own).toBe(served);
    expect(own).toContain("__FSD_DEVTOOL_CONFIG__");
  });
});
