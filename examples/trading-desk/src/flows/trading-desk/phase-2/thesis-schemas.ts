/**
 * Output schemas for the three Phase 2 generators.
 *
 * Each schema is a slice of `memoStateSchema` (in `../resources.ts`) that the
 * LLM populates: label, headline, rating, body sections, metrics. Shapes
 * match the Claude Design handoff (2026-05-06) — `BullThesis` rates `buy`,
 * `BearThesis` rates `underweight`, and the research manager's
 * `InvestmentThesis` rates one of `constructive | neutral | cautious` (so a
 * bearish synthesis no longer reaches downstream phases under a positive
 * headline label) and adds five extension fields that capture the debate's
 * outcome (stance, conviction, key risks / opportunities, and explicit
 * unresolved disagreements).
 */
import { z } from "zod";
import { thesisSection } from "../resources";

/** Bull researcher consolidation output. Rating is fixed `"buy"`. */
export const bullThesisOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.literal("buy"),
  metrics: z.object({
    conviction: z.string(),
    horizon: z.string(),
    target: z.string(),
    stop: z.string(),
  }),
  body: z.array(thesisSection),
});

export type BullThesisOutput = z.infer<typeof bullThesisOutputSchema>;

/** Bear researcher consolidation output. Rating is fixed `"underweight"`. */
export const bearThesisOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.literal("underweight"),
  metrics: z.object({
    conviction: z.string(),
    horizon: z.string(),
    downside: z.string(),
    trigger: z.string(),
  }),
  body: z.array(thesisSection),
});

export type BearThesisOutput = z.infer<typeof bearThesisOutputSchema>;

/**
 * Research manager output. Combines the design's `Thesis` shape with the
 * five InvestmentThesis extension fields. `unresolvedDisagreements` is the
 * intentional design choice that keeps the phase honest — empty is
 * acceptable but should be the exception on a non-trivial trade.
 */
export const investmentThesisOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.enum(["constructive", "neutral", "cautious"]),
  metrics: z.object({
    conviction: z.string(),
    horizon: z.string(),
    stance: z.string(),
    outOfScope: z.string(),
  }),
  body: z.array(thesisSection),
  // Extension fields — populated only on the research-manager memo.
  stance: z.enum(["bullish", "bearish", "neutral"]),
  convictionScore: z.number().min(0).max(1),
  keyRisks: z.array(z.string()),
  keyOpportunities: z.array(z.string()),
  unresolvedDisagreements: z.array(z.string()),
});

export type InvestmentThesisOutput = z.infer<typeof investmentThesisOutputSchema>;
