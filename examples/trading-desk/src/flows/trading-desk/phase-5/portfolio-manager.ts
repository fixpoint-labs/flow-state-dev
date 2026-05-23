/**
 * The Phase 5 portfolio-manager generator.
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
 */
import { generator } from "@flow-state-dev/core";
import { PHASE_5_MEMO_KEYS } from "../agents";
import { sessionStateSchema } from "../state";
import { tradingDesk } from "../capability";
import { PORTFOLIO_MANAGER_PROMPT } from "./prompts";
import { portfolioDecisionOutputSchema } from "./schemas";

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
    }),
  ],
  prompt: PORTFOLIO_MANAGER_PROMPT,
  user: "Now write the published PortfolioDecision.",
  sessionStateSchema,
  outputSchema: portfolioDecisionOutputSchema,
});
