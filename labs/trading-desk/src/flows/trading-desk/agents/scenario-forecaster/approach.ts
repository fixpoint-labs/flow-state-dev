/**
 * Scenario-forecaster approach preamble — a fast-model free-text generator
 * that streams the forecaster's plan in plain English before its structured
 * generator runs. See `lib/approach-generator.ts` for the shared shape.
 *
 * References the three upstream artifacts it weighs (`investmentThesis`,
 * `tradeProposal`, `riskAssessment`) without pulling in the heavier `*Full`
 * analyst-memo / debate-transcript blocks the structured generator reads on
 * the `full` preset.
 */
import { PHASE_5_MEMO_KEYS } from "../../agents";
import { tradingDesk } from "../../capability";
import { createApproachGenerator } from "../_recipe/approach-generator";
import { loadPrompt } from "../../lib/prompt";

const scenarioForecasterApproachPrompt = loadPrompt(
  "agents/scenario-forecaster/prompts/scenario-forecaster-approach.prompt.md",
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
