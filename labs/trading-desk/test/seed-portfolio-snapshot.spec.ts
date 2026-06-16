/**
 * Tests that `seedSession` computes `state.portfolio` server-side from the
 * app-owned accounts + holdings (read via the repository, FIX-772) and the
 * user-scoped `portfolioQuotes` resource, with no `portfolio` field in the
 * dispatch input.
 *
 * Drives `seedSession` directly via `testBlock` (seeding the repository + the
 * quotes resource so the full analyze pipeline is not required). The repository
 * is mocked to an in-memory PGlite instance; accounts are seeded under the
 * harness's default userId (`"test-user"`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { makeTestRepository, seedAccount } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/src/db/repository";

const repoState = vi.hoisted(() => ({
  repo: null as PortfolioRepository | null,
}));
vi.mock("@/lib/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

import { seedSession } from "../src/flows/analysis/orchestration/guards";
import flow from "../src/flows/analysis/flow";

/** testBlock's default request userId — the household key `seedSession` resolves. */
const TEST_USER = "test-user";
const ACCOUNT_ID = "acc-taxable-01";

/** `portfolioQuotes` resource state keyed at `portfolioQuotes` in user scope. */
const storedQuotes = {
  dataSource: "fixture",
  fetchedAt: "2026-05-06T12:00:00.000Z",
  quotes: [{ ticker: "NVDA", price: 131.4, asOf: "2026-05-06" }],
};

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
      holdings: [{ ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null }],
    });

    const result = await testBlock(seedSession, {
      input: { ...baseInput },
      flow,
      user: { resources: { portfolioQuotes: storedQuotes } },
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

  it("computes state.portfolio scoped to selectedAccountIds when provided", async () => {
    const ACCOUNT_ID_2 = "acc-roth-02";
    await seedAccount(repoState.repo!, {
      accountId: ACCOUNT_ID,
      userId: TEST_USER,
      name: "Taxable",
      type: "taxable",
      cashBalance: 1000,
      holdings: [{ ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null }],
    });
    await seedAccount(repoState.repo!, {
      accountId: ACCOUNT_ID_2,
      userId: TEST_USER,
      name: "Roth IRA",
      type: "Roth",
      cashBalance: 500,
      holdings: [{ ticker: "AAPL", quantity: 5, costBasis: 200, acquiredDate: null }],
    });

    const result = await testBlock(seedSession, {
      input: { ...baseInput, selectedAccountIds: [ACCOUNT_ID] },
      flow,
      user: { resources: { portfolioQuotes: storedQuotes } },
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

  it("sets portfolio to null when there are no accounts", async () => {
    // Repo seeded with no accounts (fresh in beforeEach); quotes present but irrelevant.
    const result = await testBlock(seedSession, {
      input: { ...baseInput },
      flow,
      user: { resources: { portfolioQuotes: storedQuotes } },
    });

    expect(result.error).toBeNull();

    const sessionState = result.state.session as { portfolio?: unknown };
    expect(sessionState.portfolio).toBeNull();
  });
});
