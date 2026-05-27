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
 * `agentType: "primary"` so the structured `TxStruct` card renders in the
 * transcript automatically (the navigator's `PRIMARY_STRUCT_AGENTS` set
 * already includes `portfolioManager`).
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
});

export type PortfolioDecisionOutput = z.infer<typeof portfolioDecisionOutputSchema>;

export const portfolioManagerGenerator = generator({
  name: "portfolio-manager-generator",
  agentType: "primary",
  agentName: PHASE_5_MEMO_KEYS.portfolioManager.agentName,
  uses: [
    tradingDesk.presets({
      investmentThesis: true,
      tradeProposal: true,
      riskAssessment: true,
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
