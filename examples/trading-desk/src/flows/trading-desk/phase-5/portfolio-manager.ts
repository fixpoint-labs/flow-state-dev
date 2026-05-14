/**
 * The Phase 5 portfolio-manager generator.
 *
 * Reads the always-on upstream artifacts — Phase 2 InvestmentThesis,
 * Phase 3 TradeProposal, Phase 4 RiskAssessment — and writes a typed
 * `PortfolioDecision`. On the `full` preset it also reads the four analyst
 * memos, the full bull/bear debate transcript, and the three persona
 * risk critiques.
 *
 * `agentType: "primary"` so the structured `TxStruct` card renders in the
 * transcript automatically (the navigator's `PRIMARY_STRUCT_AGENTS` set
 * already includes `portfolioManager`).
 *
 * Capability-driven context. The `tradingDesk` capability provides the
 * `investmentThesis`, `tradeProposal`, and `riskAssessment` presets always;
 * the `full` preset additionally pulls in `phase1Memos`, `phase2Debate`,
 * and `riskCritiques`. The `p2Contributions` resource is declared on the
 * generator directly because the dynamic `phase2Debate` preset can only
 * contribute context (resources must be declared statically).
 */
import { generator } from "@flow-state-dev/core";
import { PHASE_5_MEMO_KEYS } from "../agents";
import { phase2Contributions } from "../phase-2/round-robin";
import { sessionStateSchema } from "../state";
import { tradingDesk } from "../services/trading-desk-capability";
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
    }),
    (ctx: { session: { state: { costPreset?: string } } }) =>
      ctx.session.state.costPreset === "full"
        ? ([
            tradingDesk.presets({
              phase1Memos: true,
              phase2Debate: true,
              riskCritiques: true,
            }),
          ] as const)
        : ([] as const),
  ] as const,
  resources: { p2Contributions: phase2Contributions },
  prompt: PORTFOLIO_MANAGER_PROMPT,
  user: "Now write the published PortfolioDecision.",
  sessionStateSchema,
  outputSchema: portfolioDecisionOutputSchema,
});
