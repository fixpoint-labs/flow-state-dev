import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const echoBlock = handler({
  name: "echo-block",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ echo: z.string(), timestamp: z.number() }),
  execute: async (input) => ({
    echo: input.message,
    timestamp: Date.now(),
  }),
});

export default echoBlock;
