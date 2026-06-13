/**
 * Test fixture: a valid fsdev.config.ts that default-exports a FlowState with
 * one in-memory store profile and a single echo flow.
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/server";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const echoHandler = handler({
  name: "echo-handler",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ reply: z.string() }),
  execute: async (input) => ({ reply: `Echo: ${input.message}` }),
});

const echoFlow = defineFlow({
  kind: "echo",
  actions: {
    respond: {
      inputSchema: z.object({ message: z.string() }),
      block: echoHandler,
    },
  },
})({ id: "default" });

export default createFlowState({
  flows: { echo: echoFlow },
  stores: { default: { primary: inMemoryStores() } },
});
