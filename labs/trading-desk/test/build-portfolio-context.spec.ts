/**
 * `buildPortfolioContext` — the load-bearing Slice-4 → flow-input mapping.
 *
 * Real-money guarantees under test: a missing live price degrades to null
 * marketValue/weight (NEVER fabricated), NAV counts only known values + cash,
 * coverage counts are honest, and an empty account list returns null
 * (portfolio-blind).
 */
import { describe, expect, it } from "vitest";
import {
  buildPortfolioContext,
  householdTickerWeight,
} from "../src/flows/analysis/build-portfolio-context";
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

  it("surfaces an inconsistent-history holding as unknown, not a $0 position (FIX-876)", () => {
    // A flagged holding (an unaccounted split over-sold the ledger) has a
    // meaningless quantity 0. It must NOT reach the trader/PM as a priced $0 /
    // 0%-weight position — it's an unknown input: null marketValue/weight, counted
    // in totalHoldings (coverage) but not pricedHoldings/NAV.
    const accounts = [
      account({
        cashBalance: 1000,
        holdings: [
          {
            ticker: "NVDA",
            quantity: 0,
            costBasis: null,
            acquiredDate: null,
            assetClass: "equity",
            assetType: "equity",
            attributes: { kind: "none" },
            dataQuality: "inconsistent_history",
          },
        ],
      }),
    ];
    const out = buildPortfolioContext(accounts, [{ ticker: "NVDA", price: 120, asOf: "2026-05-06" }], "2026-05-06");
    expect(out?.totalNav).toBe(1000); // cash only — the flagged holding adds nothing
    expect(out?.totalHoldings).toBe(1);
    expect(out?.pricedHoldings).toBe(0);
    const nvda = out?.holdings.find((h) => h.ticker === "NVDA");
    expect(nvda?.marketValue).toBeNull();
    expect(nvda?.weightPct).toBeNull();
  });

  it("computes marketValue, NAV and weights from quantity × live price + cash", () => {
    const accounts = [
      account({
        accountId: "acc-roth",
        name: "Roth IRA",
        cashBalance: 1000,
        holdings: [
          { ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" }, dataQuality: null },
          { ticker: "AAPL", quantity: 20, costBasis: 150, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" }, dataQuality: null },
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
          { ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" }, dataQuality: null },
          { ticker: "ZZZZ", quantity: 5, costBasis: 10, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" }, dataQuality: null }, // no quote
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
          { ticker: "NVDA", quantity: 10, costBasis: 100, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" }, dataQuality: null },
          // bond at carried mark: 5 × 98.5 = 492.5
          { ticker: "912828YK0", quantity: 5, costBasis: null, acquiredDate: null, assetClass: "fixed_income", assetType: "bond", attributes: { kind: "bond", cusip: "912828YK0", markPrice: 98.5 }, dataQuality: null },
          // MMF at par: 1500 × 1.00 = 1500
          { ticker: "SPAXX", quantity: 1500, costBasis: null, acquiredDate: null, assetClass: "cash", assetType: "money_market", attributes: { kind: "cash_equivalent" }, dataQuality: null },
          // unpriced bond: no mark → null marketValue, adds nothing to NAV
          { ticker: "999999XX9", quantity: 7, costBasis: null, acquiredDate: null, assetClass: "fixed_income", assetType: "bond", attributes: { kind: "bond", cusip: "999999XX9", markPrice: null }, dataQuality: null },
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
        holdings: [{ ticker: "ZZZZ", quantity: 5, costBasis: 10, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" }, dataQuality: null }],
      }),
    ];
    const out = buildPortfolioContext(accounts, [], "2026-05-06");
    expect(out?.totalNav).toBe(0);
    expect(out?.holdings[0]?.weightPct).toBeNull();
  });
});

describe("householdTickerWeight (FIX-761)", () => {
  const holding = (ticker: string) => ({
    ticker,
    quantity: 10,
    costBasis: 100,
    acquiredDate: null,
    assetClass: "equity" as const,
    assetType: "equity" as const,
    attributes: { kind: "none" as const },
    dataQuality: null,
  });

  it("is 0 for a not-held name (initiating)", () => {
    const snap = buildPortfolioContext(
      [account({ cashBalance: 1000, holdings: [holding("AAPL")] })],
      [{ ticker: "AAPL", price: 100, asOf: "2026-05-06" }],
      "2026-05-06",
    );
    expect(householdTickerWeight(snap, "NVDA")).toBe(0);
  });

  it("sums the weights when every lot of the name is priced", () => {
    const snap = buildPortfolioContext(
      [
        account({ accountId: "a", cashBalance: 0, holdings: [holding("NVDA")] }),
        account({ accountId: "b", cashBalance: 0, holdings: [holding("NVDA")] }),
      ],
      [{ ticker: "NVDA", price: 100, asOf: "2026-05-06" }],
      "2026-05-06",
    );
    // Both lots priced, NAV = 2000, each 50% → 100% household weight.
    expect(householdTickerWeight(snap, "NVDA")).toBeCloseTo(100);
  });

  it("returns null when ANY lot of the name is unpriced (partial → unknown)", () => {
    // One priced NVDA lot + one inconsistent (unpriced) NVDA lot. A partial sum
    // would understate the true household weight and could force-trim the position,
    // so the weight is reported UNKNOWN.
    const partial = buildPortfolioContext(
      [
        account({ accountId: "a", cashBalance: 0, holdings: [holding("NVDA")] }),
        account({
          accountId: "b",
          cashBalance: 0,
          holdings: [{ ...holding("NVDA"), quantity: 0, dataQuality: "inconsistent_history" }],
        }),
      ],
      [{ ticker: "NVDA", price: 100, asOf: "2026-05-06" }],
      "2026-05-06",
    );
    expect(householdTickerWeight(partial, "NVDA")).toBeNull();
  });

  it("treats a null snapshot as not-held (0 — a portfolio-blind run initiates)", () => {
    expect(householdTickerWeight(null, "NVDA")).toBe(0);
  });
});
