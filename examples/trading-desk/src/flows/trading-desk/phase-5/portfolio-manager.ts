/**
 * The Phase 5 portfolio-manager generator and its output schema.
 *
 * Reads the always-on upstream artifacts — Phase 2 InvestmentThesis,
 * Phase 3 TradeProposal, Phase 4 RiskAssessment — and writes a typed
 * `PortfolioDecision`. On the `full` preset it also reads the four
 * analyst memos, the bull/bear debate transcript, and the three persona
 * risk critiques. The cost-preset gating lives inside the `*Full`
 * presets, not at the call site.
 *
 * `itemVisibility: { client: true, history: true }` so the structured
 * `TxStruct` card renders in the transcript automatically (the navigator's
 * `PRIMARY_STRUCT_AGENTS` set already includes `portfolioManager`).
 *
 * The output schema lives inline here because only one generator emits
 * the shape; the Phase 5 writer imports the type back to project the
 * commit. `upstreamReferences` and `agreesWithTrader` are NOT in this
 * schema — they're derived at commit time from canonical key maps and
 * the trader memo's `direction` field. Making the LLM emit them would
 * add hallucination surface for fields we can compute deterministically.
 */
import { generator } from "@flow-state-dev/core";
import { definePromptFile } from "@flow-state-dev/core/prompt-file";
import { z } from "zod";
import { PHASE_5_MEMO_KEYS } from "../agents";
import { tradingDesk } from "../capability";
import { thesisSection } from "../resources";
import { sessionStateSchema } from "../state";
import { loadPrompt } from "../lib/prompt";

const portfolioManagerPrompt = loadPrompt(
  "phase-5/prompts/portfolio-manager.prompt.md"
);

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
  // Buy/Overweight decision predicates. Required string fields; empty
  // string for Hold/Sell/Underweight. The Buy/Overweight non-empty
  // requirement is enforced by the prompt, not the schema (BP-016 keeps
  // every field required, so empty string is the optional-when-Hold
  // pattern rather than `.optional()`).
  asymmetricEdge: z.string(),
  nearTermCatalyst: z.string(),
  invalidationTrigger: z.string(),
  // One disposition per trader dependency, referenced by its position
  // ([0], [1], …) in `trader.dependsOn` as rendered to the PM. The Phase 5
  // writer requires every trader-dependency index to appear here exactly
  // once: `carried` keeps it as a live contestable judgment, `dropped`
  // sets it aside with a one-sentence reason in `note`. Referencing by
  // index rather than re-typing the dependency text is what makes the
  // lineage check robust — the PM can paraphrase freely in
  // `keyDependencies` without orphaning a judgment.
  traderDependencyDispositions: z.array(
    z.object({
      index: z.number().int(),
      status: z.enum(["carried", "dropped"]),
      note: z.string(),
    }),
  ),
  // The scenario bucket this decision underwrites. Empty string when the
  // forecast is unavailable or the PM disagrees with all buckets.
  primaryScenario: z.string(),
  // Override reason: non-empty when the PM chooses a rating outside the
  // model-implied band. Empty string when staying within the band.
  ratingOverrideReason: z.string(),
});

export type PortfolioDecisionOutput = z.infer<typeof portfolioDecisionOutputSchema>;

export const portfolioManagerGenerator = generator({
  name: "portfolio-manager-generator",
  itemVisibility: { client: true, history: true },
  agentName: PHASE_5_MEMO_KEYS.portfolioManager.agentName,
  uses: [
    tradingDesk.presets({
      investmentThesis: true,
      tradeProposal: true,
      riskAssessment: true,
      scenarioForecast: true,
      valuationSpine: true,
      phase1MemosFull: true,
      phase2DebateFull: true,
      riskCritiquesFull: true,
      highReasoning: true,
    }),
  ],
  ...definePromptFile(portfolioManagerPrompt),
  sessionStateSchema,
  outputSchema: portfolioDecisionOutputSchema,
});
