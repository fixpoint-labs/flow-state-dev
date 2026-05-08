/**
 * Phase 2 sub-sequencer state.
 *
 * Holds the loop transcript and the bull/bear theses across post-loop
 * generators. The round-robin pattern owns its own internal contributions
 * resource; we capture the entries on the way out via the loop's final
 * shape and stash them here so downstream generators can read them
 * without re-deriving from input.
 */
import { z } from "zod";
import { roundRobinContributionEntrySchema } from "@flow-state-dev/patterns/round-robin";
import { thesisSection } from "../resources";

const bullThesisShape = z
  .object({
    label: z.string(),
    headline: z.string(),
    rating: z.literal("buy"),
    metrics: z.record(z.string(), z.string()),
    body: z.array(thesisSection),
  })
  .nullable()
  .default(null);

const bearThesisShape = z
  .object({
    label: z.string(),
    headline: z.string(),
    rating: z.literal("underweight"),
    metrics: z.record(z.string(), z.string()),
    body: z.array(thesisSection),
  })
  .nullable()
  .default(null);

export const phase2StateSchema = z.object({
  contributions: z.array(roundRobinContributionEntrySchema).default([]),
  bullThesis: bullThesisShape,
  bearThesis: bearThesisShape,
});

export type Phase2State = z.infer<typeof phase2StateSchema>;
