import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

// A flow with two actions, for the "ambiguous positional action" startup path
// (a bare `fsdev chat multi` can't pick between them).
const echo = (name: string) =>
  handler({
    name,
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.object({ reply: z.string() }),
    execute: async (input) => ({ reply: input.message }),
  });

const multiFlow = defineFlow({
  kind: "multi",
  actions: {
    draft: { inputSchema: z.object({ message: z.string() }), block: echo("multi-draft") },
    revise: { inputSchema: z.object({ message: z.string() }), block: echo("multi-revise") },
  },
});

export default multiFlow({ id: "default" });
