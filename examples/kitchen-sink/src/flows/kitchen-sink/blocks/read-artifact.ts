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
// Reads a single artifact from the artifacts resource collection by key.
// Each artifact is its own resource instance — metadata in state, body in content.
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

    return {
      id: input.artifactId,
      title: ref.state.title,
      content: ref.state.content
    };
  }
});
