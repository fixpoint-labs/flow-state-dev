/**
 * `phase4Pipeline` — the Phase 4 sub-sequencer.
 *
 * Runs after Phase 3: pre-creates four P4 memos in `pending`, then runs
 * three persona steps in fixed order (aggressive → conservative → neutral)
 * as a plain `.then()` chain, then runs the consolidation
 * `riskAssessmentGenerator` as a final step.
 *
 * Each persona step is wrapped in its own `.rescue` so a single persona's
 * failure flips only that memo to `error` while the rest run. The
 * downstream personas read prior persona memos via memo-backed `context`
 * entries on their generator definitions (see `personas.ts`) — Phase 4
 * does not use the `roundRobin()` pattern because none of its
 * distinguishing features (multi-round debate, referee, homogeneous
 * roster, shared transcript readback) apply here. Phase 2's bull/bear
 * debate is the canonical `roundRobin()` demo in this example; see the
 * round-robin section of `examples/trading-desk/CLAUDE.md`.
 *
 * Container `component` starts with `"phase-"` so the TranscriptPane
 * phase-divider predicate fires. `label` matches the design comment
 * verbatim ("Phase 4 — Risk Round-Robin. 3 risk officers, round-robin
 * order.").
 */
import { sequencer } from "@flow-state-dev/core";
import {
  aggressiveApproachGenerator,
  conservativeApproachGenerator,
  neutralApproachGenerator,
  riskAssessmentApproachGenerator,
} from "./approach";
import { riskAssessmentGenerator } from "./consolidator";
import {
  aggressiveRiskGenerator,
  conservativeRiskGenerator,
  neutralRiskGenerator,
} from "./personas";
import { setupPhase4Memos } from "./setup";
import {
  commitAggressiveRiskMemo,
  commitConservativeRiskMemo,
  commitNeutralRiskMemo,
  commitRiskAssessmentMemo,
  markErrorP4,
  markWritingP4,
} from "./writer";

const aggressiveStep = sequencer({ name: "phase-4-aggressive-step" })
  .tap(markWritingP4("aggressive"))
  .then(aggressiveApproachGenerator)
  .then(aggressiveRiskGenerator)
  .tap(commitAggressiveRiskMemo)
  .rescue([{ block: markErrorP4("aggressive") }]);

const conservativeStep = sequencer({ name: "phase-4-conservative-step" })
  .tap(markWritingP4("conservative"))
  .then(conservativeApproachGenerator)
  .then(conservativeRiskGenerator)
  .tap(commitConservativeRiskMemo)
  .rescue([{ block: markErrorP4("conservative") }]);

const neutralStep = sequencer({ name: "phase-4-neutral-step" })
  .tap(markWritingP4("neutral"))
  .then(neutralApproachGenerator)
  .then(neutralRiskGenerator)
  .tap(commitNeutralRiskMemo)
  .rescue([{ block: markErrorP4("neutral") }]);

const riskAssessmentStep = sequencer({
  name: "phase-4-risk-assessment-step",
})
  .tap(markWritingP4("riskAssessment"))
  .then(riskAssessmentApproachGenerator)
  .then(riskAssessmentGenerator)
  .tap(commitRiskAssessmentMemo)
  .rescue([{ block: markErrorP4("riskAssessment") }]);

export const phase4Pipeline = sequencer({
  name: "phase-4-risk-debate",
  container: {
    component: "phase-4-risk-debate",
    label: "Phase 4 — Risk Round-Robin. 3 risk officers, round-robin order.",
  },
})
  .tap(setupPhase4Memos)
  .then(aggressiveStep)
  .then(conservativeStep)
  .then(neutralStep)
  .then(riskAssessmentStep);
