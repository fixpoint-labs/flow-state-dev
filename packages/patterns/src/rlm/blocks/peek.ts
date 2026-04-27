import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { contextResource } from "../schemas";

export const peekInputSchema = z.object({
  start: z.number().default(0).describe("Start character offset"),
  length: z.number().default(2000).describe("Number of characters to read")
});

export const peekOutputSchema = z.object({
  content: z.string(),
  totalLength: z.number(),
  rangeStart: z.number(),
  rangeEnd: z.number()
});

// Tool block: reads a slice of the context by character offset and length.
// The LLM uses this to understand the structure of the context before deciding
// how to decompose its query.
export const peek = handler({
  name: "peek",
  description:
    "Read a portion of the context by character offset and length. " +
    "Use to understand context structure — start with offset 0 to see the beginning.",
  inputSchema: peekInputSchema,
  outputSchema: peekOutputSchema,
  resources: { context: contextResource },

  execute: async (input, ctx) => {
    const text = ctx.resources.context?.state.text ?? "";
    const start = Math.max(0, input.start);
    const end = Math.min(text.length, start + input.length);
    return {
      content: text.slice(start, end),
      totalLength: text.length,
      rangeStart: start,
      rangeEnd: end
    };
  }
});
