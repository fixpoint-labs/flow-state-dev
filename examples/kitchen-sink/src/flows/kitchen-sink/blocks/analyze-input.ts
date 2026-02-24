import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { modeSchema } from "../schemas";

export const analysisInputSchema = z.object({
  message: z.string().min(1),
  mode: modeSchema.default("chat")
});

export const analysisOutputSchema = z.object({
  message: z.string(),
  mode: modeSchema,
  needsContext: z.boolean(),
  instructions: z.string().optional()
});

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

// Handler block: synchronous input analysis.
// Demonstrates partial state schema — this block only declares the session state
// fields it reads ({ mode }), not the full flow-level schema. This keeps blocks
// decoupled from the flow and from each other.
export const analyzeInput = handler({
  name: "analyze-input",
  inputSchema: analysisInputSchema,
  outputSchema: analysisOutputSchema,

  // Partial state schema: only the slice this block depends on.
  // The flow's full sessionStateSchema also has requestCount and lastAction,
  // but this block doesn't need them — so it doesn't declare them.
  sessionStateSchema: z.object({ mode: modeSchema.default("chat") }),

  execute: async (input, ctx) => {
    // ctx.session.state.mode is typed as "chat" | "plan" | "review" — no
    // runtime parsing needed because the sessionStateSchema above provides
    // compile-time type information to BlockContext.
    const mode = ctx.session.state.mode ?? input.mode;

    return {
      message: input.message,
      mode,
      needsContext: input.message.length > 80
    };
  },

});
