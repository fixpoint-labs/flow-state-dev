/**
 * `buildPortfolioContext` — the load-bearing Slice-4 → flow-input mapping.
 *
 * Real-money guarantees under test: a missing live price degrades to null
 * marketValue/weight (NEVER fabricated), NAV counts only known values + cash,
 * coverage counts are honest, and an empty account list returns null
 * (portfolio-blind).
 */
import { describe, expect, it } from "vitest";
import { buildPortfolioContext } from "../src/flows/analysis/build-portfolio-context";
import type { AccountState } from "../src/flows/portfolio/portfolio-schema";

function account(over: Partial<AccountState> = {}): AccountState {
  return {
    accountId: "acc-1",
    name: "Roth IRA",
    type: "Roth",
    currency: "USD",
    cashBalance: 0,
    holdings: [],
    riskMandate: null,
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
          { ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } },
          { ticker: "AAPL", quantity: 20, costBasis: 150, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } },
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
          { ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } },
          { ticker: "ZZZZ", quantity: 5, costBasis: 10, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } }, // no quote
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

  it("values a mixed book by type: equity via quote, bond at mark, MMF at par (FIX-773 Slice C)", () => {
    // The whole point of the slice: a majority-bond/MMF book shows a real NAV,
    // not a sliver. Only the equity has a live quote; the bond values at its
    // carried mark, the MMF at par, and an unpriced bond degrades honestly.
    const accounts = [
      account({
        accountId: "acc-mixed",
        cashBalance: 0,
        holdings: [
          // equity via quote: 10 × 200 = 2000
          { ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } },
          // bond at carried mark: 5 × 98.5 = 492.5
          { ticker: "912828YK0", quantity: 5, costBasis: null, acquiredDate: null, assetClass: "fixed_income", assetType: "bond", attributes: { kind: "bond", cusip: "912828YK0", markPrice: 98.5 } },
          // MMF at par: 1500 × 1.00 = 1500
          { ticker: "SPAXX", quantity: 1500, costBasis: null, acquiredDate: null, assetClass: "cash", assetType: "money_market", attributes: { kind: "cash_equivalent" } },
          // unpriced bond: no mark → null marketValue, adds nothing to NAV
          { ticker: "999999XX9", quantity: 7, costBasis: null, acquiredDate: null, assetClass: "fixed_income", assetType: "bond", attributes: { kind: "bond", cusip: "999999XX9", markPrice: null } },
        ],
      }),
    ];
    // No quote for the bonds/MMF — they value WITHOUT a quote. The equity does.
    const quotes = [{ ticker: "NVDA", price: 200, asOf: "2026-05-06" }];
    const out = buildPortfolioContext(accounts, quotes, "2026-05-06");
    // NAV = 2000 (equity) + 492.5 (bond mark) + 1500 (MMF par) = 3992.5.
    // The unpriced bond adds nothing.
    expect(out?.totalNav).toBe(3992.5);
    expect(out?.pricedHoldings).toBe(3);
    expect(out?.totalHoldings).toBe(4);
    const byTicker = new Map(out?.holdings.map((h) => [h.ticker, h]));
    expect(byTicker.get("NVDA")?.marketValue).toBe(2000);
    expect(byTicker.get("912828YK0")?.marketValue).toBe(492.5);
    expect(byTicker.get("SPAXX")?.marketValue).toBe(1500);
    expect(byTicker.get("999999XX9")?.marketValue).toBeNull();
    expect(byTicker.get("999999XX9")?.weightPct).toBeNull();
  });

  it("never divides by zero — weight is null when NAV is 0", () => {
    // All holdings unpriced and no cash → NAV 0 → every weight null.
    const accounts = [
      account({
        cashBalance: 0,
        holdings: [{ ticker: "ZZZZ", quantity: 5, costBasis: 10, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } }],
      }),
    ];
    const out = buildPortfolioContext(accounts, [], "2026-05-06");
    expect(out?.totalNav).toBe(0);
    expect(out?.holdings[0]?.weightPct).toBeNull();
  });
});
