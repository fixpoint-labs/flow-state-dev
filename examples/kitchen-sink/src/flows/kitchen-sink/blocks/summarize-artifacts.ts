import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { artifactResources } from "../schemas";

// Work block: runs in the background after the generator completes.
// Iterates all artifacts and generates a summary for any that don't have one
// yet (newly created or updated). Summaries are stored in state so they're
// available synchronously in clientData and context without reading content.
export const summarizeArtifacts = handler({
  name: "summarize-artifacts",
  inputSchema: z.string(),
  outputSchema: z.string(),
  sessionResources: artifactResources,

  execute: async (input, ctx) => {
    const artifacts = ctx.session.resources.artifacts;

    for (const ref of artifacts.list()) {
      if (ref.state.summary) continue;

      const content = await ref.readContent();
      if (!content) continue;

      const summary = content.length <= 120
        ? content
        : content.slice(0, 120).trimEnd() + "…";

      await ref.patchState({ summary });
    }

    return input;
  }
});
