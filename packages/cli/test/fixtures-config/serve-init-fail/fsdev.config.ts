/**
 * Test fixture: a config that passes the loopback bind guard (loopback host)
 * but whose store init rejects, so `FlowState.ready()` — the async router
 * construction createServerApp kicks off — fails AFTER the socket binds.
 * `fsdev serve` must surface that as EXIT_CONFIG_ERROR, not announce success.
 */
import { createFlowState, type StoreAdapter } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

function failingStores(): StoreAdapter {
  return {
    capabilities: ["primary"],
    resolve() {
      return Promise.reject(new Error("store boom"));
    },
    dispose() {},
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
  stores: { default: { primary: failingStores() } },
});
