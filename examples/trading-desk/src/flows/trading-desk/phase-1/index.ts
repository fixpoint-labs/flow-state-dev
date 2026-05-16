/**
 * `phase1Pipeline` — the Phase 1 sub-sequencer.
 *
 * Pre-creates the four memo slots, then runs the four analyst sub-sequencers
 * in parallel. The container `component: "analyst-phase"` is what the
 * transcript pane keys on to render the "Phase 1 — Analyst Fan-out begins"
 * divider; the `label` matches the canonical Design Reference string
 * verbatim so the divider copy is consistent across runs.
 */
import { sequencer } from "@flow-state-dev/core";
import {
  fundamentalsAnalyst,
  newsAnalyst,
  sentimentAnalyst,
  technicalAnalyst,
} from "./analysts";
import { setupPhase1Memos } from "./setup";

export const phase1Pipeline = sequencer({
  name: "phase-1-analysts",
  container: {
    component: "analyst-phase",
    label: "Phase 1 — Analyst Fan-out begins. 4 analysts dispatched in parallel.",
  },
})
  .tap(setupPhase1Memos)
  .parallel(
    {
      fundamentals: fundamentalsAnalyst,
      sentiment: sentimentAnalyst,
      news: newsAnalyst,
      technical: technicalAnalyst,
    },
    { maxConcurrency: 4 },
  );
