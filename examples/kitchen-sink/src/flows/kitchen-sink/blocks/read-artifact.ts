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
// When the generator declares `tools: [readArtifact, ...]`, the framework
// exposes this block's name, description, and inputSchema to the LLM as a
// callable function. The LLM invokes it by name, the framework runs execute(),
// and the result feeds back into the LLM's tool-call loop.
export const readArtifact = handler({
  name: "read-artifact",
  description: "Read an artifact by ID from the session artifacts resource.",
  inputSchema: readArtifactInputSchema,
  outputSchema: readArtifactOutputSchema,

  // Typed resource declaration: this block expects a session resource named
  // "artifacts". ctx.session.resources.artifacts gives typed access.
  sessionResources: artifactResources,

  execute: async (input, ctx) => {
    const artifactsHandle = ctx.session.resources.get("artifacts");
    const artifact = artifactsHandle?.state.byId[input.artifactId];

    if (artifact === undefined) {
      return {
        id: input.artifactId,
        title: "Not Found",
        content: ""
      };
    }

    return {
      id: artifact.id,
      title: artifact.title,
      content: artifact.content
    };
  }
});
