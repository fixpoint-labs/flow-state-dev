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

  execute: async (input, ctx) => {
    // Resources are accessed via the scope handle's .resources map.
    // The resource name ("artifacts") must match what the flow defines.
    const artifactsHandle = ctx.session?.resources.get("artifacts");
    const artifacts = artifactResourceStateSchema.parse(artifactsHandle?.state ?? {});

    return {
      ...input,
      instructions:
        `Context: ${artifacts.order.length} artifacts in session. ` +
        `Mode: ${ctx.session?.state.mode ?? "chat"}.`
    };
  },

  // llmOutput controls what gets appended to conversation history for the LLM.
  // Here we surface the instructions (context summary), falling back to the
  // raw message if no instructions were generated.
  llmOutput: (output) => output.instructions ?? output.message
});
