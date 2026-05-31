/**
 * `phase1Pipeline` — the Phase 1 sub-sequencer.
 *
 * Pre-creates the six memo slots, then runs the six analyst sub-sequencers
 * in parallel. The container `component: "analyst-phase"` is what the
 * transcript pane keys on to render the "Phase 1 — Analyst Fan-out begins"
 * divider; the `label` matches the canonical Design Reference string
 * verbatim so the divider copy is consistent across runs.
 */
import { sequencer } from "@flow-state-dev/core";
import {
  companyProfileAnalyst,
  fundamentalsAnalyst,
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
    label: "Phase 1 — Analyst Fan-out begins. 6 analysts dispatched (4 concurrent).",
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
    },
    { maxConcurrency: 4 },
  );
