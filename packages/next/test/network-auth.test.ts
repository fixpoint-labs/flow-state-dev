import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, defaultBodyUserIdPrincipalResolver } from "@flow-state-dev/engine";
import { createNextHandler } from "../src/createNextHandler";
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
describe("next network authentication", () => {
  async function requestFor(app: ReturnType<typeof makeApp>, allowUnauthenticated = false) {
    const handlers = createNextHandler(app, { allowUnauthenticated });
    return () => handlers.GET(new Request("http://localhost/api/flows"), { params: Promise.resolve({ path: [] }) });
  }
  it("refuses with a generic body", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await (await requestFor(makeApp()))();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(log.mock.calls.some(([message]) => typeof message === "string" && message.includes('"network-test"'))).toBe(true);
  });
  it("serves with an explicit opt-out or a real resolver", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await (await requestFor(makeApp(), true))()).status).toBe(200);
    expect((await (await requestFor(makeApp("custom")))()).status).toBe(200);
  });
});
