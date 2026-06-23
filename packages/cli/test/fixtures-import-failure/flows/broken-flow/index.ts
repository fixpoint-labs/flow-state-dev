/**
 * Test fixture: a valid flow that must NOT be discovered. It sits behind
 * broken-flow/flow.ts in the candidate order (flow.ts → index.ts); a failed
 * import of flow.ts stops candidate fallthrough, so this flow's appearance
 * in discovery would mean the break-on-failure semantics regressed.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const fallbackHandler = handler({
  name: "fallback-handler",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ reply: z.string() }),
  execute: async (input) => ({
    reply: `fallback: ${input.message}`,
  }),
});

const fallbackFlow = defineFlow({
  kind: "broken-fallback",
  actions: {
    respond: {
      inputSchema: z.object({ message: z.string() }),
      block: fallbackHandler,
    },
  },
});

export default fallbackFlow({ id: "default" });
