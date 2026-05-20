/**
 * `phase4Pipeline` — the Phase 4 sub-sequencer.
 *
 * Runs after Phase 3: pre-creates four P4 memos in `pending`, then runs
 * three persona steps in fixed order (aggressive → conservative → neutral)
 * as a plain `.then()` chain, then runs the consolidation
 * `riskAssessmentGenerator` as a final step.
 *
 * Each persona step is built by the local `personaStep()` factory and
 * wraps its body in its own `.rescue` so a single persona's failure flips
 * only that memo to `error` while the rest run. Downstream personas read
 * prior persona memos via memo-backed `context` entries on their
 * generator definitions (see `personas.ts`) — Phase 4 does not use the
 * `roundRobin()` pattern because none of its distinguishing features
 * (multi-round debate, referee, homogeneous roster, shared transcript
 * readback) apply here. Phase 2's bull/bear debate is the canonical
 * `roundRobin()` demo in this example; see the round-robin section of
 * `examples/trading-desk/CLAUDE.md`.
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
  commitPersonaMemo,
  commitRiskAssessmentMemo,
  markErrorP4,
  markWritingP4,
  type Phase4PersonaShortName,
} from "./writer";

/** Build a persona step: `markWriting → approach → generator → commit`,
 *  wrapped in a per-step `.rescue` that flips only this persona's memo to
 *  `error`. Approach + generator are untyped (`unknown`-cast) because the
 *  three personas have different output schemas (neutral diverges) and a
 *  precise generic signature here would be more noise than the local
 *  call sites need. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function personaStep(shortName: Phase4PersonaShortName, approach: any, gen: any) {
  return sequencer({ name: `phase-4-${shortName}-step` })
    .tap(markWritingP4(shortName))
    .then(approach)
    .then(gen)
    .tap(commitPersonaMemo(shortName))
    .rescue([{ block: markErrorP4(shortName) }]);
}

const aggressiveStep = personaStep(
  "aggressive",
  aggressiveApproachGenerator,
  aggressiveRiskGenerator,
);

const conservativeStep = personaStep(
  "conservative",
  conservativeApproachGenerator,
  conservativeRiskGenerator,
);

const neutralStep = personaStep(
  "neutral",
  neutralApproachGenerator,
  neutralRiskGenerator,
);

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
