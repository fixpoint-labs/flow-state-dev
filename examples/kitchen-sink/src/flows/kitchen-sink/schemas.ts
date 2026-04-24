import { z } from "zod";

// Shared domain schemas for the kitchen-sink flow.
// Centralizing schemas avoids duplication — blocks import only the slices they need.

export const modeSchema = z.enum(["ask", "build", "interview", "debate"]).default("ask");

export const featuresSchema = z.object({
  biasCheck: z.boolean().default(false),
  search: z.boolean().default(true),
  fetch: z.boolean().default(true),
  crawl: z.boolean().default(false),
});
