/**
 * Test fixture: a config whose `devtool` block hands the page a user and a
 * bearer token. `fsdev dev` writes them into loopback pages only, and refuses a
 * non-loopback host for it.
 */
import { createFlowState, createInMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const pingFlow = defineFlow({
  kind: "ping",
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
  flows: { ping: pingFlow },
  modelResolver: createMockModelResolver({}),
  stores: { default: { primary: { capabilities: ["primary"], resolve: () => Promise.resolve(createInMemoryStores()) } } },
  devtool: { userId: "owner", bearerToken: "s3cret" },
});
