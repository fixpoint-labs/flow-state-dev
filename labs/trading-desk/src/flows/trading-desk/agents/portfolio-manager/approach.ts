/**
 * Portfolio-manager approach preamble — a fast-model free-text generator
 * that streams the PM's plan in plain English before its structured
 * generator runs. See `lib/approach-generator.ts` for the shared shape.
 *
 * References the three upstream artifacts it weighs (`investmentThesis`,
 * `tradeProposal`, `riskAssessment`) without pulling in the heavier `*Full`
 * analyst-memo / debate-transcript blocks the structured generator reads on
 * the `full` preset.
 */
import { PHASE_5_MEMO_KEYS } from "../../registry";
import { tradingDesk } from "../../capability";
import { createApproachGenerator } from "../_recipe/approach-generator";
import { loadPrompt } from "../../lib/prompt";

const portfolioManagerApproachPrompt = loadPrompt(
  "agents/portfolio-manager/prompts/portfolio-manager-approach.prompt.md"
);

export const portfolioManagerApproachGenerator = createApproachGenerator({
  name: "portfolio-manager-approach-generator",
  agentName: PHASE_5_MEMO_KEYS.portfolioManager.agentName,
  artifactName: "PortfolioDecision",
  prompt: portfolioManagerApproachPrompt.prompt,
  uses: [
    tradingDesk.presets({
      tradeProposal: true,
      riskAssessment: true,
      investmentThesis: true,
    }),
  ],
});
