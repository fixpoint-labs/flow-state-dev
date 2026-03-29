import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { artifactResources } from "../schemas";

export const updateArtifactInputSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string()
});

export const updateArtifactOutputSchema = z.object({
  success: z.boolean(),
  id: z.string()
});

// Tool block: LLM-callable artifact writer.
// Creates or updates an artifact in the collection. Each artifact is its own
// resource instance with title, content, and updatedAt in state.
export const updateArtifact = handler({
  name: "update-artifact",
  description: "Create or update an artifact in the session artifacts collection.",
  inputSchema: updateArtifactInputSchema,
  outputSchema: updateArtifactOutputSchema,
  sessionResources: artifactResources,

  execute: async (input, ctx) => {
    const artifacts = ctx.session.resources.artifacts;
    const state = { title: input.title, content: input.content, updatedAt: Date.now() };

    const existing = artifacts.getOptional(input.id);
    if (existing !== undefined) {
      await existing.patchState(state);
    } else {
      await artifacts.create(input.id, state);
    }

    return {
      success: true,
      id: input.id
    };
  }
});
