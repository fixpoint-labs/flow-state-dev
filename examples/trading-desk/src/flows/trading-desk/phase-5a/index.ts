/**
 * `phase5aPipeline` — the Phase 5a sub-sequencer (scenario forecaster).
 *
 * Runs after Phase 4 and before Phase 5. Pre-creates the scenario-forecaster
 * memo in `pending`, then a single step taps `markWritingP5a`, runs the
 * forecaster, and taps `commitScenarioForecastMemo` on success. A per-step
 * rescue flips the memo to `error` on generator failure or on a
 * `probability-violation` throw — same shape as Phase 5's single-step rescue.
 *
 * Container `component` must start with `"phase-"` so the TranscriptPane
 * phase-divider predicate fires.
 */
import { sequencer } from "@flow-state-dev/core";
import { scenarioForecasterApproachGenerator } from "./approach";
import { scenarioForecasterGenerator } from "./scenario-forecaster";
import { setupPhase5aMemos } from "./setup";
import {
  commitScenarioForecastMemo,
  markErrorP5a,
  markWritingP5a,
} from "./writer";

const scenarioForecasterStep = sequencer({ name: "phase-5a-scenario-forecaster-step" })
  .tap(markWritingP5a("scenarioForecast"))
  .step(scenarioForecasterApproachGenerator)
  .step(scenarioForecasterGenerator)
  .tap(commitScenarioForecastMemo)
  .rescue([{ block: markErrorP5a("scenarioForecast") }]);

export const phase5aPipeline = sequencer({
  name: "phase-5a-scenario-forecaster",
  container: {
    component: "phase-5a-scenario-forecaster",
    label: "Phase 5a — Scenario Forecaster.",
  },
})
  .tap(setupPhase5aMemos)
  .step(scenarioForecasterStep);
