/**
 * Test fixture: the TS-first precedence winner when multiple config files are
 * present in the same directory (alongside fsdev.config.mjs).
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/server";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const echoFlow = defineFlow({
  kind: "echo",
  actions: {
    respond: {
      inputSchema: z.object({ message: z.string() }),
      block: handler({
        name: "echo-handler",
        inputSchema: z.object({ message: z.string() }),
        outputSchema: z.object({ reply: z.string() }),
        execute: async (input) => ({ reply: `Echo: ${input.message}` }),
      }),
    },
  },
})({ id: "default" });

export default createFlowState({
  flows: { echo: echoFlow },
  stores: { default: { primary: inMemoryStores() } },
});
