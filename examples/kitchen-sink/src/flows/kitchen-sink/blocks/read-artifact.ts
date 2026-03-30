import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { artifactResources } from "../schemas";

export const readArtifactInputSchema = z.object({
  artifactId: z.string()
});

export const readArtifactOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string()
});

// Tool block: used by the generator as an LLM-callable tool.
// Reads a single artifact from the collection. Metadata comes from state,
// document body comes from resource content via readContent().
export const readArtifact = handler({
  name: "read-artifact",
  description: "Read an artifact by ID from the session artifacts collection.",
  inputSchema: readArtifactInputSchema,
  outputSchema: readArtifactOutputSchema,
  sessionResources: artifactResources,

  execute: async (input, ctx) => {
    const artifacts = ctx.session.resources.artifacts;
    const ref = artifacts.getOptional(input.artifactId);

    if (ref === undefined) {
      return {
        id: input.artifactId,
        title: "Not Found",
        content: ""
      };
    }

    const content = await ref.readContent() ?? "";

    return {
      id: input.artifactId,
      title: ref.state.title,
      content
    };
  }
});
