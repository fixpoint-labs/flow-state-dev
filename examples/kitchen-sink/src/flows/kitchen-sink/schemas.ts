import { z } from "zod";

// Shared domain schemas for the kitchen-sink flow.
// Centralizing schemas avoids duplication — blocks import only the slices they need.

export const modeSchema = z.enum(["chat", "plan", "review", "rlm"]);

export const artifactSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  updatedAt: z.number()
});

// Resource state schema for the "artifacts" session resource.
// Resources are named state containers scoped to a session — think of them as
// typed key-value stores that blocks can read and write during execution.
export const artifactResourceStateSchema = z.object({
  byId: z.record(z.string(), artifactSchema).default({}),
  order: z.array(z.string()).default([])
});
