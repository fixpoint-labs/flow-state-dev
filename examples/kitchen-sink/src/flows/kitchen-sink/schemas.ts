import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

// Shared domain schemas for the kitchen-sink flow.
// Centralizing schemas avoids duplication — blocks import only the slices they need.

export const modeSchema = z.enum(["chat", "plan", "review"]);

// Per-instance state for an artifact resource. Each artifact is its own resource
// instance in the collection — the artifact ID is the collection key, metadata
// lives in state, and the actual content body is stored as resource content.
export const artifactStateSchema = z.object({
  title: z.string(),
  content: z.string(),
  updatedAt: z.number()
});

// Resource collection for artifacts. Each artifact is a separate resource
// instance keyed by its ID (e.g., "artifacts/my-doc"). All artifact data
// (title, content, updatedAt) lives in per-instance state.
export const artifactsCollection = defineResourceCollection({
  pattern: "artifacts/*",
  stateSchema: artifactStateSchema,
});

export const artifactResources = {
  artifacts: artifactsCollection,
};
