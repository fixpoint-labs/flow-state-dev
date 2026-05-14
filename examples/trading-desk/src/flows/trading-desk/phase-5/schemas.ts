/**
 * Output schema for the Phase 5 portfolio-manager generator.
 *
 * The portfolio manager emits one structured `PortfolioDecision` per run.
 * Shape mirrors the upstream design reference: a five-tier final rating, a
 * one-line decision summary, a self-reported confidence score, an
 * explicit accept-or-override decision against each risk adjustment, the
 * judgment calls the decision rests on, a structured prose rationale, and
 * a header-shape `metrics` row for the PM Hero.
 *
 * BP-016: no `z.optional` / `z.default` / `z.record` / `.nullable` reachable
 * from outputs; `finalRating` is a literal-only union; the body section
 * shape is a single object with all required keys (no shape-varying union).
 *
 * `upstreamReferences` and `agreesWithTrader` are NOT in the output schema —
 * they're derived at commit time from canonical key maps and the trader
 * memo's `direction` field. Making the LLM emit them would add
 * hallucination surface for fields we can compute deterministically.
 */
import { z } from "zod";
import { thesisSection } from "../resources";

const adjustmentDecisionSchema = z.object({
  applied: z.boolean(),
  reasoning: z.string(),
});

export const portfolioDecisionOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.string(),
  metrics: z.object({
    rating: z.string(),
    ticker: z.string(),
    window: z.string(),
    size: z.string(),
    stop: z.string(),
    target: z.string(),
  }),
  body: z.array(thesisSection),
  finalRating: z.enum(["Sell", "Underweight", "Hold", "Overweight", "Buy"]),
  decisionSummary: z.string(),
  decisionConfidence: z.number().min(0).max(1),
  acceptedAdjustments: z.object({
    sizing: adjustmentDecisionSchema,
    holdingPeriod: adjustmentDecisionSchema,
    invalidation: adjustmentDecisionSchema,
  }),
  keyDependencies: z.array(z.string()),
});

export type PortfolioDecisionOutput = z.infer<typeof portfolioDecisionOutputSchema>;
