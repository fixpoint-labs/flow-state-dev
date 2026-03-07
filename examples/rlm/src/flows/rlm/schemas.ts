import { z } from "zod";

// Resource state schema for the "context" session resource.
// Stores the large context document that the RLM explores via tools.
export const contextResourceStateSchema = z.object({
  text: z.string().default(""),
  metadata: z.object({
    source: z.string().optional(),
    tokenEstimate: z.number().optional()
  }).default({})
});
