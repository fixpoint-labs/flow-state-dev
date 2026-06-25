/**
 * Artifact tool blocks + the `saveArtifact` action.
 *
 * `readArtifact` reads one artifact; `writeArtifact` (aliased `updateArtifact`
 * for the flow action) upserts the document's metadata and body. The summary is
 * regenerated separately by the collection's `reactTo.contentUpdated` reaction
 * (see ./resource), so the write tool is just the upsert. Both are
 * generator-callable tools the `artifactsCapability` exposes; `writeArtifact` is
 * also wired directly as the `saveArtifact` flow action. Depends only on the
 * resource module.
 */
import { handler, utility } from "@flow-state-dev/core";
import path from "node:path";
import { z } from "zod";
import { artifactResources } from "./resource";

// ---------------------------------------------------------------------------
// Read artifact
// ---------------------------------------------------------------------------

export const readArtifactInputSchema = z.object({
  artifactId: z.string()
});

export const readArtifactOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.number(),
  extension: z.string().optional(),
  summary: z.string().optional(),
  content: z.string()
});

export const readArtifact = handler({
  name: "read-artifact",
  description: "Read an artifact by ID from the session artifacts collection.",
  inputSchema: readArtifactInputSchema,
  outputSchema: readArtifactOutputSchema,
  resources: artifactResources,
  // FIX-610: artifact content is deterministic per (artifactId,
  // updatedAt). A short TTL means repeated reads inside one plan
  // iteration are served from cache without staling fresh writes
  // across turns. The default board-run scope clears the cache when
  // the surrounding Task Board exits.
  cacheable: { ttl: 60_000 },

  execute: async (input, ctx) => {
    const ref = await ctx.resources.artifacts.getOptional(input.artifactId);
    if (ref === undefined) {
      return { id: input.artifactId, title: "Not Found", updatedAt: 0, summary: "", content: "" };
    }

    return {
      id: input.artifactId,
      title: ref.state.title,
      updatedAt: ref.state.updatedAt,
      extension: ref.state.extension,
      summary: ref.state.summary ?? "",
      content: await ref.readContent() ?? ""
    };
  }
});

// ---------------------------------------------------------------------------
// Write artifact (the LLM-callable tool + the saveArtifact action)
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

// Upserts the artifact's metadata + body. The body write fires
// reactTo.contentUpdated (see ./resource), which regenerates the summary — so
// the write tool itself is just the upsert, with no summarization wiring.
export const writeArtifact = utility.upsertResource({
  name: "write-artifact",
  description: "Create or update an artifact in the session artifacts collection.",
  inputSchema: updateArtifactInputSchema,
  resources: artifactResources,
  collectionKey: "artifacts",
  key: (input) => input.id,
  state: (input) => {
    // Derive the extension from the title rather than the storage id so
    // user renames (e.g. `.txt` → `.md`) update the metadata that drives
    // the viewer's renderer pick.
    const ext =
      path.extname(input.title).slice(1) || path.extname(input.id).slice(1);
    return {
      title: input.title,
      ...(ext ? { extension: ext } : {}),
      updatedAt: Date.now(),
    };
  },
  content: (input) => input.content,
});

// `updateArtifact` is the name `flow.ts` wires as the `saveArtifact` action.
export const updateArtifact = writeArtifact;
