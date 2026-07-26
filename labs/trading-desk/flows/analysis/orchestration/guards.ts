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
import { memoResources, phase2Contributions } from "../resources";
import { financialsDataResource } from "../financials-data-resource";
import { clearRecoveryForSession } from "../tools/runtime/critical-financials-recovery";
import { quantDataResource } from "../quant-data-resource";
import { technicalDataResource } from "../technical-data-resource";
import { profileDataResource } from "../profile-data-resource";
import { priceHistoryResource } from "../price-history-resource";
import { valuationSpineResource } from "../valuation-spine-resource";
import { decisionSnapshotResource } from "../decision-snapshot-resource";
import { rewardToRiskResource } from "../reward-to-risk-resource";
import { lensConvergenceResource } from "../agents/lenses/lens-convergence-resource";
import { specialInstructionsStateSchema } from "../special-instructions";
import { specialInstructionsResource } from "../special-instructions-resource";
import { sessionStateSchema } from "../state";
import {
  portfolioMandateResource,
  thesesCollection,
  thesisKey,
} from "../../portfolio/portfolio-resources";
import type { ThesisRecord } from "@/domain/portfolio/schema/thesis-schema";
import {
  toleranceToAppetite,
  validatePortfolioMandate,
  type PortfolioMandate,
} from "@/domain/portfolio/schema/portfolio-mandate-schema";
import { buildPortfolioContext, householdTickerWeight } from "../build-portfolio-context";
import type { ClassificationMap } from "@/domain/portfolio/math/portfolio-health";
import { CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON, type FundProfileInput } from "@/domain/portfolio/math/etf-look-through";
import {
  allHeldTickers,
  excludeFixedIncomeFromProfileMap,
  fundsReferencingTickers,
  missingConstituentTickers,
  toFundProfileMap,
} from "@/domain/portfolio/math/etf-profile-map";
import { mostConservativeMandate, resolveMandate } from "../lib/risk-mandate";
import { getRepository } from "@/db/portfolio-db";
import { toAccountStates } from "@/db/repository";
import { classifyInstrument } from "@/domain/portfolio/math/classify-instrument";

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
    theses: thesesCollection,
    // FIX-761 — the durable household mandate. Declared here (the `theses`
    // cross-flow precedent) so the runtime loads it; without the declaration the
    // seed read would never see it.
    portfolioMandate: portfolioMandateResource,
    financialsData: financialsDataResource,
    quantData: quantDataResource,
    technicalData: technicalDataResource,
    profileData: profileDataResource,
    priceHistory: priceHistoryResource,
    valuationSpine: valuationSpineResource,
    decisionSnapshot: decisionSnapshotResource,
    rewardToRisk: rewardToRiskResource,
    lensConvergence: lensConvergenceResource,
    p2Contributions: phase2Contributions,
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
    // Supersede + clear the critical-financials recovery caches (FIX-898) for the
    // WHOLE session FIRST — before the awaited spine reset below — so any prior
    // recovery still in flight (for this OR a different ticker/date on the same
    // session) sees the bumped generation and throws at its write instead of
    // patching `recoveryAudit`/statements back into the just-reset spine during
    // the await. It also makes the re-run re-attempt recovery from scratch (the
    // spine reset alone wouldn't clear the module-level recovery cache).
    clearRecoveryForSession(ctx.session.identity);
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
    await ctx.resources.rewardToRisk.setState(null);
    // Reset the Phase-2 debate transcript and the lens-convergence resource for
    // the same reason. On a full re-run each is refreshed downstream (the
    // round-robin's init tap resets `p2Contributions` to `{ entries: [] }`; the
    // convergence tap re-`patchState`s), but a re-run that STOPS EARLY (an asset /
    // ticker / Phase-1 guard trips before Phase 2 / 2b) never reaches those, so
    // the prior run's transcript and convergence would otherwise be projected onto
    // the new stopped run's artifacts. Reset here so a stopped re-run is honestly
    // debate-blind / lens-blind. `{ entries: [] }` matches the round-robin's own
    // init shape.
    await ctx.resources.p2Contributions.setState({ entries: [] });
    await ctx.resources.lensConvergence.setState(null);
    // Reset the decision-of-record too, so a re-run that stops before the PM
    // commits (or is mid-flight) can't leave the PRIOR run's decision readable —
    // which `adoptThesis` would otherwise save as the current thesis (it only
    // gates on a present `finalRating`). The PM commit re-writes it on a clean
    // run; a stopped re-run correctly has no decision to adopt.
    await ctx.resources.decisionSnapshot.setState(null);

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
    // holdings AND the durable last-known quotes table (FIX-823), both read via
    // the repository (FIX-772). `toAccountStates` nests holdings into the inline-
    // array shape `buildPortfolioContext` consumes. `requireUser: true` guarantees
    // a user; the fallback matches the framework's key resolution.
    const uid = ctx.request.identity.userId ?? "unknown_user";
    const repo = await getRepository();
    const allAccounts = toAccountStates(await repo.getPortfolio(uid));
    const scoped = input.selectedAccountIds.length
      ? allAccounts.filter((a) => input.selectedAccountIds.includes(a.accountId))
      : allAccounts;
    // Last-known prices for the held tickers, from `app.quotes` (FIX-823) instead
    // of the retired `portfolioQuotes` resource. The ticker set is derived server-
    // side from the scoped holdings; an unpriced ticker is simply absent (valuation
    // degrades to unavailable). `snapshotAsOf` is the OLDEST quote `asOf` among the
    // priced rows — honest "as of at least" labeling, replacing the old resource-
    // envelope `fetchedAt`. Table rows only ever hold live prices, so dropping
    // `source`/`fetchedAt` here is safe (there is no fixture row to filter out).
    const heldTickers = [
      ...new Set(scoped.flatMap((a) => a.holdings.map((h) => h.ticker.toUpperCase()))),
    ];
    const quoteRows = await repo.getQuotes(heldTickers);
    const snapshotAsOf = quoteRows.reduce<string | null>(
      (oldest, r) =>
        r.asOf === null ? oldest : oldest === null || r.asOf < oldest ? r.asOf : oldest,
      null,
    );
    // Per-ticker sectors for the compact health block (FIX-762), read-only from
    // the durable `app.instrument_classifications` cache — the seed NEVER triggers
    // Yahoo fetches (a Health-view visit fills the cache; unclassified tickers ride
    // as `Unclassified` here). A read failure must not fail the run — degrade to an
    // empty map and the health block still computes without sectors.
    const heldEquityTickers = [
      ...new Set(
        scoped.flatMap((a) =>
          a.holdings.filter((h) => h.assetType === "equity").map((h) => h.ticker.toUpperCase()),
        ),
      ),
    ];
    const classifications: ClassificationMap = new Map();
    try {
      for (const c of await repo.getInstrumentClassifications(heldEquityTickers)) {
        classifications.set(c.ticker, c.sector);
      }
    } catch (err) {
      console.warn(`[trading-desk] seed: instrument classifications read failed`, err);
    }
    // Stored ETF profiles (FIX-801), read-only from `app.etf_profiles` — the
    // seed NEVER fetches (Decision 1: fetching is the Portfolio pane's job,
    // via `GET /api/portfolio/etf-profiles`).
    //
    // `heldTickersForProfileLookup` is DELIBERATELY BROADER than
    // `isEtfProfileFetchCandidate` (the route's fetch predicate) — it reads
    // EVERY held ticker's profile, not just the currently fetch-eligible ones.
    // `app.etf_profiles` is global reference data, and the pure leaf's
    // fund-detection oracle (`resolveTickerIsFund` in `etf-look-through.ts`)
    // is explicitly designed to let a STORED PROFILE override a stale/
    // mistyped local `assetType` — its layer 1b runs BEFORE a held ticker's
    // own classification is trusted. A ticker still tagged `equity` locally
    // (not yet corrected) but already correctly profiled — fetched earlier by
    // this household, or by another household, since the table is global —
    // needs to be IN this query for the oracle to ever see that evidence.
    // Narrowing the read to fetch-eligible tickers would silently defeat the
    // override: the ticker would never even be looked up, so a mistyped
    // holding would report as a direct name instead of doing look-through
    // (wrong effective exposure and concentration numbers) even though the
    // data to correct it was already sitting in the table (Codex review,
    // FIX-801 sub-PR c — a real correctness bug, not the fetch-side
    // eligibility mismatch the shared predicate above already fixes). Fetch
    // eligibility and READ eligibility are different questions on purpose:
    // fetching costs a shared, budgeted Alpha Vantage unit and must stay
    // strict; reading is a free indexed lookup and should stay permissive so
    // the override case can work at all. `allHeldTickers` is the shared
    // derivation the route's own `GET` handler uses for the identical reason
    // (one helper, not two reimplementations that can drift apart again).
    const scopedHoldings = scoped.flatMap((a) => a.holdings);
    const heldTickersForProfileLookup = allHeldTickers(scopedHoldings);
    let etfProfiles: Map<string, FundProfileInput> = new Map();
    try {
      const rows = await repo.getEtfProfiles(heldTickersForProfileLookup);
      for (const [ticker, profile] of toFundProfileMap(rows)) etfProfiles.set(ticker, profile);
    } catch (err) {
      console.warn(`[trading-desk] seed: ETF profiles read failed`, err);
    }
    // Fund-of-funds constituent broadening (Codex review, FIX-801 sub-PR c,
    // round 12, P1): a held allocation fund's own constituents need to be
    // IN this map too, even when the household doesn't separately hold
    // them, or `resolveTickerIsFund`'s oracle has no evidence for them and
    // reports a fund-of-funds constituent (e.g. VTI inside a held AOA) as
    // an ordinary single-name stock. Call `missingConstituentTickers`
    // EXACTLY ONCE (never loop it) — the leaf only ever needs one level of
    // evidence (see its own docblock for why looping would incorrectly go
    // a level deeper each time, chasing a constituent's own constituents
    // the leaf never consults). Read-only, same Decision-1-style posture
    // as the read above.
    //
    // A SEPARATE try/catch from the read above (Codex review, FIX-801
    // sub-PR c, round 13): the original shared catch let a genuine failure
    // on THIS read silently leave the wrapper profiles from the FIRST read
    // (e.g. AOA) sitting in the map with their constituents (e.g. VTI)
    // never merged in — exactly the "looks complete, isn't" state the round
    // 12 fix exists to prevent, just reached through an error path instead
    // of the original missing-broadening path. On failure, withdraw every
    // wrapper whose fund-of-funds verdict depends on this read
    // (`fundsReferencingTickers`) rather than leave them half-broadened.
    //
    // WITHDRAW by REPLACING with a refusal entry, not by deleting the key
    // (Codex review, FIX-801 sub-PR c round 14 — a real gap in round 13's
    // own fix). Deleting the wrapper's map entry also deletes its OWN fund
    // evidence: if the wrapper's local `assetType` is stale/mistyped (not
    // fund-typed), `resolveTickerIsFund`'s layer 1a can't prove it's a fund
    // either, and with the stored profile now gone (layer 1b) the oracle
    // falls all the way to layer 1c — the wrapper's own non-fund
    // classification — reporting it as an ordinary direct stock (a
    // fabricated single-name concentration) instead of a diversified,
    // now-opaque fund. `CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON` is
    // recognized by layer 1b as positive fund evidence (same bucket as
    // `"ineligible"`/`"malformed"`), so the wrapper still reads as a fund —
    // just one whose constituents can't currently be verified, so it falls
    // back to whatever "opaque, no decomposition" already produces (see
    // `etf-look-through.ts`'s `if (profile.payload === null)` branch), the
    // same safe default a ticker that was never looked up at all gets.
    const missingConstituents = missingConstituentTickers(etfProfiles);
    if (missingConstituents.length > 0) {
      try {
        const constituentRows = await repo.getEtfProfiles(missingConstituents);
        for (const [ticker, profile] of toFundProfileMap(constituentRows)) {
          etfProfiles.set(ticker, profile);
        }
      } catch (err) {
        console.warn(`[trading-desk] seed: ETF profile constituent broadening read failed`, err);
        for (const ticker of fundsReferencingTickers(etfProfiles, missingConstituents)) {
          etfProfiles.set(ticker, { payload: null, refusalReason: CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON });
        }
      }
    }
    // The broad read above intentionally still looks up a bond ETF (or a
    // holding since manually reclassified to fixed_income) — but a stored
    // profile surviving that read is not itself permission to attribute
    // through it. Suppress those tickers from the map the leaf actually
    // decomposes (Codex review, FIX-801 sub-PR c) — see the function's own
    // docblock for why this is a narrower, different check than the fetch
    // predicate, and why it is judged by the DOMINANT (largest-market-value)
    // lot rather than an "any row" test (round 14). Applied LAST, after the
    // constituent broadening above, so a directly-held bond ETF that also
    // happens to be another held fund's constituent stays excluded either
    // way — the constituent pass could otherwise re-add an entry this
    // exclusion already removed.
    const quoteMap = new Map(quoteRows.map((r) => [r.ticker, { price: r.price }]));
    etfProfiles = excludeFixedIncomeFromProfileMap(etfProfiles, scopedHoldings, quoteMap);
    const portfolio = buildPortfolioContext(
      scoped,
      quoteRows.map((r) => ({ ticker: r.ticker, price: r.price, asOf: r.asOf })),
      snapshotAsOf,
      classifications,
      etfProfiles,
    );

    // Durable household portfolio mandate (FIX-761), read from the user-scoped
    // `portfolioMandate` resource and frozen for the run. Presence is a REQUIRED
    // field (`createdAt`), NOT `!= null`: the engine normalizes an absent/cleared
    // single resource to `{}`. Seed RE-RUNS `validatePortfolioMandate` on the
    // frozen record and degrades to mandate-blind if it reports any issue (§4.5) —
    // a cheap pure call that catches a schema-valid-but-business-invalid record (a
    // hand-authored fixture, a manual seed, a record written before a rule was
    // added). A stale/unknown `riskAppetite` id is NOT a validation issue (it is a
    // save-only guard), so such a record keeps its constraints and only the
    // appetite degrades to null below. Never throws.
    const rawMandate = ctx.resources.portfolioMandate.state as
      | PortfolioMandate
      | null
      | undefined;
    const mandatePresent =
      rawMandate != null && typeof rawMandate.createdAt === "string";
    const portfolioMandate =
      mandatePresent && validatePortfolioMandate(rawMandate as PortfolioMandate).length === 0
        ? (rawMandate as PortfolioMandate)
        : null;

    // Household weight of the analyzed ticker (FIX-761) — the reference the
    // household `maxPositionWeightPct` cap + exclusion no-add measure against.
    // Computed from the pre-scoping `allAccounts` snapshot, so a scoped run still
    // measures a HOUSEHOLD cap against the whole book. When nothing is scoped the
    // `portfolio` snapshot already IS the household; only a scoped run needs the
    // pre-scoping recompute (an extra quote read for the full held set).
    let householdSnapshot = portfolio;
    if (input.selectedAccountIds.length && allAccounts.length) {
      const householdTickers = [
        ...new Set(allAccounts.flatMap((a) => a.holdings.map((h) => h.ticker.toUpperCase()))),
      ];
      const householdQuoteRows = await repo.getQuotes(householdTickers);
      householdSnapshot = buildPortfolioContext(
        allAccounts,
        householdQuoteRows.map((r) => ({ ticker: r.ticker, price: r.price, asOf: r.asOf })),
        null,
      );
    }
    const householdTickerWeightPct = householdTickerWeight(householdSnapshot, input.ticker);

    // Resolve the effective risk-appetite mandate: a per-run override wins; else
    // the most-conservative default among the selected accounts (all accounts when
    // none are selected); else the IPS household appetite — the explicit
    // `riskAppetite`, or DERIVED 1:1 from `objectives.riskTolerance` so a normal
    // IPS that sets only a tolerance still steers the FIX-752 gate (a set tolerance
    // never resolves to a null appetite); else null (mandate-blind). Frozen as the
    // full dial object so the reward-to-risk tap and PM commit read it without
    // re-resolving. An unknown / stale stored id resolves to null, never throws.
    const riskMandate =
      resolveMandate(input.riskMandate) ??
      mostConservativeMandate(scoped.map((a) => a.riskMandate)) ??
      resolveMandate(
        portfolioMandate?.riskAppetite ??
          toleranceToAppetite(portfolioMandate?.objectives?.riskTolerance),
      );

    // Standing per-position thesis for this name (FIX-760), read from the
    // user-scoped `theses` collection (household × ticker, flowIsolation:false →
    // cross-flow) and frozen onto state. The trader (P3) + PM (P5) read it via
    // the `standingThesis` preset; the analysts stay blind. Null → thesis-blind
    // run. The key upper-cases the ticker (the holdings canonicalization).
    const thesisRef = await ctx.resources.theses.getOptional(thesisKey(input.ticker));
    const standingThesis = (thesisRef?.state as ThesisRecord | undefined) ?? null;

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
      // Reset the Phase-2 citation-integrity report (written by the post-debate
      // tap). A re-run that stops before Phase 2 would otherwise carry the prior
      // run's report; the tap re-writes it on a full run.
      citationIntegrity: null,
      userThesis,
      userThesisRationale: userThesis === null ? null : input.userThesisRationale,
      userThesisWarning,
      // Portfolio snapshot computed server-side from user-scoped accounts + quotes
      // (was: input.portfolio). Null → portfolio-blind run.
      portfolio,
      selectedAccountIds: input.selectedAccountIds,
      // Effective risk-appetite mandate (FIX-752), frozen for the run.
      riskMandate,
      // Standing per-position thesis (FIX-760), frozen for the run. Null →
      // thesis-blind.
      standingThesis,
      // Durable household portfolio mandate (FIX-761), frozen for the run. Null →
      // mandate-blind (absent, cleared, or business-invalid).
      portfolioMandate,
      // Household weight of the analyzed ticker, frozen so the PM commit's policy
      // gate measures the household cap/exclusion against the full book.
      householdTickerWeightPct,
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
 * a bond CUSIP, an OCC option, or a `BTC-USD` crypto pair would otherwise be run
 * through the equity pipeline and produce a confident hallucinated stock report.
 * Classify the symbol by shape (no provider call, the `classifyInstrument` leaf
 * the importers use) and, when it is one of those UNAMBIGUOUSLY non-equity shapes,
 * patch `stoppedReason: "unsupported-asset-type"` so the following `.exitIf` bails
 * before any model spend — the FIX-605 no-hallucination discipline, extended to
 * asset type.
 *
 * Runs BEFORE `checkTickerResolvable` (no provider call needed): a bond CUSIP or
 * a crypto pair would otherwise fail the equity fundamentals probe and stop as
 * the less-accurate "unresolvable-ticker".
 *
 * Only bond / option / crypto stop here — those shapes can never be a real
 * exchange ticker. A ticker-shaped symbol (including ETFs, and the cash-equivalent
 * placeholders `CASH` / `USD` that are themselves real tickers — Pathward, a
 * ProShares ETF) passes to the resolution guard next, which is the right arbiter
 * for whether a real instrument exists. FIX-777 is the issue that opens ETF /
 * crypto analysis, at which point the crypto stop is lifted.
 */
export const checkAssetTypeSupported = handler({
  name: "check-asset-type-supported",
  inputSchema: analyzeInputSchema,
  outputSchema: z.void(),
  sessionStateSchema,
  execute: async (input, ctx) => {
    const { assetType } = classifyInstrument(input.ticker);
    // Stop ONLY on the unambiguously non-equity symbol shapes: a 9-digit CUSIP,
    // a 21-char OCC option, a `…-USD` crypto pair. These can never be a real
    // exchange ticker. Cash-equivalent / money-market / other are NOT stopped —
    // `CASH` (Pathward) and `USD` (a ProShares ETF) are real tickers, so the
    // provider resolution that runs next is the right arbiter for those.
    if (assetType !== "bond" && assetType !== "option" && assetType !== "crypto") return;
    await ctx.session.patchState({
      stoppedReason: "unsupported-asset-type",
      stoppedMessage:
        `${input.ticker} classifies as ${assetType.replace(/_/g, " ")} — the ` +
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
