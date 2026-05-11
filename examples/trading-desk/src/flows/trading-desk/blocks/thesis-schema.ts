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
import { thesisSection } from "../resources";

/**
 * Output schema enforced on the analyst generators.
 *
 * `metrics` is an array of `{ key, value }` pairs rather than a `Record`:
 * OpenAI strict structured-output requires a closed `properties` set, so an
 * open string-keyed map (`z.record`) trips the schema check. Each analyst
 * still emits the four role-specific keys named in its prompt; the writer
 * (`commitMemo`) flattens the array to a `Record<string, string>` before
 * persisting, so the stored memo shape is unchanged.
 */
export const thesisOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.enum(["constructive", "neutral", "cautious"]),
  metrics: z.array(z.object({ key: z.string(), value: z.string() })),
  body: z.array(thesisSection),
});

export type ThesisOutput = z.infer<typeof thesisOutputSchema>;
