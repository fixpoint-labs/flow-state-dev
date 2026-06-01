/**
 * `phase1Pipeline` — the Phase 1 sub-sequencer.
 *
 * Pre-creates the seven memo slots, then runs the seven analyst sub-sequencers
 * in parallel. The container `component: "analyst-phase"` is what the
 * transcript pane keys on to render the "Phase 1 — Analyst Fan-out begins"
 * divider; the `label` matches the canonical Design Reference string
 * verbatim so the divider copy is consistent across runs.
 */
import { sequencer } from "@flow-state-dev/core";
import {
  companyProfileAnalyst,
  fundamentalsAnalyst,
  macroAnalyst,
  marketAnalyst,
  newsAnalyst,
  sentimentAnalyst,
  technicalAnalyst,
} from "./analysts";
import { setupPhase1Memos } from "./setup";

export const phase1Pipeline = sequencer({
  name: "phase-1-analysts",
  container: {
    component: "analyst-phase",
    label: "Phase 1 — Analyst Fan-out begins. 7 analysts dispatched (5 concurrent).",
  },
})
  .tap(setupPhase1Memos)
  .parallel(
    {
      fundamentals: fundamentalsAnalyst,
      sentiment: sentimentAnalyst,
      news: newsAnalyst,
      technical: technicalAnalyst,
      companyProfile: companyProfileAnalyst,
      market: marketAnalyst,
      macro: macroAnalyst,
    },
    { maxConcurrency: 5 },
  );
