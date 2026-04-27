import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

// Resource state schema for the "context" session resource.
// Stores the large context document that the RLM explores via tools.
export const contextResourceStateSchema = z.object({
  text: z.string().default(""),
  metadata: z.object({
    source: z.string().optional(),
    tokenEstimate: z.number().optional(),
    model: z.string().optional()
  }).default({})
});

/**
 * Session-scoped resource holding the RLM context document. Shared across the
 * root generator, sub-query generator, and exploration tools (peek/grep/chunk)
 * so they all read and write the same `(text, metadata)` slot.
 */
export const contextResource = defineResource({
  scope: "session",
  stateSchema: contextResourceStateSchema,
  writable: true,
});

export const rlmQueryInputSchema = z.object({
  query: z.string().min(1),
  context: z.string().min(1),
  model: z.string().min(1)
});

export const subQueryOutputSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string())
});

export const rlmOutputSchema = z.object({
  answer: z.string(),
  reasoning: z.string(),
  sourcesUsed: z.array(z.string())
});
