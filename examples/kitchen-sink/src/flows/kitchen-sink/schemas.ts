import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

// Shared domain schemas for the kitchen-sink flow.
// Centralizing schemas avoids duplication — blocks import only the slices they need.

export const modeSchema = z.enum(["chat", "plan", "review"]);

// Per-instance state for an artifact resource. State tracks metadata only —
// the document body is stored as resource content via writeContent/readContent.
// The summary field is populated by a background .work() block after each update.
export const artifactStateSchema = z.object({
  title: z.string(),
  summary: z.string().default(""),
  updatedAt: z.number()
});

// Resource collection for artifacts. Each artifact is a separate resource
// instance keyed by its ID (e.g., "artifacts/my-doc"). Metadata lives in
// state, the document body lives in resource content.
export const artifactsCollection = defineResourceCollection({
  pattern: "artifacts/*",
  stateSchema: artifactStateSchema,
});

export const artifactResources = {
  artifacts: artifactsCollection,
};
