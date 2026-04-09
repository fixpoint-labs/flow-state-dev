/**
 * Artifact blocks — read, update, and summarize artifacts.
 *
 * Artifacts are session-scoped resources with metadata in state and document
 * body stored as resource content. These blocks are used as LLM-callable tools
 * (read/update) and as a background work block (summarize).
 */
import { handler, utility } from "@flow-state-dev/core";
import { z } from "zod";
import { artifactResources } from "../schemas";

// ---------------------------------------------------------------------------
// Read artifact
// ---------------------------------------------------------------------------

export const readArtifactInputSchema = z.object({
  artifactId: z.string()
});

export const readArtifactOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string()
});

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

// ---------------------------------------------------------------------------
// Update artifact
// ---------------------------------------------------------------------------

export const updateArtifactInputSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string()
});

export const updateArtifactOutputSchema = z.object({
  success: z.boolean(),
  id: z.string()
});

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

// ---------------------------------------------------------------------------
// Summarize artifacts (background work block)
// ---------------------------------------------------------------------------

const artifactSummarizer = utility.summarizer({
  name: "artifact-summarizer",
  model: "preset/fast",
  granularity: "brief",
});

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

      const result = await artifactSummarizer.run(content, ctx as any);
      await ref.patchState({ summary: result.summary });
    }

    return input;
  }
});
