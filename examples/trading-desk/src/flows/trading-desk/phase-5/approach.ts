/**
 * Phase 5 portfolio-manager approach preamble.
 *
 * A fast-model free-text generator that streams the PM's plan in plain
 * English before the structured `portfolioManagerGenerator` runs. See
 * `lib/approach-generator.ts` for the shared shape.
 *
 * Capability presets: `tradeProposal`, `riskAssessment`, and
 * `investmentThesis`. The preamble references all three upstream
 * artifacts the PM is about to weigh, without pulling in the heavier
 * `*Full` analyst-memo / debate-transcript blocks the structured PM
 * reads on the `full` preset.
 */
import { PHASE_5_MEMO_KEYS } from "../agents";
import { tradingDesk } from "../capability";
import { createApproachGenerator } from "../lib/approach-generator";
import { PORTFOLIO_MANAGER_APPROACH_PROMPT } from "./prompts";

export const portfolioManagerApproachGenerator = createApproachGenerator({
  name: "portfolio-manager-approach-generator",
  agentName: PHASE_5_MEMO_KEYS.portfolioManager.agentName,
  artifactName: "PortfolioDecision",
  prompt: PORTFOLIO_MANAGER_APPROACH_PROMPT,
  uses: [
    tradingDesk.presets({
      tradeProposal: true,
      riskAssessment: true,
      investmentThesis: true,
    }),
  ],
});
