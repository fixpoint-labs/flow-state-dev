/**
 * Phase 5 memo-setup blocks — each pre-creates a phase-5 memo resource in
 * `pending` before its generator runs, via the shared `defineMemoSetup`
 * factory.
 *
 *   - `setupScenarioForecastMemos` — the scenario-forecaster memo (the
 *     first Phase 5 sub-stage, before the PM).
 *   - `setupPhase5Memos` — the portfolio-manager memo.
 */
import { PHASE_5_MEMO_KEYS } from "../agents";
import { defineMemoSetup } from "../lib/memo-setup";

export const setupScenarioForecastMemos = defineMemoSetup({
  phaseId: "p5",
  agentTeam: "pm",
  keys: { scenarioForecast: PHASE_5_MEMO_KEYS.scenarioForecast },
  activePhase: "phase-5",
});

export const setupPhase5Memos = defineMemoSetup({
  phaseId: "p5",
  agentTeam: "pm",
  keys: { portfolioManager: PHASE_5_MEMO_KEYS.portfolioManager },
  activePhase: "phase-5",
});
