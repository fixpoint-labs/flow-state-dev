/**
 * The Phase 5 sub-sequencers. Phase 5 runs two stages in order — the
 * scenario forecaster, then the portfolio manager — each its own top-level
 * phase-divider container (composed sequentially in `flow.ts`).
 *
 *   - `scenarioForecasterPipeline` — pre-creates the scenario-forecaster
 *     memo, taps `markWritingForecast`, runs the forecaster, and taps
 *     `commitScenarioForecastMemo` on success.
 *   - `phase5Pipeline` — pre-creates the portfolio-manager memo, taps
 *     `markWritingP5`, runs the portfolioManagerGenerator, and taps
 *     `commitPortfolioManagerMemo` on success.
 *
 * Each stage's single step has a per-step rescue that flips its memo to
 * `error` on generator failure or a writer integrity throw
 * (`probability-violation` for the forecaster, `lineage-violation` for the
 * PM) — same shape as Phase 3's single-step rescue.
 *
 * Container `component` must start with `"phase-"` so the TranscriptPane
 * phase-divider predicate fires. `label` matches the design reference's
 * Phase 5 divider lines.
 */
import { sequencer } from "@flow-state-dev/core";
import { portfolioManagerApproachGenerator } from "../agents/portfolio-manager/approach";
import { scenarioForecasterApproachGenerator } from "../agents/scenario-forecaster/approach";
import { portfolioManagerGenerator } from "../agents/portfolio-manager/portfolio-manager";
import { scenarioForecasterGenerator } from "../agents/scenario-forecaster/scenario-forecaster";
import { setupPhase5Memos } from "../agents/portfolio-manager/setup";
import { setupScenarioForecastMemos } from "../agents/scenario-forecaster/setup";
import {
  commitPortfolioManagerMemo,
  markErrorP5,
  markWritingP5,
} from "../agents/portfolio-manager/writer";
import {
  commitScenarioForecastMemo,
  markErrorForecast,
  markWritingForecast,
} from "../agents/scenario-forecaster/writer";

const scenarioForecasterStep = sequencer({
  name: "phase-5-scenario-forecaster-step",
})
  .tap(markWritingForecast("scenarioForecast"))
  .step(scenarioForecasterApproachGenerator)
  .step(scenarioForecasterGenerator)
  .tap(commitScenarioForecastMemo)
  .rescue([{ block: markErrorForecast("scenarioForecast") }]);

export const scenarioForecasterPipeline = sequencer({
  name: "phase-5-scenario-forecaster",
  container: {
    component: "phase-5-scenario-forecaster",
    label: "Phase 5 — Scenario Forecaster.",
  },
})
  .tap(setupScenarioForecastMemos)
  .step(scenarioForecasterStep);

const portfolioManagerStep = sequencer({
  name: "phase-5-portfolio-manager-step",
})
  .tap(markWritingP5("portfolioManager"))
  .step(portfolioManagerApproachGenerator)
  .step(portfolioManagerGenerator)
  .tap(commitPortfolioManagerMemo)
  .rescue([{ block: markErrorP5("portfolioManager") }]);

export const phase5Pipeline = sequencer({
  name: "phase-5-portfolio-manager",
  container: {
    component: "phase-5-portfolio-manager",
    label: "Phase 5 — Portfolio Manager decision.",
  },
})
  .tap(setupPhase5Memos)
  .step(portfolioManagerStep);
