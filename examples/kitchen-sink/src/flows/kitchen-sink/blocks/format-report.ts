import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { analysisOutputSchema } from "./analyze-input";
import { artifactResources, modeSchema } from "../schemas";

// Handler block: enriches analysis output with contextual information.
// Used conditionally in chatPipeline via .thenIf() — only runs when
// the analyzeInput block flags needsContext: true.
export const formatReport = handler({
  name: "format-report",
  inputSchema: analysisOutputSchema,
  outputSchema: analysisOutputSchema,
  sessionStateSchema: z.object({ mode: modeSchema.default("chat") }),
  sessionResources: artifactResources,

  execute: async (input, ctx) => {
    const artifacts = ctx.session.resources.artifacts;
    return {
      ...input,
      instructions:
        `Context: ${artifacts.count()} artifacts in session. ` +
        `Mode: ${ctx.session.state.mode ?? "chat"}.`
    };
  }
});
