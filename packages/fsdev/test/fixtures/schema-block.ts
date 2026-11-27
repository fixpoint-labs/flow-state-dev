import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const schemaBlock = handler({
  name: "schema-block",
  inputSchema: z.object({
    name: z.string().min(1),
    age: z.number().int().positive(),
  }),
  outputSchema: z.object({
    greeting: z.string(),
  }),
  execute: async (input) => ({
    greeting: `Hello, ${input.name}! You are ${input.age} years old.`,
  }),
});

export default schemaBlock;
