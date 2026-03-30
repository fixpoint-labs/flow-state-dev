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
// Creates or updates an artifact in the collection. Metadata (title, updatedAt)
// lives in state; the document body is stored as resource content.
export const updateArtifact = handler({
  name: "update-artifact",
  description: "Create or update an artifact in the session artifacts collection.",
  inputSchema: updateArtifactInputSchema,
  outputSchema: updateArtifactOutputSchema,
  sessionResources: artifactResources,

  execute: async (input, ctx) => {
    const artifacts = ctx.session.resources.artifacts;

    const existing = artifacts.getOptional(input.id);
    if (existing !== undefined) {
      await existing.patchState({ title: input.title, updatedAt: Date.now() });
      await existing.writeContent(input.content);
    } else {
      const ref = await artifacts.create(input.id, {
        title: input.title,
        summary: "",
        updatedAt: Date.now()
      });
      await ref.writeContent(input.content);
    }

    return {
      success: true,
      id: input.id
    };
  }
});
