import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { analysisOutputSchema } from "./analyze-input";
import { artifactResourceStateSchema, modeSchema } from "../schemas";

// Handler block: enriches analysis output with contextual information.
// Used conditionally in chatPipeline via .thenIf() — only runs when
// the analyzeInput block flags needsContext: true.
export const formatReport = handler({
  name: "format-report",
  inputSchema: analysisOutputSchema,
  outputSchema: analysisOutputSchema,
  sessionStateSchema: z.object({ mode: modeSchema.default("chat") }),
  sessionResourceSchemas: z.object({ artifacts: artifactResourceStateSchema }),

  execute: async (input, ctx) => {
    // Resources are accessed via the scope handle's typed .resources map.
    // Because we declared sessionResourceSchemas above, .get("artifacts")
    // returns a typed ResourceHandle — no manual .parse() needed.
    const artifactsHandle = ctx.session?.resources.get("artifacts");

    return {
      ...input,
      instructions:
        `Context: ${artifactsHandle?.state.order.length ?? 0} artifacts in session. ` +
        `Mode: ${ctx.session?.state.mode ?? "chat"}.`
    };
  },

  // llmOutput controls what gets appended to conversation history for the LLM.
  // Here we surface the instructions (context summary), falling back to the
  // raw message if no instructions were generated.
  llmOutput: (output) => output.instructions ?? output.message
});
