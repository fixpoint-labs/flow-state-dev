/**
 * Test fixture: a healthy flow that shares a discovery tree with
 * broken-flow, to verify discovery continues past import failures.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const goodHandler = handler({
  name: "good-handler",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ reply: z.string() }),
  execute: async (input) => ({
    reply: `good: ${input.message}`,
  }),
});

const goodFlow = defineFlow({
  kind: "good",
  actions: {
    respond: {
      inputSchema: z.object({ message: z.string() }),
      block: goodHandler,
    },
  },
});

export default goodFlow({ id: "default" });
