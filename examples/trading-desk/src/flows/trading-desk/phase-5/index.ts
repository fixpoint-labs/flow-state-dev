/**
 * `phase5Pipeline` — the Phase 5 sub-sequencer.
 *
 * Runs after Phase 4: pre-creates the portfolio-manager memo in `pending`,
 * then a single step taps `markWritingP5`, runs the portfolioManagerGenerator,
 * and taps `commitPortfolioManagerMemo` on success. A per-step rescue flips
 * the memo to `error` on generator failure — same shape as Phase 3's
 * single-step rescue.
 *
 * Container `component` must start with `"phase-"` so the TranscriptPane
 * phase-divider predicate fires. `label` matches the design reference's
 * Phase 5 divider line.
 */
import { sequencer } from "@flow-state-dev/core";
import { portfolioManagerApproachGenerator } from "./approach";
import { portfolioManagerGenerator } from "./portfolio-manager";
import { setupPhase5Memos } from "./setup";
import {
  commitPortfolioManagerMemo,
  markErrorP5,
  markWritingP5,
} from "./writer";

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
