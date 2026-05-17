/**
 * `phase4Pipeline` — the Phase 4 sub-sequencer.
 *
 * Runs after Phase 3: pre-creates four P4 memos in `pending`, derives the
 * round-robin goal, runs three persona slots in fixed order via
 * `phase4RoundRobin` (each slot wrapped in its own `.rescue` so a single
 * persona's failure flips only that memo to `error` while the rest run),
 * then runs the consolidation `riskAssessmentGenerator` as a final step
 * with its own per-step rescue.
 *
 * Container `component` starts with `"phase-"` so the TranscriptPane
 * phase-divider predicate fires. `label` matches the design comment
 * verbatim ("Phase 4 — Risk Round-Robin. 3 risk officers, round-robin
 * order.").
 */
import { sequencer } from "@flow-state-dev/core";
import { riskAssessmentApproachGenerator } from "./approach";
import { riskAssessmentGenerator } from "./consolidator";
import { deriveRiskGoal, phase4RoundRobin } from "./round-robin";
import { setupPhase4Memos } from "./setup";
import {
  commitRiskAssessmentMemo,
  markErrorP4,
  markWritingP4,
} from "./writer";

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
  .then(deriveRiskGoal)
  .then(phase4RoundRobin)
  .then(riskAssessmentStep);
