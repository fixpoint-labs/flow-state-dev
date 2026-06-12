/**
 * Tests that `seedSession` computes `state.portfolio` server-side from the
 * user-scoped `accounts` + `portfolioQuotes` resources, with no `portfolio`
 * field in the dispatch input.
 *
 * Drives `seedSession` directly via `testBlock` (seeding the user-scoped
 * accounts + quotes resources so the full analyze pipeline is not required).
 * The intent: after Task 2, the client DOES NOT pass a `portfolio` field and
 * the server derives the snapshot itself.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { seedSession } from "../src/flows/analysis/orchestration/guards";
import flow from "../src/flows/analysis/flow";

const ACCOUNT_ID = "acc-taxable-01";

/** A minimal account record stored at `accounts/{accountId}` in user scope. */
const storedAccount = {
  accountId: ACCOUNT_ID,
  name: "Taxable",
  type: "taxable",
  currency: "USD",
  cashBalance: 1000,
  holdings: [{ ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** `portfolioQuotes` resource state keyed at `portfolioQuotes` in user scope. */
const storedQuotes = {
  dataSource: "fixture",
  fetchedAt: "2026-05-06T12:00:00.000Z",
  quotes: [{ ticker: "NVDA", price: 131.4, asOf: "2026-05-06" }],
};

describe("seedSession portfolio snapshot (server-side)", () => {
  it("computes state.portfolio from user accounts + quotes without a portfolio dispatch input", async () => {
    const result = await testBlock(seedSession, {
      input: {
        ticker: "NVDA",
        date: "2026-05-06",
        costPreset: "fast" as const,
        dataSource: "fixture" as const,
        userThesis: null,
        userThesisRationale: null,
        riskMandate: null,
        selectedAccountIds: [],
      },
      flow,
      user: {
        resources: {
          // accounts collection: one entry at `accounts/{accountId}`
          [`accounts/${ACCOUNT_ID}`]: storedAccount,
          // single resource
          portfolioQuotes: storedQuotes,
        },
      },
    });

    expect(result.error).toBeNull();

    // The session state after seedSession should have a computed portfolio.
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
    const storedAccount2 = {
      accountId: ACCOUNT_ID_2,
      name: "Roth IRA",
      type: "Roth",
      currency: "USD",
      cashBalance: 500,
      holdings: [{ ticker: "AAPL", quantity: 5, costBasis: 200, acquiredDate: null }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const result = await testBlock(seedSession, {
      input: {
        ticker: "NVDA",
        date: "2026-05-06",
        costPreset: "fast" as const,
        dataSource: "fixture" as const,
        userThesis: null,
        userThesisRationale: null,
        riskMandate: null,
        // Only include the taxable account, not the Roth IRA.
        selectedAccountIds: [ACCOUNT_ID],
      },
      flow,
      user: {
        resources: {
          [`accounts/${ACCOUNT_ID}`]: storedAccount,
          [`accounts/${ACCOUNT_ID_2}`]: storedAccount2,
          portfolioQuotes: storedQuotes,
        },
      },
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
      input: {
        ticker: "NVDA",
        date: "2026-05-06",
        costPreset: "fast" as const,
        dataSource: "fixture" as const,
        userThesis: null,
        userThesisRationale: null,
        riskMandate: null,
        selectedAccountIds: [],
      },
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
    const result = await testBlock(seedSession, {
      input: {
        ticker: "NVDA",
        date: "2026-05-06",
        costPreset: "fast" as const,
        dataSource: "fixture" as const,
        userThesis: null,
        userThesisRationale: null,
        riskMandate: null,
        selectedAccountIds: [],
      },
      flow,
      user: {
        resources: {
          // No accounts stored; portfolioQuotes present but irrelevant.
          portfolioQuotes: storedQuotes,
        },
      },
    });

    expect(result.error).toBeNull();

    const sessionState = result.state.session as { portfolio?: unknown };
    expect(sessionState.portfolio).toBeNull();
  });
});
