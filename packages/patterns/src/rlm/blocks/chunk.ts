import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { contextResourceStateSchema } from "../schemas";

export const chunkInputSchema = z.object({
  chunkIndex: z.number().describe("Zero-based chunk index"),
  chunkSize: z.number().default(4000).describe("Characters per chunk")
});

export const chunkOutputSchema = z.object({
  content: z.string(),
  chunkIndex: z.number(),
  totalChunks: z.number(),
  rangeStart: z.number(),
  rangeEnd: z.number()
});

// Tool block: reads a numbered chunk of the context.
// Enables the partition-and-map strategy: the LLM can iterate over chunks
// to process the entire context in manageable pieces.
export const chunk = handler({
  name: "chunk",
  description:
    "Get a specific chunk of the context by index. " +
    "Context is divided into equal-sized chunks. Use to systematically process large contexts.",
  inputSchema: chunkInputSchema,
  outputSchema: chunkOutputSchema,
  sessionResourceSchemas: z.object({ context: contextResourceStateSchema }),

  execute: async (input, ctx) => {
    const contextHandle = ctx.session.resources.get("context");
    const text = contextHandle?.state.text ?? "";
    const totalChunks = Math.max(1, Math.ceil(text.length / input.chunkSize));
    const start = input.chunkIndex * input.chunkSize;
    const end = Math.min(text.length, start + input.chunkSize);
    return {
      content: text.slice(start, end),
      chunkIndex: input.chunkIndex,
      totalChunks,
      rangeStart: start,
      rangeEnd: end
    };
  }
});
