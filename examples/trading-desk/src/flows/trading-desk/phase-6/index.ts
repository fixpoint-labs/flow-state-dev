/**
 * `phase6Pipeline` — the Phase 6 sub-sequencer (post-decision thesis audit).
 *
 * Runs after Phase 5, gated on a non-null `userThesis` (see `flow.ts`). It
 * pre-creates the thesis-alignment memo in `pending`, then a single step taps
 * `markWritingP6`, runs the validator, and taps `commitThesisAlignmentMemo` on
 * success. A per-step rescue flips the memo to `error` on generator failure
 * or on an anti-yes-man enforcement throw — same shape as Phase 5's
 * single-step rescue.
 *
 * Like Phases 3–5, a fast-model approach preamble streams before the
 * structured generator so the transcript shows a "Phase 6 Approach" beat —
 * it only appears when Phase 6 runs (a user thesis was provided).
 *
 * Container `component` must start with `"phase-"` so the TranscriptPane
 * phase-divider predicate fires.
 */
import { sequencer } from "@flow-state-dev/core";
import { thesisValidatorApproachGenerator } from "./approach";
import { thesisValidatorGenerator } from "./thesis-validator";
import { setupPhase6Memos } from "./setup";
import {
  commitThesisAlignmentMemo,
  markErrorP6,
  markWritingP6,
} from "./writer";

const validatorStep = sequencer({ name: "phase-6-validator-step" })
  .tap(markWritingP6("thesisAlignment"))
  .then(thesisValidatorApproachGenerator)
  .then(thesisValidatorGenerator)
  .tap(commitThesisAlignmentMemo)
  .rescue([{ block: markErrorP6("thesisAlignment") }]);

export const phase6Pipeline = sequencer({
  name: "phase-6-thesis-audit",
  container: {
    component: "phase-6-thesis-audit",
    label: "Phase 6 — Thesis Audit.",
  },
})
  .tap(setupPhase6Memos)
  .then(validatorStep);
