/**
 * Test fixture: a config whose single flow has no `authentication.resolvePrincipal`,
 * so it runs on the framework default (unauthenticated) resolver. `fsdev serve`'s
 * bind guard should refuse a non-loopback host for this config.
 */
import { createFlowState, createInMemoryStores, type StoreAdapter, type StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const g = globalThis as unknown as { __fsdevServeDisposeCalls: number };
g.__fsdevServeDisposeCalls = 0;

function memStores(): StoreAdapter {
  let registry: StoreRegistry | undefined;
  return {
    capabilities: ["primary"],
    resolve() {
      registry ??= createInMemoryStores();
      return Promise.resolve(registry);
    },
    dispose() {
      g.__fsdevServeDisposeCalls++;
    },
  };
}

const openFlow = defineFlow({
  kind: "open",
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
  flows: { open: openFlow },
  modelResolver: createMockModelResolver({}),
  stores: { default: { primary: memStores() } },
});
