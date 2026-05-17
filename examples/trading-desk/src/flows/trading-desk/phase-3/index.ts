/**
 * `phase3Pipeline` — the Phase 3 sub-sequencer.
 *
 * Runs after Phase 2: pre-creates the trader memo in `pending`, then the
 * trader step taps `markWritingP3`, runs the trader generator, and taps
 * `commitTraderMemo` on success. A per-step rescue flips the memo to
 * `error` on generator failure — same shape as Phase 2's per-step rescues.
 *
 * Container `component` must start with `"phase-"` so the TranscriptPane
 * phase-divider predicate fires. `label` matches the Claude Design handoff
 * verbatim.
 */
import { sequencer } from "@flow-state-dev/core";
import { traderApproachGenerator } from "./approach";
import { setupPhase3Memos } from "./setup";
import { traderGenerator } from "./trader";
import {
  commitTraderMemo,
  markErrorP3,
  markWritingP3,
} from "./writer";

const traderStep = sequencer({ name: "phase-3-trader-step" })
  .tap(markWritingP3("trader"))
  .then(traderApproachGenerator)
  .then(traderGenerator)
  .tap(commitTraderMemo)
  .rescue([{ block: markErrorP3("trader") }]);

export const phase3Pipeline = sequencer({
  name: "phase-3-trader",
  container: {
    component: "phase-3-trader",
    label: "Phase 3 — Trader Synthesis.",
  },
})
  .tap(setupPhase3Memos)
  .then(traderStep);
