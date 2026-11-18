import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, defaultBodyUserIdPrincipalResolver, type StoreAdapter } from "@flow-state-dev/engine";
import { EventEmitter } from "node:events";
import { serve as listen } from "@hono/node-server";
import { serve } from "../src/serve";
import { createLambdaHandler } from "../src/aws-lambda";
import type { Hono } from "hono";
const captured = vi.hoisted(() => ({ app: undefined as Hono | undefined }));
vi.mock("hono/aws-lambda", () => ({ streamHandle: (app: Hono) => { captured.app = app; return () => {}; } }));
vi.mock("@hono/node-server", () => ({
  serve: vi.fn((_options, ready) => {
    const server = Object.assign(new EventEmitter(), {
      close: (done: () => void) => { queueMicrotask(done); },
      closeAllConnections: () => {},
    });
    queueMicrotask(() => ready({ port: 43210 }));
    return server;
  }),
}));
const apps: ReturnType<typeof createFlowState>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.dispose()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
function makeApp(auth: "missing" | "default" | "custom" = "missing") {
  const app = createFlowState({
    flows: [defineFlow({ kind: "network-test", actions: {},
      ...(auth === "missing" ? {} : { authentication: { resolvePrincipal: auth === "default" ? defaultBodyUserIdPrincipalResolver : () => ({ userId: "owner", orgId: "org_test" }) } })
    })()],
    stores: { default: { primary: inMemoryStores() } }
  });
  apps.push(app);
  return app;
}
describe("lambda network authentication", () => {
  async function requestFor(app: ReturnType<typeof makeApp>, allowUnauthenticated = false, raw = false) {
    createLambdaHandler(raw ? await app.getRouter() : app, { allowUnauthenticated });
    return () => captured.app!.request("http://localhost/api/flows");
  }
  it.each([false, true])("refuses with a generic body when NODE_ENV is unset (raw=%s)", async raw => {
    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const request = await requestFor(makeApp(), false, raw);
      const response = await request();
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Internal server error" });
      expect(log.mock.calls.some(([message]) =>
        typeof message === "string" && message.includes('"network-test"'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
  it("serves with an explicit opt-out or a real resolver", async () => {
    expect((await (await requestFor(makeApp(), true))()).status).toBe(200);
    expect((await (await requestFor(makeApp("custom")))()).status).toBe(200);
  });
  it("reports store init failure as the app's health JSON", async () => {
    const inner = inMemoryStores();
    const failing: StoreAdapter = {
      capabilities: inner.capabilities,
      resolve: async () => { throw new Error("store init failed"); },
      dispose: () => {},
    };
    const app = createFlowState({
      flows: [defineFlow({ kind: "network-test", actions: {} })()],
      stores: { default: { primary: failing } },
    });
    apps.push(app);
    createLambdaHandler(app);
    await app.getRouter().catch(() => {});
    const response = await captured.app!.request("http://localhost/healthz");
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json() as { status?: string; message?: string; error?: string };
    expect(body.status).toBe("error");
    expect(body.message).toContain("store init failed");
    expect(body.error).toBeUndefined();
  });
});

describe("serve authentication", () => {
  it.each([undefined, "0.0.0.0"])("rejects a network bind before listening (%s)", async host => {
    const app = makeApp();
    vi.mocked(listen).mockClear();
    // Close even on the unfixed implementation so the regression leaves no listener.
    const result = serve(app, { host, port: 0, handleSignals: false });
    void result.then(handle => handle.close(), () => {});
    await expect(result).rejects.toThrow(/Refusing to bind 0\.0\.0\.0.*"network-test"/);
    expect(listen).not.toHaveBeenCalled();
  });
  it("rejects a raw framework router on a network bind", async () => {
    const router = await makeApp().getRouter();
    await expect(serve(router, { host: "0.0.0.0", port: 0 })).rejects.toThrow('"network-test"');
  });
  it("refuses a flow registered after the network bind", async () => {
    const app = makeApp("custom");
    const handle = await serve(app, { host: "0.0.0.0", port: 0, handleSignals: false });
    try {
      app.register(defineFlow({ kind: "late", actions: {} })());
      const options = vi.mocked(listen).mock.calls.at(-1)![0];
      const response = await options.fetch(new Request("http://localhost/api/flows"), {} as Parameters<typeof options.fetch>[1]);
      expect((response as Response).status).toBe(500);
      expect(await (response as Response).json()).toEqual({ error: "Internal server error" });
    } finally {
      await handle.close();
    }
  });
  it("serves an authenticated app on a network bind", async () => {
    const handle = await serve(makeApp("custom"), { host: "0.0.0.0", port: 0, handleSignals: false });
    await handle.close();
  });
  it.each([
    { host: "127.0.0.1" },
    { host: "0.0.0.0", allowUnauthenticated: true },
  ])("serves with %j", async options => {
    const handle = await serve(makeApp(), { ...options, port: 0, handleSignals: false });
    try {
      const options = vi.mocked(listen).mock.calls.at(-1)![0];
      // A loopback bind refuses a request whose Host header is not loopback.
      // The Fetch API hides that header unless it is set explicitly.
      const response = await options.fetch(
        new Request("http://127.0.0.1/api/flows", { headers: { host: "127.0.0.1" } }),
        {} as Parameters<typeof options.fetch>[1],
      );
      expect((response as Response).status).toBe(200);
    }
    finally { await handle.close(); }
  });
});
