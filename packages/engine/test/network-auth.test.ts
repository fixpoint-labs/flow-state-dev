import { afterEach, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { createFlowApiRouter, disposeFlowApiRouter } from "../src/routes/createFlowApiRouter";
import { createFlowRegistry } from "../src/registry/flow-registry";
import { createInMemoryStores } from "../src/stores";
import { createNetworkAuthGuard, networkAuthenticationError } from "../src/routes/network-auth";
import { defaultBodyUserIdPrincipalResolver } from "../src/transports/auth/defaultBodyUserIdPrincipalResolver";
import type { FlowApiRouter } from "../src/routes/createFlowApiRouter";

const routers: FlowApiRouter[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map(router => disposeFlowApiRouter(router)));
  vi.restoreAllMocks();
});

function openRouter(): FlowApiRouter {
  const registry = createFlowRegistry();
  registry.register(defineFlow({ kind: "open", actions: {} })());
  const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
  routers.push(router);
  return router;
}

it("checks the live registry of a raw router and names only unauthenticated kinds", async () => {
  const registry = createFlowRegistry();
  registry.register(defineFlow({ kind: "secure", actions: {}, authentication: {
    resolvePrincipal: () => ({ userId: "owner", orgId: "org_test" }),
  } })());
  const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
  routers.push(router);
  expect(await networkAuthenticationError(router, "bind 0.0.0.0")).toBeUndefined();
  registry.register(defineFlow({ kind: "open", actions: {} })());
  const message = await networkAuthenticationError(router, "bind 0.0.0.0");
  expect(message).toContain('flow "open" has no authentication configured');
  expect(message).not.toContain('"secure"');
});

it("counts the router's host-level resolver, as the routes do", async () => {
  const registry = createFlowRegistry();
  registry.register(defineFlow({ kind: "hosted", actions: {} })());
  const router = createFlowApiRouter({
    registry,
    stores: createInMemoryStores(),
    resolvePrincipal: () => ({ userId: "visitor", orgId: "org_test" }),
  });
  routers.push(router);
  expect(await networkAuthenticationError(router, "serve")).toBeUndefined();
});

it("still refuses a flow that pins the default resolver over a host resolver", async () => {
  const registry = createFlowRegistry();
  registry.register(defineFlow({ kind: "pinned", actions: {}, authentication: {
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
  } })());
  const router = createFlowApiRouter({
    registry,
    stores: createInMemoryStores(),
    resolvePrincipal: () => ({ userId: "visitor", orgId: "org_test" }),
  });
  routers.push(router);
  expect(await networkAuthenticationError(router, "bind 0.0.0.0")).toContain('flow "pinned"');
});

it.each([undefined, "", "development", "production", "test"])(
  "refuses an unauthenticated router when NODE_ENV is %j",
  async (nodeEnv) => {
    const previous = process.env.NODE_ENV;
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const guard = createNetworkAuthGuard();
      const first = await guard(openRouter());
      const second = await guard(openRouter());
      for (const response of [first, second]) {
        expect(response?.status).toBe(500);
        expect(await response!.json()).toEqual({ error: "Internal server error" });
      }
      const diagnostics = log.mock.calls.filter(([message]) =>
        typeof message === "string" && message.includes('"open"'));
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.[0]).toContain("no authentication configured");
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  },
);

it("does not cache a pass, so a flow registered later is refused", async () => {
  const registry = createFlowRegistry();
  registry.register(defineFlow({ kind: "secure", actions: {}, authentication: {
    resolvePrincipal: () => ({ userId: "owner", orgId: "org_test" }),
  } })());
  const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
  routers.push(router);
  const guard = createNetworkAuthGuard();
  expect(await guard(router)).toBeUndefined();
  registry.register(defineFlow({ kind: "late", actions: {} })());
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const refused = await guard(router);
  expect(refused?.status).toBe(500);
  expect(await refused!.json()).toEqual({ error: "Internal server error" });
  expect(log.mock.calls[0]?.[0]).toContain('"late"');
});

it("serves when the operator opts out or every flow has a resolver", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await createNetworkAuthGuard(true)(openRouter())).toBeUndefined();
  const registry = createFlowRegistry();
  registry.register(defineFlow({ kind: "secure", actions: {}, authentication: {
    resolvePrincipal: () => ({ userId: "owner", orgId: "org_test" }),
  } })());
  const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
  routers.push(router);
  expect(await createNetworkAuthGuard()(router)).toBeUndefined();
  expect(log).not.toHaveBeenCalled();
});
