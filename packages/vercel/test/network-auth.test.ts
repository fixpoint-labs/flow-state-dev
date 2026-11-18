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
describe("vercel network authentication", () => {
  async function requestFor(app: ReturnType<typeof makeApp>, allowUnauthenticated = false, raw = false) {
    const router = await app.getRouter();
    const handlers = raw ? createVercelBareHandler(router, { allowUnauthenticated }) : createVercelHandler(async () => router, { allowUnauthenticated });
    return () => handlers.GET(new Request("http://localhost/api/flows"), { params: Promise.resolve({ path: [] }) });
  }
  it.each([false, true])("refuses with a generic body (bare=%s)", async raw => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await (await requestFor(makeApp(), false, raw))();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(log.mock.calls.some(([message]) => typeof message === "string" && message.includes('"network-test"'))).toBe(true);
  });
  it("forwards the opt-out through the Next composition", async () => {
    const app = makeApp();
    const request = () => new Request("http://localhost/api/flows");
    const ctx = { params: Promise.resolve({ path: [] }) };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await createVercelNextHandler(app).GET(request(), ctx)).status).toBe(500);
    expect((await createVercelNextHandler(app, { allowUnauthenticated: true }).GET(request(), ctx)).status).toBe(200);
  });
  it("serves a flow with its own resolver", async () => {
    expect((await (await requestFor(makeApp("custom")))()).status).toBe(200);
  });
});
