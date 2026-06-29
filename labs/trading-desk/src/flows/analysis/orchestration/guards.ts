/**
 * Pipeline guards + standing-instruction writer for the trading-desk flow.
 *
 * These handlers are the orchestration-level wiring that `analyze.ts`
 * composes between the agent stages:
 *
 *   - `seedSession` patches session state from action input. A re-run starts
 *     from a clean navigator because the setup taps re-create each memo in
 *     `pending` (`{ replace: true }`); there is no session-state status mirror
 *     to reset.
 *   - `checkTickerResolvable`, `checkPhase1HasFundamentalsAndProfile`, and
 *     `checkPhase1HasData` are the three stop-condition guards. Each patches
 *     `stoppedReason` + `stoppedMessage` on session state when it trips; the
 *     following `.exitIf` in `analyze.ts` bails out before the next stage, so
 *     a stop is a normal terminal state, not an exceptional condition.
 *   - `setInstructions` persists the user's standing special instructions
 *     (global + per-phase).
 *
 * They live here (not in `flow.ts`) so `flow.ts` is the bare `defineFlow`
 * contract and the execution-order knowledge stays inside `orchestration/`.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { ALL_MEMO_KEYS, PHASE_1_MEMO_KEYS } from "../registry";
import { analyzeInputSchema } from "../flow-schema";
import { resolveTicker } from "../lib/ticker-resolver";
import { memoResources } from "../resources";
import { financialsDataResource } from "../financials-data-resource";
import { quantDataResource } from "../quant-data-resource";
import { technicalDataResource } from "../technical-data-resource";
import { profileDataResource } from "../profile-data-resource";
import { priceHistoryResource } from "../price-history-resource";
import { valuationSpineResource } from "../valuation-spine-resource";
import { specialInstructionsStateSchema } from "../special-instructions";
import { specialInstructionsResource } from "../special-instructions-resource";
import { sessionStateSchema } from "../state";
import { portfolioQuotesResource } from "../../portfolio/portfolio-resources";
import { buildPortfolioContext } from "../build-portfolio-context";
import { mostConservativeMandate, resolveMandate } from "../lib/risk-mandate";
import { getRepository } from "@/lib/portfolio-db";
import { toAccountStates } from "@/src/db/repository";
import { classifyInstrument } from "../../portfolio/classify-instrument";

/**
 * Patches session state from action input and clears any memos a prior run
 * left on this session, so a re-run starts from a clean navigator.
 *
 * The memos collection is the navigator's live status source now (no
 * `memoStatus` session mirror), and a stop guard can exit the pipeline before
 * any per-phase setup re-creates the `pending` scaffolds — `checkTickerResolvable`
 * runs immediately after this seed and `.exitIf`-bails before `setupPhase1Memos`.
 * So the prior-run reset has to happen here, not lean on the setup taps. (The
 * old `memoStatus: {}` reset did the equivalent for the retired mirror.)
 */
export const seedSession = handler({
  name: "seed-session",
  inputSchema: analyzeInputSchema,
  outputSchema: analyzeInputSchema,
  sessionStateSchema,
  resources: {
    portfolioQuotes: portfolioQuotesResource,
    financialsData: financialsDataResource,
    quantData: quantDataResource,
    technicalData: technicalDataResource,
    profileData: profileDataResource,
    priceHistory: priceHistoryResource,
    valuationSpine: valuationSpineResource,
    ...memoResources,
  },
  execute: async (input, ctx) => {
    // Clear any memos persisted by a prior run on this session. `delete` is
    // idempotent (no-op, no event, for a key that doesn't exist), so a first
    // run is unaffected; a re-run starts the navigator from an all-pending
    // slate that the per-phase setups then re-create.
    for (const { collectionKey } of Object.values(ALL_MEMO_KEYS)) {
      await ctx.resources.memos.delete(collectionKey);
    }

    // Reset the financials data spine so a re-run on the same session refetches
    // rather than reusing a prior run's payloads. `getOrPatchState` treats a
    // present field as a hit, so without this clear the Phase 1 financials tools
    // would skip their fetch on every re-run (the old process cache aged out
    // after its TTL; the spine persists for the session's life). Resetting to
    // `{}` makes every field absent — a miss the tools recompute. Idempotent on
    // a first run (state is already `{}`, so the write is skipped). The quant /
    // technical / profile spines are reset for the same reason.
    await ctx.resources.financialsData.setState({});
    await ctx.resources.quantData.setState({});
    await ctx.resources.technicalData.setState({});
    await ctx.resources.profileData.setState({});

    // Reset the DERIVED surfaces too, so a re-run that fails to recompute them
    // (e.g. compute-spine returns early on missing financials, or the price tap
    // hits a spine miss and returns) doesn't leave the prior run's valuation
    // envelope or price chart on screen. compute-spine / store-price-history
    // re-patch the full object on a successful run. (A reset nullable single
    // persists as {}; the Summary reads guard on a required field, so it degrades
    // exactly as for an unwritten resource.)
    await ctx.resources.priceHistory.setState(null);
    await ctx.resources.valuationSpine.setState(null);

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

    // Portfolio snapshot, computed server-side from the app-owned accounts +
    // holdings (read via the repository, FIX-772) and the last-known quotes
    // resource. `toAccountStates` nests holdings into the inline-array shape
    // `buildPortfolioContext` consumes — same snapshot as the prior resource read.
    const allAccounts = toAccountStates(
      await (await getRepository()).getPortfolio(
        // `requireUser: true` guarantees a user; the fallback matches the
        // framework's key resolution and satisfies the optional type.
        ctx.request.identity.userId ?? "unknown_user",
      ),
    );
    const scoped = input.selectedAccountIds.length
      ? allAccounts.filter((a) => input.selectedAccountIds.includes(a.accountId))
      : allAccounts;
    const q = ctx.resources.portfolioQuotes.state; // nullable single-resource read
    const portfolio = buildPortfolioContext(scoped, q?.quotes ?? [], q?.fetchedAt ?? null);

    // Resolve the effective risk-appetite mandate (FIX-752): a per-run override
    // wins; else the most-conservative default among the selected accounts (all
    // accounts when none are selected, mirroring the snapshot scoping above);
    // else null (mandate-blind). Frozen as the full dial object so the
    // reward-to-risk tap and the PM commit read it without re-resolving — the
    // `portfolio`-snapshot precedent. An unknown / stale stored id resolves to
    // null, never throws.
    const riskMandate =
      resolveMandate(input.riskMandate) ??
      mostConservativeMandate(scoped.map((a) => a.riskMandate));

    await ctx.session.patchState({
      ticker: input.ticker,
      date: input.date,
      costPreset: input.costPreset,
      dataSource: input.dataSource,
      activePhase: "idle",
      // Cheap preset runs one bull/bear round; full preset runs two. Caller
      // input never sets this — the schema's `max(2)` enforces the ceiling.
      maxDebateRounds: input.costPreset === "full" ? 2 : 1,
      runComplete: false,
      // Reset terminal stop state from any prior run on this session key
      // so the navigator doesn't render a stale "stopped" banner.
      stoppedReason: null,
      stoppedMessage: null,
      userThesis,
      userThesisRationale: userThesis === null ? null : input.userThesisRationale,
      userThesisWarning,
      // Portfolio snapshot computed server-side from user-scoped accounts + quotes
      // (was: input.portfolio). Null → portfolio-blind run.
      portfolio,
      selectedAccountIds: input.selectedAccountIds,
      // Effective risk-appetite mandate (FIX-752), frozen for the run.
      riskMandate,
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
 * Pre-flight asset-type gate (FIX-773). The analyst bench researches equities;
 * a non-equity symbol (a bond CUSIP, an OCC option, a `BTC-USD` crypto pair, a
 * cash line) would otherwise be run through the equity pipeline and produce a
 * confident hallucinated stock report. Classify the symbol by shape (no provider
 * call, the `classifyInstrument` leaf the importers use) and, when it is not an
 * equity-class instrument, patch `stoppedReason: "unsupported-asset-type"` so the
 * following `.exitIf` bails before any model spend — the FIX-605 no-hallucination
 * discipline, extended to asset type.
 *
 * Runs after `checkTickerResolvable`: a symbol that resolves to a price but is a
 * bond/option/crypto/cash still stops here. Equity AND etf pass (a ticker-shaped
 * symbol classifies as `equity` from shape alone — precise ETF tagging is a later
 * provider concern, and FIX-777 is the issue that opens ETF/crypto analysis, at
 * which point this allow-list widens).
 */
export const checkAssetTypeSupported = handler({
  name: "check-asset-type-supported",
  inputSchema: analyzeInputSchema,
  outputSchema: z.void(),
  sessionStateSchema,
  execute: async (input, ctx) => {
    const { assetType } = classifyInstrument(input.ticker);
    if (assetType === "equity" || assetType === "etf") return;
    await ctx.session.patchState({
      stoppedReason: "unsupported-asset-type",
      stoppedMessage:
        `${input.ticker} classifies as a ${assetType.replace(/_/g, " ")} — the ` +
        "analyst bench researches equities only. Analysis of this asset type is " +
        "not supported yet.",
      runComplete: true,
    });
    // Badge the reports-index row so Past Reports renders the stopped run
    // distinctly. Additive metadata merge — the four tuple keys are preserved.
    await ctx.session.setMetadata({
      metadata: { reportStatus: "stopped" },
    });
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
 * Persists the user's standing special instructions (global + per-phase) to
 * the user-scoped `specialInstructionsResource`.
 */
export const setInstructions = handler({
  name: "set-instructions",
  inputSchema: specialInstructionsStateSchema,
  outputSchema: z.void(),
  resources: { specialInstructions: specialInstructionsResource },
  execute: async (input, ctx) => {
    await ctx.resources.specialInstructions.patchState(input);
  },
});
