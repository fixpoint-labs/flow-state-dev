/**
 * The trading-desk flow.
 *
 * `analyze` is the main entry point. It seeds session state, runs two
 * stop-condition guards (unresolvable ticker, then post-Phase-1
 * all-errored), and finally chains the five phase pipelines. Each guard
 * patches `stoppedReason` + `stoppedMessage` on session state when it
 * trips, and the following `.exitIf` bails out before the next phase —
 * so a stop is a normal terminal state, not an exceptional condition.
 *
 * `setInstructions` persists the user's standing special instructions
 * (global + per-phase). Edits take effect on the next analyze run; the
 * running session's prompts are already built and untouched.
 *
 * Session-scope client data is exposed via `client.expose` so navigator
 * status (`memoStatus`) reflects mid-stream `state_change` items in the
 * client's `useClientData` hook.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_1_MEMO_KEYS } from "./registry";
import { computeAndStoreSpine } from "./compute-spine";
import { decisionSnapshotResource } from "./decision-snapshot-resource";
import { analyzeInputSchema } from "./flow-schema";
import { phase1Pipeline } from "./phase-1";
import { phase2Pipeline } from "./phase-2";
import { phase2bPipeline } from "./phase-2b";
import { resetLensConvergence } from "./agents/lenses/writer";
import { lensConvergenceResource } from "./agents/lenses/lens-convergence-resource";
import { phase3Pipeline } from "./phase-3";
import { phase4Pipeline } from "./phase-4";
import { phase5Pipeline, scenarioForecasterPipeline } from "./phase-5";
import { phase6Pipeline } from "./phase-6";
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
import { resolveTicker } from "./lib/ticker-resolver";
import { storePriceHistory } from "./store-price-history";
import {
  memoResources,
  memosCollection,
  phase2Contributions,
  type MemoStatus,
} from "./resources";
import { specialInstructionsStateSchema } from "./special-instructions";
import { specialInstructionsResource } from "./special-instructions-resource";
import { sessionStateSchema } from "./state";
import { valuationSpineResource } from "./valuation-spine-resource";

export { sessionStateSchema, type SessionState } from "./state";
export { analyzeInputSchema, type AnalyzeInput } from "./flow-schema";

/**
 * Patches session state from action input and resets the memo-status
 * mirror so a re-run starts from a clean navigator.
 */
const seedSession = handler({
  name: "seed-session",
  inputSchema: analyzeInputSchema,
  outputSchema: analyzeInputSchema,
  sessionStateSchema,
  execute: async (input, ctx) => {
    // Freeze the per-run thesis at seed time so editing the form mid-run
    // can't affect the session that's already analyzing. A non-null
    // `userThesis` gates Phase 6; a sub-threshold (< 20 chars) thesis is
    // treated as no thesis — Phase 6 is skipped and a soft warning is
    // surfaced rather than halting.
    const rawThesis = input.userThesis?.trim() ?? "";
    const hasUsableThesis = rawThesis.length >= 20;
    const userThesis = hasUsableThesis ? rawThesis : null;
    const userThesisWarning =
      rawThesis.length > 0 && !hasUsableThesis
        ? "Thesis too short to audit (under 20 characters) — Phase 6 skipped."
        : null;

    await ctx.session.patchState({
      ticker: input.ticker,
      date: input.date,
      costPreset: input.costPreset,
      dataSource: input.dataSource,
      activePhase: "idle",
      // Cheap preset runs one bull/bear round; full preset runs two. Caller
      // input never sets this — the schema's `max(2)` enforces the ceiling.
      maxDebateRounds: input.costPreset === "full" ? 2 : 1,
      memoStatus: {} as Record<string, MemoStatus>,
      runComplete: false,
      // Reset terminal stop state from any prior run on this session key
      // so the navigator doesn't render a stale "stopped" banner.
      stoppedReason: null,
      stoppedMessage: null,
      userThesis,
      userThesisRationale: userThesis === null ? null : input.userThesisRationale,
      userThesisWarning,
      // Freeze the per-run portfolio snapshot (Slice 5), same discipline as
      // `userThesis`. Null → portfolio-blind run. The pipeline (P1–P2) runs
      // blind; only the lens pack, the trader, and the PM read it.
      portfolio: input.portfolio,
      selectedAccountIds: input.selectedAccountIds,
    });
    return input;
  },
});

/**
 * Pre-flight ticker resolution. Probes the active data source for the
 * requested ticker; if it can't be resolved (missing fixture / all live
 * providers down), patches `stoppedReason: "unresolvable-ticker"` so the
 * following `.exitIf` bails before any model spend.
 */
export const checkTickerResolvable = handler({
  name: "check-ticker-resolvable",
  inputSchema: analyzeInputSchema,
  outputSchema: z.void(),
  sessionStateSchema,
  execute: async (input, ctx) => {
    const result = await resolveTicker(input);
    if (!result.resolved) {
      await ctx.session.patchState({
        stoppedReason: "unresolvable-ticker",
        stoppedMessage:
          result.reason ?? `Could not resolve ticker ${input.ticker}.`,
        runComplete: true,
      });
      // Badge the reports-index row so Past Reports renders a stopped run
      // distinctly. Additive metadata merge — the four tuple keys are preserved.
      await ctx.session.setMetadata({
        metadata: { reportStatus: "stopped" },
      });
    }
  },
});

/**
 * Post-Phase-1 data-quality check. If every analyst memo is in `error`,
 * patches `stoppedReason: "phase-1-no-data"` so the following `.exitIf`
 * bails before phases 2–5 synthesize on no data.
 */
export const checkPhase1HasData = handler({
  name: "check-phase-1-has-data",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (_input, ctx) => {
    const memoStatuses = await Promise.all(
      Object.values(PHASE_1_MEMO_KEYS).map(
        async (m) => (await ctx.resources.memos.getOptional(m.collectionKey))?.state.status,
      ),
    );
    const allErrored = memoStatuses.every((status) => status === "error");
    if (allErrored) {
      await ctx.session.patchState({
        stoppedReason: "phase-1-no-data",
        stoppedMessage:
          `Every Phase 1 analyst failed for ${ctx.session.state.ticker}. ` +
          "Halting before synthesis — no usable upstream data.",
        runComplete: true,
      });
      // Badge the reports-index row (see checkTickerResolvable). Additive merge.
      await ctx.session.setMetadata({
        metadata: { reportStatus: "stopped" },
      });
    }
  },
});

/**
 * Post-Phase-1 primary-analyst check. `fundamentals` and `companyProfile`
 * are the only non-substitutable analysts — the debate (Phase 2) and every
 * downstream phase reason from the company's identity and its financials, so
 * a missing one can't be papered over by the four other memos. If either
 * errored, patch `stoppedReason: "phase-1-missing-primary"` so the following
 * `.exitIf` halts before synthesis. This fires on the realistic partial
 * failure (one provider rate-limited) that `checkPhase1HasData`'s all-error
 * condition would miss.
 */
export const checkPhase1HasFundamentalsAndProfile = handler({
  name: "check-phase-1-has-fundamentals-and-profile",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (_input, ctx) => {
    const erroredAt = async (collectionKey: string) =>
      (await ctx.resources.memos.getOptional(collectionKey))?.state.status === "error";
    const fundamentalsErrored = await erroredAt(PHASE_1_MEMO_KEYS.fundamentals.collectionKey);
    const profileErrored = await erroredAt(PHASE_1_MEMO_KEYS.companyProfile.collectionKey);
    if (!fundamentalsErrored && !profileErrored) return;
    const which = [
      fundamentalsErrored && "fundamentals",
      profileErrored && "companyProfile",
    ]
      .filter(Boolean)
      .join(" + ");
    await ctx.session.patchState({
      stoppedReason: "phase-1-missing-primary",
      stoppedMessage:
        `Non-substitutable Phase 1 analyst failed (${which}) for ` +
        `${ctx.session.state.ticker}. Halting before synthesis.`,
      runComplete: true,
    });
    // Badge the reports-index row (see checkTickerResolvable). Additive merge.
    await ctx.session.setMetadata({
      metadata: { reportStatus: "stopped" },
    });
  },
});

/**
 * The `analyze` pipeline. Three `.tap` + `.exitIf` pairs implement
 * defense-in-depth against degenerate inputs and upstream data failure (see
 * the `checkTickerResolvable` / `checkPhase1HasFundamentalsAndProfile` /
 * `checkPhase1HasData` doc comments). The primary-analyst guard runs before
 * the all-error backstop: a partial failure that loses a non-substitutable
 * analyst halts even when the other four succeeded.
 */
const analyzePipeline = sequencer({
  name: "trading-desk-analyze",
  inputSchema: analyzeInputSchema,
})
  .step(seedSession)
  .tap(checkTickerResolvable)
  .exitIf((_v, ctx) => ctx.session.state.stoppedReason !== null)
  .step(phase1Pipeline)
  .tap(checkPhase1HasFundamentalsAndProfile)
  .exitIf((_v, ctx) => ctx.session.state.stoppedReason !== null)
  .tap(checkPhase1HasData)
  .exitIf((_v, ctx) => ctx.session.state.stoppedReason !== null)
  .tap(computeAndStoreSpine)
  // Persist a thinned price-history slice for the Summary overlay. Reads the
  // warm cache the technical analyst already populated — no extra fetch.
  .tap(storePriceHistory)
  .step(phase2Pipeline)
  // Phase 2b — investor-lens pack (Slice 5). Pre-decision: runs after Phase 2
  // and before Phase 3 so convergence is a context input the PM reasons with.
  // COST-GATED on the `full` preset only (RISK-F3): N parallel heavy generators
  // multiply token spend, so a `fast` run skips the pack entirely (no memos, no
  // convergence resource). On `fast`, the PM still emits `portfolioFit` — just
  // without a convergence-derived `convictionBasis`.
  //
  // Reset any prior convergence FIRST, unconditionally (outside the gate), so a
  // re-run never surfaces a stale read. Not reachable today (costPreset is in the
  // keying tuple, so a session's preset is fixed) — defensive against a future
  // tuple change. The `full` pack then overwrites it; `fast` leaves it null.
  .tap(resetLensConvergence)
  .stepIf((_v, ctx) => ctx.session.state.costPreset === "full", phase2bPipeline)
  .step(phase3Pipeline)
  .step(phase4Pipeline)
  .step(scenarioForecasterPipeline)
  .step(phase5Pipeline)
  // Phase 6 — post-decision thesis audit. Only runs when the caller supplied
  // a usable thesis at seed time; otherwise the pipeline ends at the PM.
  .stepIf(
    (_v, ctx) => ctx.session.state.userThesis !== null,
    phase6Pipeline,
  );

/**
 * Persists the user's standing special instructions (global + per-phase) to
 * the user-scoped, flow-isolated `specialInstructionsResource`.
 */
const setInstructions = handler({
  name: "set-instructions",
  inputSchema: specialInstructionsStateSchema,
  outputSchema: z.void(),
  resources: { specialInstructions: specialInstructionsResource },
  execute: async (input, ctx) => {
    await ctx.resources.specialInstructions.patchState(input);
  },
});

const tradingDeskFlow = defineFlow({
  kind: "trading-desk",
  requireUser: true,

  actions: {
    analyze: { block: analyzePipeline },
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
    // User-scoped, flow-isolated standing instructions. Declared here so
    // `resolveUserStorageKey` picks up `flowIsolation: true` for storage-key
    // derivation; the capability's `core` preset also declares it for
    // runtime context access.
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
    // Portfolio domain (Slice 4 / Spine B). One user-scoped, flow-isolated
    // collection keyed by accountId; persists under `{userId}:trading-desk` on
    // the existing filesystem store. Holdings live inline in each account record
    // — see `portfolio/portfolio-resources.ts`.
    accounts: accountsCollection,
    // Transient per-session price cache written by `getQuotes`; the Portfolio
    // pane reads it via `useResource` after a refresh. Not a durable snapshot.
    portfolioQuotes: portfolioQuotesResource,
    // Transient per-session PDF-extraction channel written by
    // `extractHoldingsFromPdf`; the import dialog reads it via `useResource` to
    // reconcile + preview before the user confirms. Not a durable record.
    pdfImport: pdfImportResource,
  },
});

const flow = tradingDeskFlow({ id: "default" });

export default flow;
