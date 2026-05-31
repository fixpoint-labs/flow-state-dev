/**
 * Phase 5 scenario-forecaster approach preamble.
 *
 * A fast-model free-text generator that streams the forecaster's plan in
 * plain English before the structured `scenarioForecasterGenerator` runs.
 * See `lib/approach-generator.ts` for the shared shape.
 *
 * Capability presets: `investmentThesis`, `tradeProposal`, and
 * `riskAssessment` — the three upstream artifacts the forecaster weighs.
 * Does not pull the heavier `*Full` analyst-memo / debate-transcript blocks.
 */
import { PHASE_5_MEMO_KEYS } from "../agents";
import { tradingDesk } from "../capability";
import { createApproachGenerator } from "../lib/approach-generator";
import { loadPrompt } from "../lib/prompt";

const scenarioForecasterApproachPrompt = loadPrompt(
  "phase-5a/prompts/scenario-forecaster-approach.prompt.md",
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
