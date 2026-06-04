/**
 * Phase 5 approach preambles — fast-model free-text generators that stream
 * each agent's plan in plain English before its structured generator runs.
 * See `lib/approach-generator.ts` for the shared shape.
 *
 *   - `scenarioForecasterApproachGenerator` — precedes the forecaster.
 *   - `portfolioManagerApproachGenerator` — precedes the PM.
 *
 * Both reference the three upstream artifacts they weigh (`investmentThesis`,
 * `tradeProposal`, `riskAssessment`) without pulling in the heavier `*Full`
 * analyst-memo / debate-transcript blocks the structured generators read on
 * the `full` preset.
 */
import { PHASE_5_MEMO_KEYS } from "../agents";
import { tradingDesk } from "../capability";
import { createApproachGenerator } from "../lib/approach-generator";
import { loadPrompt } from "../lib/prompt";

const scenarioForecasterApproachPrompt = loadPrompt(
  "phase-5/prompts/scenario-forecaster-approach.prompt.md",
);

export const scenarioForecasterApproachGenerator = createApproachGenerator({
  name: "scenario-forecaster-approach-generator",
  agentName: PHASE_5_MEMO_KEYS.scenarioForecast.agentName,
  artifactName: "ScenarioForecast",
  prompt: scenarioForecasterApproachPrompt.prompt,
  uses: [
    tradingDesk.presets({
      investmentThesis: true,
      tradeProposal: true,
      riskAssessment: true,
    }),
  ],
});

const portfolioManagerApproachPrompt = loadPrompt(
  "phase-5/prompts/portfolio-manager-approach.prompt.md"
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
