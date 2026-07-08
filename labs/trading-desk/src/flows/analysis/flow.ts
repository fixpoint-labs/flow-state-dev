/**
 * The trading-desk flow definition.
 *
 * This file is the bare `defineFlow` contract — actions, resources, and
 * session-state shape. The execution-order knowledge lives in
 * `orchestration/`: `analyze` is the main pipeline (seed → guards → agent
 * stages → gated thesis audit), and `setInstructions` is the standing
 * special-instructions writer.
 *
 * Session-scope client data is exposed via `client.expose` for the header
 * inputs, run lifecycle, and stop banner. Per-memo navigator status is NOT
 * exposed here — it streams live off the memos collection itself
 * (`client: { live: true }`), read via `useResourceCollectionList`.
 */
import { defineFlow } from "@flow-state-dev/core";
import { decisionSnapshotResource } from "./decision-snapshot-resource";
import { analyze } from "./orchestration/analyze";
import { setInstructions } from "./orchestration/guards";
import { runSummaryAction } from "./orchestration/run-summary-action";
import { adoptThesis } from "./orchestration/adopt-thesis-action";
import { lensConvergenceResource } from "./agents/lenses/lens-convergence-resource";
import { priceHistoryResource } from "./price-history-resource";
import { financialsDataResource } from "./financials-data-resource";
import { quantDataResource } from "./quant-data-resource";
import { technicalDataResource } from "./technical-data-resource";
import { profileDataResource } from "./profile-data-resource";
import { rewardToRiskResource } from "./reward-to-risk-resource";
import {
  portfolioQuotesResource,
  thesesCollection,
} from "../portfolio/portfolio-resources";
import {
  memosCollection,
  phase2Contributions,
} from "./resources";
import { specialInstructionsResource } from "./special-instructions-resource";
import { sessionStateSchema } from "./state";
import { valuationSpineResource } from "./valuation-spine-resource";

export { sessionStateSchema, type SessionState } from "./state";
export { analyzeInputSchema, type AnalyzeInput } from "./flow-schema";

const analysisFlow = defineFlow({
  kind: "analysis",
  requireUser: true,

  actions: {
    analyze: { block: analyze },
    setInstructions: { block: setInstructions },
    // Zero-model read action: projects the current session's decision snapshot,
    // memos, and stop-state into a machine-readable RunSummary. The headless
    // harness invokes this after `analyze` to read back what happened.
    runSummary: { block: runSummaryAction },
    // Adopt the current report's decision as the standing thesis for the position
    // (FIX-760) — derives the thesis from the session's decision snapshot and
    // writes it to the user-scoped `theses` resource collection with the report
    // linkage.
    adoptThesis: { block: adoptThesis },
  },

  session: {
    stateSchema: sessionStateSchema,
    client: {
      expose: [
        "ticker",
        "date",
        "costPreset",
        "dataSource",
        "activePhase",
        "maxDebateRounds",
        "runComplete",
        "stoppedReason",
        "stoppedMessage",
        "userThesis",
        "userThesisRationale",
        "userThesisWarning",
      ],
    },
  },

  resources: {
    memos: memosCollection,
    // Phase 2 transcript — shared by the round-robin, the consolidator
    // generators, and the `tradingDesk` capability's stance/debate presets.
    p2Contributions: phase2Contributions,
    // User-scoped standing instructions (flowIsolation: false → bare
    // `{userId}`, shared across flows). Declared here so `resolveUserStorageKey`
    // derives the storage key; the capability's `core` preset also declares it
    // for runtime context access.
    specialInstructions: specialInstructionsResource,
    // Financials data spine — the subject's raw fundamentals + statements,
    // written once by the fundamentals analyst's tools via `getOrPatchState`
    // and read back by the valuation tap as a stable per-session copy (replaces
    // the process TTL cache for these subject-scoped payloads). Declared at the
    // root so nested tool handlers resolve it from `ctx.resources`.
    financialsData: financialsDataResource,
    // Quant / technical / profile spines — the other Phase 1 payloads the
    // valuation tap re-reads (composites + factor ranks, indicators, profile),
    // written by their tools via `getOrPatchState`. Same per-domain pattern.
    quantData: quantDataResource,
    technicalData: technicalDataResource,
    profileData: profileDataResource,
    // Valuation spine — computed after Phase 1, read by Phases 2–5.
    valuationSpine: valuationSpineResource,
    // Lens convergence — computed deterministically after the phase-2b lens
    // pack (full preset only), read by the PM as a sizing-conviction input and
    // by the PmHero lens strip. Nullable; null on `fast` runs (pack skipped).
    lensConvergence: lensConvergenceResource,
    // Price-history slice — persisted after Phase 1, read by the Summary page's
    // price overlay via `useResource(session, "priceHistory")`.
    priceHistory: priceHistoryResource,
    // Decision-of-record snapshot — written once at PM-commit; the durable
    // audit record Past Reports and outcome tracking read.
    decisionSnapshot: decisionSnapshotResource,
    // Reward-to-risk figure (FIX-752) — derived from the scenario buckets after
    // Phase 5a, read by the PM as `<rewardToRisk>` context and re-read by the PM
    // commit to gate size against the active mandate. Nullable; null when the
    // forecaster produced no usable buckets.
    rewardToRisk: rewardToRiskResource,
    // Last-known quotes cache (Spine B), owned + written by the `portfolio`
    // flow. Declared here READ-ONLY: `seedSession` reads the shared user-scoped
    // `portfolioQuotes` (flowIsolation: false → bare `{userId}`) to price the
    // per-run portfolio snapshot. Accounts + holdings are no longer resources —
    // `seedSession` reads them from the app-owned tables via the repository
    // (FIX-772).
    portfolioQuotes: portfolioQuotesResource,
    // Per-position thesis records (FIX-760) — user-scoped collection owned by the
    // portfolio flow. Declared here so the seed can read the standing thesis and
    // `adoptThesis` can write it (flowIsolation:false → cross-flow shared).
    theses: thesesCollection,
  },
});

const flow = analysisFlow({ id: "default" });

export default flow;
