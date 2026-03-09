import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { contextResourceStateSchema } from "../schemas";

export const grepInputSchema = z.object({
  pattern: z.string().describe("Regex pattern to search for"),
  maxMatches: z.number().default(10).describe("Maximum matches to return"),
  surroundingChars: z.number().default(100).describe("Characters of context around each match")
});

const matchSchema = z.object({
  match: z.string(),
  index: z.number(),
  surrounding: z.string()
});

export const grepOutputSchema = z.object({
  matches: z.array(matchSchema),
  totalMatches: z.number(),
  contextLength: z.number()
});

// Tool block: regex search over the context document.
// Returns matches with surrounding text so the LLM can locate relevant sections
// without reading the entire context.
export const grep = handler({
  name: "grep",
  description:
    "Search the context for a regex pattern. " +
    "Returns matches with surrounding text for locating relevant sections.",
  inputSchema: grepInputSchema,
  outputSchema: grepOutputSchema,
  sessionResourceSchemas: z.object({ context: contextResourceStateSchema }),

  execute: async (input, ctx) => {
    const contextHandle = ctx.session.resources.get("context");
    const text = contextHandle?.state.text ?? "";

    let regex: RegExp;
    try {
      regex = new RegExp(input.pattern, "gi");
    } catch {
      return { matches: [], totalMatches: 0, contextLength: text.length };
    }

    const matches: z.infer<typeof matchSchema>[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null && matches.length < input.maxMatches) {
      const start = Math.max(0, match.index - input.surroundingChars);
      const end = Math.min(text.length, match.index + match[0].length + input.surroundingChars);
      matches.push({
        match: match[0],
        index: match.index,
        surrounding: text.slice(start, end)
      });
    }

    return { matches, totalMatches: matches.length, contextLength: text.length };
  }
});
