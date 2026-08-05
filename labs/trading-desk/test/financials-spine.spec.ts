/**
 * Tests for the financials data spine (FIX-758 rescope).
 *
 * Intent encoded: the subject's financial payloads are fetched once into a
 * session-scoped resource and the valuation tap reads that stable copy — there
 * is no process TTL cache in this path anymore.
 *
 *   1. The four financials tools (fundamentals + three statements) write their
 *      payload through `getOrPatchState` into the `financialsData` resource.
 *   2. `computeAndStoreSpine` reads those payloads back off `financialsData`
 *      (not a warm cache) and produces the `valuationSpine`.
 *
 * Driven through `testFlow` against an in-memory store — the tools run as steps
 * to populate the spine, then the tap runs — and both persisted resources are
 * read back via `stores.resourceState.getAll`, the same inspection path the
 * price-history and past-reports specs use.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { createInMemoryStores, toBareStates } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import { makeTestRepository } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/db/repository";

// `seedSession` reads accounts/holdings from the app-owned repository (FIX-772).
// Mock it to a fresh in-memory PGlite per test so the `seed` action doesn't open
// the persisted `.fsdev/pglite` dir (which fails on a clean CI checkout). This
// spec doesn't seed accounts — an empty repo makes the run portfolio-blind,
// which is irrelevant to the financials-reset behavior under test.
const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/db/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));
beforeEach(async () => {
  repoState.repo = await makeTestRepository();
});
import { get_fundamentals } from "../flows/analysis/tools/data/get_fundamentals";
import { get_balance_sheet } from "../flows/analysis/tools/data/get_balance_sheet";
import { get_income_statement } from "../flows/analysis/tools/data/get_income_statement";
import { get_cashflow } from "../flows/analysis/tools/data/get_cashflow";
import { get_quant_composites } from "../flows/analysis/tools/data/get_quant_composites";
import { get_factor_ranks } from "../flows/analysis/tools/data/get_factor_ranks";
import { compute_indicators } from "../flows/analysis/tools/data/compute_indicators";
import { get_company_profile } from "../flows/analysis/tools/data/get_company_profile";
import { get_price_history } from "../flows/analysis/tools/data/get_price_history";
import { computeAndStoreSpine } from "../flows/analysis/compute-spine";
import { storePriceHistory } from "../flows/analysis/store-price-history";
import { seedSession } from "../flows/analysis/orchestration/guards";
import { financialsDataResource } from "../flows/analysis/financials-data-resource";
import { quantDataResource } from "../flows/analysis/quant-data-resource";
import { technicalDataResource } from "../flows/analysis/technical-data-resource";
import { profileDataResource } from "../flows/analysis/profile-data-resource";
import { valuationSpineResource } from "../flows/analysis/valuation-spine-resource";
import { priceHistoryResource } from "../flows/analysis/price-history-resource";
import { lensConvergenceResource } from "../flows/analysis/agents/lenses/lens-convergence-resource";
import { phase2Contributions } from "../flows/analysis/resources";
import { sessionStateSchema } from "../flows/analysis/state";

// Fetch all eight Phase-1 valuation inputs into their per-domain spines, then
// compute the valuation off them. The tools run in `.parallel` — exactly how
// the analysts fan them out — so the four financials tools patch the shared
// `financialsData` resource concurrently (per-resource write serialization must
// keep every field, or compute-spine sees nulls), while the quant / technical /
// profile tools populate their own spines.
const fillInputs = sequencer({
  name: "fill-inputs",
  inputSchema: z.object({ ticker: z.string(), date: z.string() }),
})
  .parallel({
    fundamentals: get_fundamentals,
    balanceSheet: get_balance_sheet,
    incomeStatement: get_income_statement,
    cashflow: get_cashflow,
    quantComposites: get_quant_composites,
    factorRanks: get_factor_ranks,
    indicators: compute_indicators,
    companyProfile: get_company_profile,
    // The technical analyst's price fetch — populates technicalData.priceBars
    // (subject + summary range) that store-price-history then thins.
    priceBars: get_price_history,
  })
  .step(computeAndStoreSpine)
  // Persist the derived price chart too, so the re-run reset test has both
  // derived surfaces (valuationSpine + priceHistory) populated to clear.
  .step(storePriceHistory);

// Writes the Phase-2 / 2b substrate through the RESOURCE API (proper version
// records), so a subsequent seedSession reset transitions from a real prior-run
// state — the way a live run populates these, not a raw store seed.
const stashDebateSubstrate = handler({
  name: "stash-debate-substrate",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: { lensConvergence: lensConvergenceResource, p2Contributions: phase2Contributions },
  execute: async (_input, ctx) => {
    await ctx.resources.p2Contributions.setState({
      entries: [{ round: 1, agentName: "bullResearcher", text: "STALE prior-run turn." }],
    });
    await ctx.resources.lensConvergence.setState({
      classification: "convergent",
      netLean: 0.5,
      agreementScore: 0.9,
      dissenters: [],
    });
    await ctx.session.patchState({
      citationIntegrity: { tagsChecked: 3, tagsValid: 2, invalidTags: [] },
    });
  },
});

const spineFlow = defineFlow({
  kind: "trading-desk-financials-spine-test",
  actions: {
    fillAndCompute: { block: fillInputs },
    seed: { block: seedSession },
    fetchFundamentals: { block: get_fundamentals },
    stashDebateSubstrate: { block: stashDebateSubstrate },
  },
  session: { stateSchema: sessionStateSchema },
  resources: {
    financialsData: financialsDataResource,
    quantData: quantDataResource,
    technicalData: technicalDataResource,
    profileData: profileDataResource,
    valuationSpine: valuationSpineResource,
    priceHistory: priceHistoryResource,
    lensConvergence: lensConvergenceResource,
    p2Contributions: phase2Contributions,
  },
})({ id: "test" });

const seedInput = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  userThesis: null,
  userThesisRationale: null,
  selectedAccountIds: [] as string[],
  riskMandate: null,
};

const baseState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-1" as const,
  maxDebateRounds: 1,
  runComplete: false,
};

describe("financials data spine", () => {
  it("parallel tools fill the four per-domain spines without clobber; the tap reads all eight inputs to build valuationSpine", async () => {
    const stores = createInMemoryStores();
    const sessionId = "financials-spine-fixture";

    const result = await testFlow({
      flow: spineFlow,
      action: "fillAndCompute",
      userId: "test-user",
      sessionId,
      stores,
      input: { ticker: "NVDA", date: "2026-05-06" },
      seed: { session: { state: baseState } },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const resources = toBareStates(await stores.resourceState.getAll("session", sessionId));

    // 1. Each tool wrote its payload into its domain spine (one field per tool).
    const financials = resources["financialsData"] as Record<string, unknown> | undefined;
    expect(financials?.fundamentals).toBeTruthy();
    expect(financials?.balanceSheet).toBeTruthy();
    expect(financials?.incomeStatement).toBeTruthy();
    expect(financials?.cashflow).toBeTruthy();
    const quant = resources["quantData"] as Record<string, unknown> | undefined;
    expect(quant?.quantComposites).toBeTruthy();
    expect(quant?.factorRanks).toBeTruthy();
    const tech = resources["technicalData"] as Record<string, unknown> | undefined;
    expect(tech?.indicators).toBeTruthy();
    const profile = resources["profileData"] as Record<string, unknown> | undefined;
    expect(profile?.companyProfile).toBeTruthy();

    // 2. The tap read all eight inputs off the spines (not a warm cache) and
    //    produced the valuation spine for the same subject — with a setup score
    //    that only resolves when the quant / factor / technical inputs are present.
    const spine = resources["valuationSpine"] as {
      ticker?: string;
      envelope?: unknown;
      setupScore?: { evidenceBasis?: string };
    } | null | undefined;
    expect(spine).toBeTruthy();
    expect(spine?.setupScore?.evidenceBasis).toBe("sufficient");
    expect(spine?.ticker).toBe("NVDA");
    expect(spine?.envelope).toBeTruthy();
  });

  it("seedSession resets financialsData so a re-run refetches instead of reusing stale payloads", async () => {
    const stores = createInMemoryStores();
    const sessionId = "financials-rerun";

    // First run populates the spine through the real path (valid fixture data).
    const first = await testFlow({
      flow: spineFlow,
      action: "fillAndCompute",
      userId: "test-user",
      sessionId,
      stores,
      input: { ticker: "NVDA", date: "2026-05-06" },
      seed: { session: { state: baseState } },
    });
    expect(first.error).toBeUndefined();
    const afterFill = toBareStates(await stores.resourceState.getAll("session", sessionId));
    expect((afterFill["financialsData"] as Record<string, unknown>)?.fundamentals).toBeTruthy();
    // The derived surfaces are populated by the run (compute-spine + the price tap).
    expect(afterFill["valuationSpine"]).toBeTruthy();
    expect(afterFill["priceHistory"]).toBeTruthy();

    // Re-running the analysis on the same session seeds first — which must clear
    // the raw spine so the Phase 1 tools refetch rather than treat the prior run's
    // payloads as hits (the old TTL cache aged out; the spine does not), AND clear
    // the derived surfaces so a re-run that fails to recompute can't leave the
    // prior run's valuation envelope / price chart on screen.
    const second = await testFlow({
      flow: spineFlow,
      action: "seed",
      userId: "test-user",
      sessionId,
      stores,
      input: seedInput,
    });
    expect(second.error).toBeUndefined();

    const afterSeed = toBareStates(await stores.resourceState.getAll("session", sessionId));
    expect(afterSeed["financialsData"]).toEqual({});
    // The derived surfaces are cleared: the prior run's valuation envelope and
    // price chart are gone. (A reset nullable single persists as {} — the
    // documented "nullable single surfaces as {}" form; the Summary's spine/chart
    // reads guard on a required field, so {} degrades exactly like null.)
    expect(afterSeed["valuationSpine"]).toEqual({});
    expect(afterSeed["priceHistory"]).toEqual({});
  });

  it("seedSession clears the Phase-2 debate transcript, lens convergence, and citation integrity so an early-stopped re-run is not projected with the prior run's substrate", async () => {
    const stores = createInMemoryStores();
    const sessionId = "debate-lens-rerun";

    // A completed prior run's Phase-2 / 2b substrate, written through the resource
    // API so seedSession's reset transitions from a real prior state.
    const stashed = await testFlow({
      flow: spineFlow,
      action: "stashDebateSubstrate",
      userId: "test-user",
      sessionId,
      stores,
      input: {},
      seed: { session: { state: baseState } },
    });
    expect(stashed.error).toBeUndefined();

    // A re-run that stops early (e.g. the asset-type guard) seeds first and never
    // reaches Phase 2 / 2b, so the reset must happen in seedSession itself.
    const seeded = await testFlow({
      flow: spineFlow,
      action: "seed",
      userId: "test-user",
      sessionId,
      stores,
      input: seedInput,
    });
    expect(seeded.error).toBeUndefined();

    const afterSeed = toBareStates(await stores.resourceState.getAll("session", sessionId));
    // The transcript is reset to the round-robin's own init shape — no prior turn.
    expect(afterSeed["p2Contributions"]).toEqual({ entries: [] });
    // Lens convergence is cleared: whatever the stored representation (absent /
    // {} / null after a nullable-single reset), it no longer carries the prior
    // run's classification, so `buildRunArtifacts` projects it as absent.
    const lens = afterSeed["lensConvergence"] as { classification?: unknown } | undefined;
    expect(lens?.classification).toBeUndefined();
    // Citation integrity is cleared from session state.
    const session = await stores.session.get(sessionId);
    expect((session?.state as { citationIntegrity?: unknown }).citationIntegrity).toBeNull();
  });

  it("a non-subject ticker fetches directly and never overwrites the subject's spine payload", async () => {
    const stores = createInMemoryStores();
    const sessionId = "financials-cross-ticker";

    // Subject = NVDA. Populate the spine.
    const fill = await testFlow({
      flow: spineFlow,
      action: "fillAndCompute",
      userId: "test-user",
      sessionId,
      stores,
      input: { ticker: "NVDA", date: "2026-05-06" },
      seed: { session: { state: baseState } },
    });
    expect(fill.error).toBeUndefined();
    const subjectFundamentals = (
      (toBareStates(await stores.resourceState.getAll("session", sessionId)))["financialsData"] as {
        fundamentals?: unknown;
      }
    ).fundamentals;
    expect(subjectFundamentals).toBeTruthy();

    // A call for a DIFFERENT ticker (AAPL) on the same NVDA session — e.g. a
    // hypothetical peer lookup. The fixed spine key must NOT hand back NVDA's
    // payload labeled as AAPL.
    const cross = await testFlow({
      flow: spineFlow,
      action: "fetchFundamentals",
      userId: "test-user",
      sessionId,
      stores,
      input: { ticker: "AAPL", date: "2026-05-06" },
    });
    expect(cross.error).toBeUndefined();

    // It returned AAPL's data (different from NVDA's)...
    expect(cross.output).toBeTruthy();
    expect(cross.output).not.toEqual(subjectFundamentals);
    // ...and the subject's spine payload is untouched (not overwritten with AAPL).
    const afterCross = (
      (toBareStates(await stores.resourceState.getAll("session", sessionId)))["financialsData"] as {
        fundamentals?: unknown;
      }
    ).fundamentals;
    expect(afterCross).toEqual(subjectFundamentals);
  });
});
