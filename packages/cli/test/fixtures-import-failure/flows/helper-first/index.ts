/**
 * Test fixture: the actual flow for the helper-first directory. Discovered
 * via candidate fallthrough after flow.ts imports cleanly but isn't a flow.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const helperFirstHandler = handler({
  name: "helper-first-handler",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ reply: z.string() }),
  execute: async (input) => ({
    reply: `helper-first: ${input.message}`,
  }),
});

const helperFirstFlow = defineFlow({
  kind: "helper-first",
  actions: {
    respond: {
      inputSchema: z.object({ message: z.string() }),
      block: helperFirstHandler,
    },
  },
});

export default helperFirstFlow({ id: "default" });
