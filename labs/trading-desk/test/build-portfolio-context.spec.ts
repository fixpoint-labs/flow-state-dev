/**
 * `buildPortfolioContext` — the load-bearing Slice-4 → flow-input mapping.
 *
 * Real-money guarantees under test: a missing live price degrades to null
 * marketValue/weight (NEVER fabricated), NAV counts only known values + cash,
 * coverage counts are honest, and an empty account list returns null
 * (portfolio-blind).
 */
import { describe, expect, it } from "vitest";
import { buildPortfolioContext } from "../src/flows/trading-desk/build-portfolio-context";
import type { AccountState } from "../src/flows/trading-desk-portfolio/portfolio-schema";

function account(over: Partial<AccountState> = {}): AccountState {
  return {
    accountId: "acc-1",
    name: "Roth IRA",
    type: "Roth",
    currency: "USD",
    cashBalance: 0,
    holdings: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("buildPortfolioContext", () => {
  it("returns null when there are no accounts (portfolio-blind)", () => {
    expect(buildPortfolioContext([], [], null)).toBeNull();
  });

  it("computes marketValue, NAV and weights from quantity × live price + cash", () => {
    const accounts = [
      account({
        accountId: "acc-roth",
        name: "Roth IRA",
        cashBalance: 1000,
        holdings: [
          { ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null },
          { ticker: "AAPL", quantity: 20, costBasis: 150, acquiredDate: null },
        ],
      }),
    ];
    const quotes = [
      { ticker: "NVDA", price: 200, asOf: "2026-05-06" },
      { ticker: "AAPL", price: 100, asOf: "2026-05-06" },
    ];
    const out = buildPortfolioContext(accounts, quotes, "2026-05-06T12:00:00.000Z");
    expect(out).not.toBeNull();
    // NVDA mv = 10×200 = 2000; AAPL mv = 20×100 = 2000; cash 1000 → NAV 5000.
    expect(out?.totalNav).toBe(5000);
    expect(out?.pricedHoldings).toBe(2);
    expect(out?.totalHoldings).toBe(2);
    expect(out?.snapshotAsOf).toBe("2026-05-06T12:00:00.000Z");
    const nvda = out?.holdings.find((h) => h.ticker === "NVDA");
    expect(nvda?.marketValue).toBe(2000);
    expect(nvda?.weightPct).toBeCloseTo((2000 / 5000) * 100); // 40%
  });

  it("degrades an unpriced holding to null marketValue/weight and excludes it from NAV", () => {
    const accounts = [
      account({
        accountId: "acc-tax",
        name: "Taxable",
        type: "taxable",
        cashBalance: 500,
        holdings: [
          { ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null },
          { ticker: "ZZZZ", quantity: 5, costBasis: 10, acquiredDate: null }, // no quote
        ],
      }),
    ];
    const quotes = [{ ticker: "NVDA", price: 200, asOf: "2026-05-06" }];
    const out = buildPortfolioContext(accounts, quotes, "2026-05-06");
    // NAV = NVDA 2000 + cash 500 = 2500 (the unpriced ZZZZ adds nothing).
    expect(out?.totalNav).toBe(2500);
    expect(out?.pricedHoldings).toBe(1);
    expect(out?.totalHoldings).toBe(2);
    const zzzz = out?.holdings.find((h) => h.ticker === "ZZZZ");
    expect(zzzz?.marketValue).toBeNull();
    expect(zzzz?.weightPct).toBeNull(); // never fabricated
  });

  it("handles accounts with cash but no holdings (NAV = cash, weights all null)", () => {
    const accounts = [account({ cashBalance: 10000, holdings: [] })];
    const out = buildPortfolioContext(accounts, [], "2026-05-06");
    expect(out?.totalNav).toBe(10000);
    expect(out?.totalHoldings).toBe(0);
    expect(out?.pricedHoldings).toBe(0);
    expect(out?.holdings).toEqual([]);
    expect(out?.accounts).toHaveLength(1);
    expect(out?.accounts[0]).toMatchObject({ label: "Roth IRA", type: "Roth", cash: 10000 });
  });

  it("never divides by zero — weight is null when NAV is 0", () => {
    // All holdings unpriced and no cash → NAV 0 → every weight null.
    const accounts = [
      account({
        cashBalance: 0,
        holdings: [{ ticker: "ZZZZ", quantity: 5, costBasis: 10, acquiredDate: null }],
      }),
    ];
    const out = buildPortfolioContext(accounts, [], "2026-05-06");
    expect(out?.totalNav).toBe(0);
    expect(out?.holdings[0]?.weightPct).toBeNull();
  });
});
