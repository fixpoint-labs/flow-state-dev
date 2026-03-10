/**
 * Test fixture: a minimal flow with a single handler action.
 * Used by `fsdev run` integration tests.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const echoHandler = handler({
  name: "echo-handler",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ reply: z.string(), source: z.string() }),
  execute: async (input) => ({
    reply: `Echo: ${input.message}`,
    source: "echo-flow",
  }),
});

const echoFlow = defineFlow({
  kind: "echo",
  actions: {
    respond: {
      inputSchema: z.object({ message: z.string() }),
      block: echoHandler,
    },
  },
});

const flow = echoFlow({ id: "default" });

export default flow;
