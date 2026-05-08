/**
 * `Thesis` output schema — the structured shape every Phase 1 analyst
 * generator emits. It is the slice of `memoStateSchema` (in `resources.ts`)
 * that the LLM populates: label, headline, rating, body sections, metrics.
 *
 * Keeping the shape co-located with the analyst block lets the generator's
 * `outputSchema` and the memo-writer's input agree on the exact field set
 * without round-tripping through the full memo state.
 */
import { z } from "zod";

const thesisSection = z.union([
  z.object({
    h: z.string(),
    p: z.string(),
    items: z.array(z.string()).optional(),
  }),
  z.object({
    h: z.string(),
    items: z.array(z.string()),
    p: z.string().optional(),
  }),
]);

/** Output schema enforced on the analyst generators. */
export const thesisOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.enum(["constructive", "neutral", "cautious"]),
  metrics: z.record(z.string(), z.string()),
  body: z.array(thesisSection),
});

export type ThesisOutput = z.infer<typeof thesisOutputSchema>;
