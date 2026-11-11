import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const echoHandler = handler({
  name: "echo-handler",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ text: z.string(), source: z.string() }),
  execute: async (input) => ({
    text: input.text,
    source: "echo-handler",
  }),
});

export default echoHandler;
