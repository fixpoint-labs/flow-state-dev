/**
 * Output schema for the Phase 3 trader generator.
 *
 * The trader emits one structured `TradeProposal` per run. Shape mirrors
 * Phase 2's split between display-shape `metrics` (string-typed, matching
 * the Claude Design handoff render contract) and machine-shape typed
 * extension fields (`direction`, `sizePct`, `stopPrice`, `targetPrice`,
 * `holdingPeriod`, `invalidationCriteria`, `dependsOn`) — the latter are
 * what Phase 4 (risk) and Phase 5 (PM) read without parsing strings.
 *
 * BP-016: every field is required, `metrics` is a fixed-shape object,
 * `rating` / `direction` / `holdingPeriod` are enums of literals, and
 * `nullable` is never reached for output fields.
 */
import { z } from "zod";
import { thesisSection } from "../resources";

export const tradeProposalOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.enum(["long", "short", "flat"]),
  metrics: z.object({
    direction: z.string(),
    size: z.string(),
    stop: z.string(),
    target: z.string(),
    conviction: z.string(),
  }),
  body: z.array(thesisSection),
  // Typed extension fields — machine-readable mirror of the display
  // `metrics` row, consumed by Phase 4 (risk) and Phase 5 (PM).
  direction: z.enum(["long", "short", "flat"]),
  sizePct: z.number().min(0).max(10),
  stopPrice: z.number().min(0),
  targetPrice: z.number().min(0),
  holdingPeriod: z.enum(["days", "weeks", "months", "quarters"]),
  invalidationCriteria: z.array(z.string()),
  dependsOn: z.array(z.string()),
});

export type TradeProposalOutput = z.infer<typeof tradeProposalOutputSchema>;
