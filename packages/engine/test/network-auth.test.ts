import { expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { createFlowApiRouter, disposeFlowApiRouter } from "../src/routes/createFlowApiRouter";
import { createFlowRegistry } from "../src/registry/flow-registry";
import { createInMemoryStores } from "../src/stores";
import { networkAuthenticationError } from "../src/routes/network-auth";
import { defaultBodyUserIdPrincipalResolver } from "../src/transports/auth/defaultBodyUserIdPrincipalResolver";

it("checks the live registry of a raw router and names only unauthenticated kinds", async () => {
  const registry = createFlowRegistry();
  registry.register(defineFlow({ kind: "secure", actions: {}, authentication: {
    resolvePrincipal: () => ({ userId: "owner", orgId: "org_test" }),
  } })());
  const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
  try {
    expect(await networkAuthenticationError(router, "bind 0.0.0.0")).toBeUndefined();
    registry.register(defineFlow({ kind: "open", actions: {} })());
    const message = await networkAuthenticationError(router, "bind 0.0.0.0");
    expect(message).toContain('flow "open" has no authentication configured');
    expect(message).not.toContain('"secure"');
  } finally {
    await disposeFlowApiRouter(router);
  }
});

it("counts the router's host-level resolver, as the routes do", async () => {
  const registry = createFlowRegistry();
  registry.register(defineFlow({ kind: "hosted", actions: {} })());
  const router = createFlowApiRouter({
    registry,
    stores: createInMemoryStores(),
    resolvePrincipal: () => ({ userId: "visitor", orgId: "org_test" }),
  });
  try {
    expect(await networkAuthenticationError(router, "serve in production")).toBeUndefined();
  } finally {
    await disposeFlowApiRouter(router);
  }
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
  try {
    expect(await networkAuthenticationError(router, "bind 0.0.0.0")).toContain('flow "pinned"');
  } finally {
    await disposeFlowApiRouter(router);
  }
});
