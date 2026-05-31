/**
 * `setupPhase5aMemos` — pre-creates the scenario-forecaster memo resource
 * in `pending` before the forecaster generator runs. Built via the shared
 * `defineMemoSetup` factory. Part of Phase 5 (Portfolio Management).
 */
import { PHASE_5_MEMO_KEYS } from "../agents";
import { defineMemoSetup } from "../lib/memo-setup";

export const setupPhase5aMemos = defineMemoSetup({
  phaseId: "p5",
  agentTeam: "pm",
  keys: { scenarioForecast: PHASE_5_MEMO_KEYS.scenarioForecast },
  activePhase: "phase-5",
});
