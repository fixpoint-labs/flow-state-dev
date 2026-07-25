/**
 * Tests that `seedSession` computes `state.portfolio` server-side from the
 * app-owned accounts + holdings AND the durable `app.quotes` table (FIX-772/
 * FIX-823), with no `portfolio` field in the dispatch input.
 *
 * Drives `seedSession` directly via `testBlock` (seeding the repository —
 * accounts, holdings, AND quotes — so the full analyze pipeline is not required).
 * The repository is mocked to an in-memory PGlite instance; accounts are seeded
 * under the harness's default userId (`"test-user"`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testBlock, testFlow } from "@flow-state-dev/testing";
import { makeTestRepository, seedAccount } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/db/repository";

const repoState = vi.hoisted(() => ({
  repo: null as PortfolioRepository | null,
}));
vi.mock("@/db/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

// FIX-801: the seed reads `app.etf_profiles` READ-ONLY and must never fetch —
// mocking the fetcher module lets the "spends no Alpha Vantage request" test
// assert this structurally, not just by inspecting `guards.ts`'s import list.
const fetchEtfProfileMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/providers/etf-profile", () => ({
  fetchEtfProfile: fetchEtfProfileMock,
}));

import { seedSession } from "../flows/analysis/orchestration/guards";
import flow from "../flows/analysis/flow";
import { sessionStateSchema } from "../flows/analysis/state";

const seedResetFlow = defineFlow({
  kind: "seed-reset-test",
  requireUser: true,
  actions: { seed: { block: seedSession } },
  session: { stateSchema: sessionStateSchema },
  resources: flow.resources,
})();

/** testBlock's default request userId — the household key `seedSession` resolves. */
const TEST_USER = "test-user";
const ACCOUNT_ID = "acc-taxable-01";

/** Seed the durable `app.quotes` last-known-price row the snapshot values from
 *  (FIX-823 — replaces the retired `portfolioQuotes` resource seed). */
async function seedNvdaQuote(): Promise<void> {
  await repoState.repo!.upsertQuotes([
    { ticker: "NVDA", price: 131.4, asOf: "2026-05-06T00:00:00.000Z", source: "live" },
  ]);
}

const baseInput = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast" as const,
  dataSource: "fixture" as const,
  userThesis: null,
  userThesisRationale: null,
  riskMandate: null,
  selectedAccountIds: [] as string[],
};

beforeEach(async () => {
  repoState.repo = await makeTestRepository();
});

describe("seedSession portfolio snapshot (server-side)", () => {
  it("computes state.portfolio from user accounts + quotes without a portfolio dispatch input", async () => {
    await seedAccount(repoState.repo!, {
      accountId: ACCOUNT_ID,
      userId: TEST_USER,
      name: "Taxable",
      type: "taxable",
      cashBalance: 1000,
      holdings: [{ ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } }],
    });
    await seedNvdaQuote();

    const result = await testBlock(seedSession, {
      input: { ...baseInput },
      flow,
    });

    expect(result.error).toBeNull();

    const sessionState = result.state.session as {
      portfolio?: {
        holdings: Array<{ ticker: string }>;
        accounts: Array<{ id: string }>;
        totalNav: number;
      } | null;
    };

    expect(sessionState.portfolio).not.toBeNull();
    expect(sessionState.portfolio?.holdings.map((h) => h.ticker)).toContain("NVDA");
    expect(sessionState.portfolio?.accounts).toHaveLength(1);
    // NAV = 10 × 131.4 + 1000 cash = 2314
    expect(sessionState.portfolio?.totalNav).toBeCloseTo(2314);
  });

  it("injects the household-health block + holdings sector from the classification cache (FIX-762)", async () => {
    await seedAccount(repoState.repo!, {
      accountId: ACCOUNT_ID,
      userId: TEST_USER,
      name: "Taxable",
      type: "taxable",
      cashBalance: 1000,
      holdings: [{ ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } }],
    });
    await seedNvdaQuote();
    // The seed reads sectors read-only from the durable cache (never fetches Yahoo).
    await repoState.repo!.upsertInstrumentClassifications([
      { ticker: "NVDA", sector: "Technology", source: "yahoo" },
    ]);

    const result = await testBlock(seedSession, { input: { ...baseInput }, flow });
    expect(result.error).toBeNull();

    const sessionState = result.state.session as {
      portfolio?: {
        holdings: Array<{ ticker: string; sector: string | null }>;
        health: { cashPct: number | null; concentration: { maxPosition: { ticker: string } | null } } | null;
      } | null;
    };
    // The dead holdings[].sector field now carries the cached sector.
    expect(sessionState.portfolio?.holdings.find((h) => h.ticker === "NVDA")?.sector).toBe("Technology");
    // The compact health block is populated (NAV 2314; cash 1000 → ~43.2%).
    expect(sessionState.portfolio?.health).not.toBeNull();
    expect(sessionState.portfolio?.health?.cashPct).toBeCloseTo((1000 / 2314) * 100);
    expect(sessionState.portfolio?.health?.concentration.maxPosition?.ticker).toBe("NVDA");
  });

  it("injects the ETF look-through second axis from stored fund profiles, READ-ONLY — never fetches (FIX-801 Decision 1)", async () => {
    await seedAccount(repoState.repo!, {
      accountId: ACCOUNT_ID,
      userId: TEST_USER,
      name: "Taxable",
      type: "taxable",
      cashBalance: 0,
      holdings: [
        { ticker: "AAPL", quantity: 100, costBasis: 90, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } },
        { ticker: "SPY", quantity: 150, costBasis: 300, acquiredDate: null, assetClass: "equity", assetType: "etf", attributes: { kind: "none" } },
      ],
    });
    await repoState.repo!.upsertQuotes([
      { ticker: "AAPL", price: 100, asOf: "2026-05-06T00:00:00.000Z", source: "live" },
      { ticker: "SPY", price: 400, asOf: "2026-05-06T00:00:00.000Z", source: "live" },
    ]);
    // The profile is already WARMED (as if the Portfolio pane had visited it) —
    // the seed only ever reads this table, per Decision 1.
    await repoState.repo!.upsertEtfProfiles([
      {
        ticker: "SPY",
        payload: {
          leveraged: false,
          constituents: [
            { ticker: "AAPL", weight: 0.925 },
            { ticker: "MSFT", weight: 0.07 },
          ],
          nameCoverage: 0.995,
          sectors: [
            { sector: "Technology", weight: 0.3 },
            { sector: "Financial Services", weight: 0.66 },
          ],
          sectorCoverage: 0.96,
          netExpenseRatio: 0.0945,
          inceptionDate: "1993-01-22",
        },
        refusalReason: null,
      },
    ]);

    const result = await testBlock(seedSession, { input: { ...baseInput, ticker: "AAPL" }, flow });
    expect(result.error).toBeNull();

    const sessionState = result.state.session as {
      portfolio?: {
        health: {
          lookThrough: { maxPosition: { ticker: string; weightPct: number } | null; coveragePct: number | null } | null;
        } | null;
      } | null;
    };
    const lookThrough = sessionState.portfolio?.health?.lookThrough;
    expect(lookThrough).not.toBeNull();
    // AAPL direct (10,000) + 92.5% of SPY (55,500) = 65,500 of a 70,000 NAV.
    expect(lookThrough?.maxPosition?.ticker).toBe("AAPL");
    expect(lookThrough?.maxPosition?.weightPct).toBeGreaterThan(100 / 7); // > the 14.3% direct-only weight
    expect(lookThrough?.coveragePct).not.toBeNull();

    // The load-bearing assertion: the seed read the STORED profile and never
    // called the fetcher — a run sees look-through only for funds the
    // Portfolio pane already warmed, exactly as Decision 1 requires.
    expect(fetchEtfProfileMock).not.toHaveBeenCalled();
  });

  it("reads a cached profile for a MISTYPED-equity holding, letting the stored profile override a stale classification (Codex review, FIX-801 sub-PR c)", async () => {
    // SPY is held as `assetType: "equity"` — stale/mistyped, not yet
    // corrected by the classifications route. Its profile was already
    // warmed (fetched earlier by this household before the mistype, or by
    // another household, since `app.etf_profiles` is global reference
    // data). The seed's read set must NOT be filtered by fetch-eligibility
    // (`isEtfProfileFetchCandidate` requires `assetType === "etf"`, which a
    // mistyped-equity row fails) — narrowing the read would mean this
    // ticker is never even looked up, so the pure leaf's fund-detection
    // oracle (`resolveTickerIsFund`, layer 1b) never gets the chance to let
    // the stored profile override the stale tag, and SPY would wrongly
    // report as a direct single-name holding instead of doing look-through.
    await seedAccount(repoState.repo!, {
      accountId: ACCOUNT_ID,
      userId: TEST_USER,
      name: "Taxable",
      type: "taxable",
      cashBalance: 0,
      holdings: [
        { ticker: "AAPL", quantity: 100, costBasis: 90, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } },
        { ticker: "SPY", quantity: 150, costBasis: 300, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } },
      ],
    });
    await repoState.repo!.upsertQuotes([
      { ticker: "AAPL", price: 100, asOf: "2026-05-06T00:00:00.000Z", source: "live" },
      { ticker: "SPY", price: 400, asOf: "2026-05-06T00:00:00.000Z", source: "live" },
    ]);
    await repoState.repo!.upsertEtfProfiles([
      {
        ticker: "SPY",
        payload: {
          leveraged: false,
          constituents: [
            { ticker: "AAPL", weight: 0.925 },
            { ticker: "MSFT", weight: 0.07 },
          ],
          nameCoverage: 0.995,
          sectors: [
            { sector: "Technology", weight: 0.3 },
            { sector: "Financial Services", weight: 0.66 },
          ],
          sectorCoverage: 0.96,
          netExpenseRatio: 0.0945,
          inceptionDate: "1993-01-22",
        },
        refusalReason: null,
      },
    ]);

    const result = await testBlock(seedSession, { input: { ...baseInput, ticker: "AAPL" }, flow });
    expect(result.error).toBeNull();

    const sessionState = result.state.session as {
      portfolio?: {
        health: {
          lookThrough: { maxPosition: { ticker: string; weightPct: number } | null; coveragePct: number | null } | null;
        } | null;
      } | null;
    };
    const lookThrough = sessionState.portfolio?.health?.lookThrough;
    // The load-bearing assertion: look-through fired for SPY DESPITE its
    // stale `assetType: "equity"` tag — the stored profile was found and
    // won the evidence-ordering question. Same expected numbers as the
    // correctly-typed sibling test above (AAPL direct 10,000 + 92.5% of SPY
    // 55,500 = 65,500 of 70,000 NAV).
    expect(lookThrough).not.toBeNull();
    expect(lookThrough?.maxPosition?.ticker).toBe("AAPL");
    expect(lookThrough?.maxPosition?.weightPct).toBeGreaterThan(100 / 7);
    expect(lookThrough?.coveragePct).not.toBeNull();
    expect(fetchEtfProfileMock).not.toHaveBeenCalled();
  });

  it("leaves the look-through axis null when a fund is held but its profile has never been fetched — no budget spent finding out", async () => {
    await seedAccount(repoState.repo!, {
      accountId: ACCOUNT_ID,
      userId: TEST_USER,
      name: "Taxable",
      type: "taxable",
      cashBalance: 1000,
      holdings: [
        { ticker: "SPY", quantity: 5, costBasis: 300, acquiredDate: null, assetClass: "equity", assetType: "etf", attributes: { kind: "none" } },
      ],
    });
    await repoState.repo!.upsertQuotes([
      { ticker: "SPY", price: 400, asOf: "2026-05-06T00:00:00.000Z", source: "live" },
    ]);
    // No `upsertEtfProfiles` call — nobody has warmed SPY's profile yet.

    const result = await testBlock(seedSession, { input: { ...baseInput, ticker: "SPY" }, flow });
    expect(result.error).toBeNull();

    const sessionState = result.state.session as {
      portfolio?: { health: { lookThrough: unknown } | null } | null;
    };
    expect(sessionState.portfolio?.health?.lookThrough).toBeNull();
    expect(fetchEtfProfileMock).not.toHaveBeenCalled();
  });

  it("computes state.portfolio scoped to selectedAccountIds when provided", async () => {
    const ACCOUNT_ID_2 = "acc-roth-02";
    await seedAccount(repoState.repo!, {
      accountId: ACCOUNT_ID,
      userId: TEST_USER,
      name: "Taxable",
      type: "taxable",
      cashBalance: 1000,
      holdings: [{ ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } }],
    });
    await seedAccount(repoState.repo!, {
      accountId: ACCOUNT_ID_2,
      userId: TEST_USER,
      name: "Roth IRA",
      type: "Roth",
      cashBalance: 500,
      holdings: [{ ticker: "AAPL", quantity: 5, costBasis: 200, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } }],
    });
    await seedNvdaQuote();

    const result = await testBlock(seedSession, {
      input: { ...baseInput, selectedAccountIds: [ACCOUNT_ID] },
      flow,
    });

    expect(result.error).toBeNull();

    const sessionState = result.state.session as {
      portfolio?: {
        holdings: Array<{ ticker: string }>;
        accounts: Array<{ id: string }>;
      } | null;
    };

    // Only the taxable account (NVDA) should be in the snapshot.
    expect(sessionState.portfolio?.accounts).toHaveLength(1);
    expect(sessionState.portfolio?.accounts[0]?.id).toBe(ACCOUNT_ID);
    expect(sessionState.portfolio?.holdings.map((h) => h.ticker)).toContain("NVDA");
    expect(sessionState.portfolio?.holdings.map((h) => h.ticker)).not.toContain("AAPL");
  });

  it("clears memos a prior run left on the session so a re-run starts clean", async () => {
    // The navigator reads memo status live off the collection (no memoStatus
    // mirror). A stop guard can exit before any phase setup re-creates the
    // scaffolds, so seedSession itself must clear prior-run memos — otherwise a
    // re-run keeps rendering the previous run's published/error states.
    const result = await testBlock(seedSession, {
      input: { ...baseInput },
      flow,
      session: {
        resources: {
          // A memo left `published` by a prior run on this same session.
          "memos/p1/fundamentals": {
            status: "published",
            agentName: "fundamentalsAnalyst",
            agentTeam: "analyst",
            phaseId: "p1",
            ticker: "NVDA",
            date: "2026-05-06",
          },
        },
      },
    });

    expect(result.error).toBeNull();
    const clearedFundamentals = result.items.some(
      (item) =>
        (item as { type?: string }).type === "resource_change" &&
        (item as { resourcePath?: string }).resourcePath === "memos/p1/fundamentals" &&
        (item as { changeType?: string }).changeType === "deleted",
    );
    expect(clearedFundamentals).toBe(true);
  });

  it("clears reward-to-risk from a prior run before a stopped re-run", async () => {
    const stores = createInMemoryStores();
    const sessionId = "stale-reward-to-risk";
    const result = await testFlow({
      flow: seedResetFlow,
      action: "seed",
      input: { ...baseInput },
      userId: TEST_USER,
      sessionId,
      stores,
      seed: {
        session: {
          resources: {
            rewardToRisk: {
              expectedValuePct: 4,
              expectedGainPct: 8,
              expectedLossPct: -2,
              glr: 4,
              lossAdjustedGlr: 2,
              worstCaseReturnPct: -10,
              noDownside: false,
              evidenceBasis: "sufficient",
              lossAversion: 2,
              mandateId: "balanced",
            },
          },
        },
      },
    });

    expect(result.error).toBeUndefined();
    // Nullable single resources persist their reset value as an empty object;
    // the schema hydrates that representation back to null for consumers.
    expect(
      await stores.resourceState.get("session", sessionId, "rewardToRisk"),
    ).toEqual({});
  });

  it("sets portfolio to null when there are no accounts", async () => {
    // Repo seeded with no accounts (fresh in beforeEach); no held tickers → the
    // quotes read returns [] and the snapshot is null regardless.
    const result = await testBlock(seedSession, {
      input: { ...baseInput },
      flow,
    });

    expect(result.error).toBeNull();

    const sessionState = result.state.session as { portfolio?: unknown };
    expect(sessionState.portfolio).toBeNull();
  });
});
