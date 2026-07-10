import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

// A project with exactly one flow and one action, for the auto-bind path.
const soloHandler = handler({
  name: "solo-handler",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ reply: z.string() }),
  execute: async (input) => ({ reply: `echo: ${input.message}` }),
});

const soloFlow = defineFlow({
  kind: "solo",
  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: soloHandler,
    },
  },
});

export default soloFlow({ id: "default" });
