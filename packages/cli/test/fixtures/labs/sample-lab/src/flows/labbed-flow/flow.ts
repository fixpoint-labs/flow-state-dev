/**
 * Test fixture: a flow nested under labs/sample-lab/src/flows/
 * to verify that labs/ participates in monorepo-style discovery.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const labbedHandler = handler({
  name: "labbed-handler",
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async (input) => ({
    result: `labbed: ${input.value}`,
  }),
});

const labbedFlow = defineFlow({
  kind: "labbed",
  actions: {
    process: {
      inputSchema: z.object({ value: z.string() }),
      block: labbedHandler,
    },
  },
});

export default labbedFlow({ id: "default" });
