/**
 * The trading-desk flow definition.
 *
 * This file is the bare `defineFlow` contract — actions, resources, and
 * session-state shape. The execution-order knowledge lives in
 * `orchestration/`: `analyze` is the main pipeline (seed → guards → agent
 * stages → gated thesis audit), and `setInstructions` is the standing
 * special-instructions writer.
 *
 * Session-scope client data is exposed via `client.expose` so navigator
 * status (`memoStatus`) reflects mid-stream `state_change` items in the
 * client's `useClientData` hook.
 */
import { defineFlow } from "@flow-state-dev/core";
import { decisionSnapshotResource } from "./decision-snapshot-resource";
import { analyze } from "./orchestration/analyze";
import { setInstructions } from "./orchestration/guards";
import { lensConvergenceResource } from "./agents/lenses/lens-convergence-resource";
import { priceHistoryResource } from "./price-history-resource";
import {
  accountsCollection,
  portfolioQuotesResource,
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
        "memoStatus",
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
    // Portfolio domain (Spine B), owned + written by the
    // `portfolio` flow. Declared here READ-ONLY: `seedSession`
    // reads the shared user-scoped `accounts` (flowIsolation: false → bare
    // `{userId}`) and the last-known `portfolioQuotes` to compute the per-run
    // portfolio snapshot. Declaring them makes `resolveUserStorageKey` derive
    // the same bare key both flows use — no client bridge.
    accounts: accountsCollection,
    portfolioQuotes: portfolioQuotesResource,
  },
});

const flow = analysisFlow({ id: "default" });

export default flow;
