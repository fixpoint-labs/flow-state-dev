/**
 * `setupScenarioForecastMemos` — pre-creates the scenario-forecaster memo
 * resource in `pending` before its generator runs (the first Phase 5
 * sub-stage, before the PM). Built via the shared `defineMemoSetup` factory.
 */
import { PHASE_5_MEMO_KEYS } from "../../registry";
import { defineMemoSetup } from "../_recipe/memo-setup";

export const setupScenarioForecastMemos = defineMemoSetup({
  phaseId: "p5",
  agentTeam: "pm",
  keys: { scenarioForecast: PHASE_5_MEMO_KEYS.scenarioForecast },
  activePhase: "phase-5",
});
