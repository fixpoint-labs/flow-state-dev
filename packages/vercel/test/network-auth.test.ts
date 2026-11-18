import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, defaultBodyUserIdPrincipalResolver } from "@flow-state-dev/engine";
import { createVercelNextHandler } from "../src/next";
import { createVercelHandler, createVercelBareHandler } from "../src/handler";
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
    const router = await app.getRouter();
    const handlers = raw ? createVercelBareHandler(router, { allowUnauthenticated }) : createVercelHandler(async () => router, { allowUnauthenticated });
    return () => handlers.GET(new Request("http://localhost/api/flows"), { params: Promise.resolve({ path: [] }) });
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
  it("forwards the production opt-out through the Next composition", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const app = makeApp();
    const request = () => new Request("http://localhost/api/flows");
    const ctx = { params: Promise.resolve({ path: [] }) };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await createVercelNextHandler(app).GET(request(), ctx)).status).toBe(500);
    expect((await createVercelNextHandler(app, { allowUnauthenticated: true }).GET(request(), ctx)).status).toBe(200);
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
