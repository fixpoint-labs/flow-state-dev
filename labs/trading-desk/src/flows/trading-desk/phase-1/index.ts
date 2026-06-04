/**
 * `phase1Pipeline` — the Phase 1 sub-sequencer.
 *
 * Pre-creates the nine memo slots, then runs the nine analyst sub-sequencers
 * in parallel. The container `component: "analyst-phase"` is what the
 * transcript pane keys on to render the "Phase 1 — Analyst Fan-out begins"
 * divider; the `label` matches the canonical Design Reference string
 * verbatim so the divider copy is consistent across runs.
 */
import { sequencer } from "@flow-state-dev/core";
import {
  companyProfileAnalyst,
  disclosureAnalyst,
  fundamentalsAnalyst,
  macroAnalyst,
  marketAnalyst,
  newsAnalyst,
  quantAnalyst,
  sentimentAnalyst,
  technicalAnalyst,
} from "../agents/analysts/analysts";
import { setupPhase1Memos } from "../agents/analysts/setup";

export const phase1Pipeline = sequencer({
  name: "phase-1-analysts",
  container: {
    component: "analyst-phase",
    label: "Phase 1 — Analyst Fan-out begins. 9 analysts dispatched (6 concurrent).",
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
      quant: quantAnalyst,
      disclosure: disclosureAnalyst,
    },
    { maxConcurrency: 6 },
  );
