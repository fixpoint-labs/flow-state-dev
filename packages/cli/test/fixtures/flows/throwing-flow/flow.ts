/**
 * Test fixture: a flow whose action always throws, for error handling tests.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const throwingHandler = handler({
  name: "throwing-handler",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async () => {
    throw new Error("Intentional test error from flow");
  },
});

const throwingFlow = defineFlow({
  kind: "throwing",
  actions: {
    fail: {
      inputSchema: z.object({ message: z.string() }),
      block: throwingHandler,
    },
  },
});

const flow = throwingFlow({ id: "default" });

export default flow;
