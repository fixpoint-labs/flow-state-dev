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
import { getQuotes } from "./portfolio/get-quotes";
import {
  deleteAccount,
  deleteHolding,
  importHoldings,
  saveAccount,
} from "./portfolio/portfolio-actions";
import { extractHoldingsFromPdf } from "./portfolio/extract-holdings-action";
import { portfolioQuotesResource } from "./portfolio/portfolio-quotes-resource";
import { pdfImportResource } from "./portfolio/portfolio-pdf-resource";
import { accountsCollection } from "./portfolio/portfolio-resources";
import {
  memosCollection,
  phase2Contributions,
} from "./resources";
import { specialInstructionsResource } from "./special-instructions-resource";
import { sessionStateSchema } from "./state";
import { valuationSpineResource } from "./valuation-spine-resource";

export { sessionStateSchema, type SessionState } from "./state";
export { analyzeInputSchema, type AnalyzeInput } from "./flow-schema";

const tradingDeskFlow = defineFlow({
  kind: "trading-desk",
  requireUser: true,

  actions: {
    analyze: { block: analyze },
    setInstructions: { block: setInstructions },
    // Portfolio (Slice 4 / Spine B). User-scoped resource mutations + a
    // read-only price fetch. None drives the analysis pipeline.
    saveAccount: { block: saveAccount },
    deleteAccount: { block: deleteAccount },
    importHoldings: { block: importHoldings },
    deleteHolding: { block: deleteHolding },
    getQuotes: { block: getQuotes },
    // PDF holdings import (Slice 4b). The LLM transcription step; writes the
    // extracted rows to `pdfImport` for the dialog to reconcile + confirm. The
    // confirmed rows feed the EXISTING `importHoldings` — this action never
    // imports.
    extractHoldingsFromPdf: { block: extractHoldingsFromPdf },
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
    // Portfolio domain (Slice 4 / Spine B). One user-scoped collection keyed by
    // accountId (flowIsolation: false → bare `{userId}`, shared across flows);
    // persists on the existing filesystem store. Holdings live inline in each
    // account record — see `portfolio/portfolio-resources.ts`.
    accounts: accountsCollection,
    // User-scoped per-user last-known-quotes cache written by `getQuotes`
    // (flowIsolation: false → readable cross-flow); the Portfolio pane reads it
    // via `useResource` after a refresh. Not a durable snapshot.
    portfolioQuotes: portfolioQuotesResource,
    // Transient per-session PDF-extraction channel written by
    // `extractHoldingsFromPdf`; the import dialog reads it via `useResource` to
    // reconcile + preview before the user confirms. Not a durable record.
    pdfImport: pdfImportResource,
  },
});

const flow = tradingDeskFlow({ id: "default" });

export default flow;
