/**
 * Artifact blocks — read and write artifacts.
 *
 * Artifacts are session-scoped resources with metadata in state and document
 * body stored as resource content. These blocks are used as LLM-callable tools.
 *
 * writeArtifact: upserts the resource then immediately summarizes the new content,
 * so the summary is always current without a separate background sweep.
 */
import { handler, sequencer, utility } from "@flow-state-dev/core";
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
    const ref = ctx.session.resources.artifacts.getOptional(input.artifactId);

    if (ref === undefined) {
      return { id: input.artifactId, title: "Not Found", content: "" };
    }

    return {
      id: input.artifactId,
      title: ref.state.title,
      content: await ref.readContent() ?? ""
    };
  }
});

// ---------------------------------------------------------------------------
// Write artifact (sequencer — the LLM-callable tool)
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

const artifactSummarizer = utility.summarizer({
  name: "artifact-summarizer",
  model: "preset/fast",
  granularity: "brief",
});

const upsertArtifact = utility.upsertResource({
  name: "upsert-artifact",
  inputSchema: updateArtifactInputSchema,
  sessionResources: artifactResources,
  collectionKey: "artifacts",
  key: (input) => input.id,
  state: (input) => ({ title: input.title, updatedAt: Date.now() }),
  content: (input) => input.content,
});

const saveSummary = handler({
  name: "save-artifact-summary",
  inputSchema: utility.summarizerOutputSchema,
  outputSchema: updateArtifactOutputSchema,
  // TODO: we will refactor the need for this out of the framework. Ideally blocks should mainly rely on their input and use connectors to send necessary data into them
  parentInputSchema: updateArtifactInputSchema,
  sessionResources: artifactResources,
  execute: async (input, ctx) => {
    const { id } = ctx.parent!.input;
    const ref = ctx.session.resources.artifacts.getOptional(id);
    if (ref) await ref.patchState({ summary: input.summary });
    return { success: true, id };
  }
});

const summarizeArtifact = sequencer({
  name: "summarize-artifact",
  inputSchema: updateArtifactInputSchema,
})
  .then((input) => input.content, artifactSummarizer)
  .then(saveSummary);

export const writeArtifact = sequencer({
  name: "write-artifact",
  description: "Create or update an artifact in the session artifacts collection.",
  inputSchema: updateArtifactInputSchema,
})
  .tap(upsertArtifact)
  .work(summarizeArtifact);

// Keep updateArtifact as an alias so flow.ts and saveArtifact action don't break.
export const updateArtifact = writeArtifact;
