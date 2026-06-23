/**
 * Artifact resource collection — the storage shape for session artifacts.
 *
 * Each artifact is a session-scoped resource instance keyed by its id (e.g.
 * `"artifacts/my-doc"`): metadata lives in state, the document body lives in
 * resource content. This is the base of the artifacts concern — the tools,
 * context formatter, and capability all build over it (one-way dependency).
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

// Per-instance state for an artifact resource. State tracks metadata only —
// the document body is stored as resource content via writeContent/readContent.
// The summary field is populated by a background .work() block after each update.
export const artifactStateSchema = z.object({
  title: z.string(),
  summary: z.string().default(""),
  extension: z.string().optional(),
  updatedAt: z.number()
});

// client.content declares that content is readable and updatable by clients.
// client.data exposes title, summary, and updatedAt metadata in the snapshot
// without eagerly loading document bodies.
export const artifactsCollection = defineResourceCollection({
  pattern: "artifacts/**",
  scope: "session",
  stateSchema: artifactStateSchema,
  // Expose artifact bodies to the generic content search tools
  // (grepResourceContent / searchResources), so the agent can find artifacts by
  // their content. Read/write still flow through bash (the mounted filesystem),
  // so llmWritable stays off.
  llmReadable: true,
  client: {
    content: { read: true, update: true },
    state: { read: true },
    data: (state) => ({
      title: state.title ?? "Untitled",
      summary: state.summary ?? "",
      updatedAt: state.updatedAt,
      extension: state.extension ?? null
    }),
  },
});

export const artifactResources = {
  artifacts: artifactsCollection,
};
