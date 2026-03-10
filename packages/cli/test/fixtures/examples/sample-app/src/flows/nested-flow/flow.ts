/**
 * Test fixture: a flow nested under examples/sample-app/src/flows/
 * to verify monorepo-style discovery.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const nestedHandler = handler({
  name: "nested-handler",
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async (input) => ({
    result: `nested: ${input.value}`,
  }),
});

const nestedFlow = defineFlow({
  kind: "nested",
  actions: {
    process: {
      inputSchema: z.object({ value: z.string() }),
      block: nestedHandler,
    },
  },
});

export default nestedFlow({ id: "default" });
