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

/** A single auditable citation. `url` and `title` only — inline `[n]`
 *  markers and per-claim source IDs are deferred (FIX-612 v1 is body-
 *  section citations only). */
export const citation = z.object({
  url: z.string(),
  title: z.string(),
});

export type Citation = z.infer<typeof citation>;

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
  /** URLs the analyst actually fetched and relied on, with their titles.
   *  Required (no default) so the LLM is forced to emit the key — `null`
   *  when nothing was fetched (cheap preset, no material context found),
   *  or an array when investigation produced citable sources. */
  citations: z.array(citation).nullable(),
  /** Honest signal about how much real data backed this memo, so downstream
   *  phases don't synthesize on hollow input (FIX-681). Driven by the
   *  analyst's `source` fields per the prompt contract:
   *    - `"full"`        — primary and all secondary sources returned data.
   *    - `"partial"`     — primary returned data; ≥1 secondary unavailable.
   *    - `"unavailable"` — the primary data source returned
   *                        `source: "unavailable"`; the memo is a minimal
   *                        skeleton and must not be synthesized from. */
  dataQuality: z.enum(["full", "partial", "unavailable"]),
});

export type ThesisOutput = z.infer<typeof thesisOutputSchema>;
