import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const throwingBlock = handler({
  name: "throwing-block",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.string(),
  execute: async () => {
    throw new Error("Intentional test error");
  },
});

export default throwingBlock;
