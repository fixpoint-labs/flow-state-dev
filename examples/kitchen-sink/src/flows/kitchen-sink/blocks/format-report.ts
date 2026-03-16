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
    // Resources are accessed via the scope handle's typed .resources map.
    // Because we declared sessionResourceSchemas above, .get("artifacts")
    // returns a typed ResourceHandle — no manual .parse() needed.
    const artifactsHandle = ctx.session.resources.artifacts;
    return {
      ...input,
      instructions:
        `Context: ${artifactsHandle?.state.order.length ?? 0} artifacts in session. ` +
        `Mode: ${ctx.session.state.mode ?? "chat"}.`
    };
  }
});
