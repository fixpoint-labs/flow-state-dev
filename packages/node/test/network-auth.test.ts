import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, defaultBodyUserIdPrincipalResolver } from "@flow-state-dev/engine";
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
describe("production network authentication", () => {
  async function requestFor(app: ReturnType<typeof makeApp>, allowUnauthenticated = false, raw = false) {
    createLambdaHandler(raw ? await app.getRouter() : app, { allowUnauthenticated });
    return () => captured.app!.request("http://localhost/api/flows");
  }
  it.each([false, true])("refuses missing and explicit default resolvers, logging once (raw/bare=%s)", async raw => {
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const auth of ["missing", "default"] as const) {
      log.mockClear();
      const request = await requestFor(makeApp(auth), false, raw);
      const responses = await Promise.all([request(), request()]);
      for (const response of responses) {
        expect(response.status).toBe(500);
        expect((await response.json()).error).toContain('"network-test"');
      }
      const diagnostics = log.mock.calls.filter(([message]) =>
        typeof message === "string" && message.startsWith("Refusing to serve"));
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.[0]).toContain("no authentication configured");
    }
  });
  it.each(["development", "production"])("serves with explicit opt-out in %s", async env => {
    vi.stubEnv("NODE_ENV", env);
    const request = await requestFor(makeApp(), true);
    expect((await request()).status).toBe(200);
  });
  it("serves in development without opt-out", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await (await requestFor(makeApp()))()).status).toBe(200);
  });
  it("serves authenticated flows in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await (await requestFor(makeApp("custom")))()).status).toBe(200);
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
      const response = await options.fetch(new Request("http://localhost/api/flows"), {} as Parameters<typeof options.fetch>[1]);
      expect((response as Response).status).toBe(200);
    }
    finally { await handle.close(); }
  });
});
