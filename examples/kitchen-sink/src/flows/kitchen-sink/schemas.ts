import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

// Shared domain schemas for the kitchen-sink flow.
// Centralizing schemas avoids duplication — blocks import only the slices they need.

export const modeSchema = z.enum(["chat", "create"]).default("chat");

export const featuresSchema = z.object({
  biasCheck: z.boolean().default(false),
  bashTool: z.boolean().default(true),
  search: z.boolean().default(true),
  fetch: z.boolean().default(true),
  crawl: z.boolean().default(false),
});

// Per-instance state for an artifact resource. State tracks metadata only —
// the document body is stored as resource content via writeContent/readContent.
// The summary field is populated by a background .work() block after each update.
export const artifactStateSchema = z.object({
  title: z.string(),
  summary: z.string().default(""),
  extension: z.string().optional(),
  updatedAt: z.number()
});

// Resource collection for artifacts. Each artifact is a separate resource
// instance keyed by its ID (e.g., "artifacts/my-doc"). Metadata lives in
// state, the document body lives in resource content.
//
// client.content declares that content is readable and updatable by clients.
// client.data exposes title, summary, and updatedAt metadata in the snapshot
// without eagerly loading document bodies.
export const artifactsCollection = defineResourceCollection({
  pattern: "artifacts/**",
  stateSchema: artifactStateSchema,
  client: {
    content: { read: true, update: true },
    data: (state) => ({
      title: state.title ?? "Untitled",
      summary: state.summary ?? "",
      updatedAt: state.updatedAt,
    }),
  },
});

export const artifactResources = {
  artifacts: artifactsCollection,
};
