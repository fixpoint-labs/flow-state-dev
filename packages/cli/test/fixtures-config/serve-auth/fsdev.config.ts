/**
 * Test fixture: a config whose single flow sets `authentication.resolvePrincipal`,
 * so it is NOT on the framework default resolver. `fsdev serve`'s bind guard
 * should allow a non-loopback host for this config.
 */
import { createFlowState, createInMemoryStores, type StoreAdapter, type StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

function memStores(): StoreAdapter {
  let registry: StoreRegistry | undefined;
  return {
    capabilities: ["primary"],
    resolve() {
      registry ??= createInMemoryStores();
      return Promise.resolve(registry);
    },
  };
}

const secureFlow = defineFlow({
  kind: "secure",
  authentication: {
    resolvePrincipal: () => ({ userId: "owner" }),
  },
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

export default createFlowState({
  flows: { secure: secureFlow },
  modelResolver: createMockModelResolver({}),
  stores: { default: { primary: memStores() } },
});
