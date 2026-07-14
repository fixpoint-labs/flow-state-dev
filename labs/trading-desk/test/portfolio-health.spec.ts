/**
 * Unit tests for the deterministic household-health leaf (`summarizePortfolioHealth`,
 * FIX-762).
 *
 * Intent encoded — these pin the household-math rules that materially move the
 * numbers and the real-money honesty gates:
 *   1. The same ticker across accounts merges to ONE exposure (value/weight = sum).
 *   2. Allocation weights (incl. cash) sum to ~100% of totalNav; exposure weights
 *      exclude cash and re-normalize over investedNav.
 *   3. An `inconsistent_history` row changes NO total but increments the excluded
 *      count — and the leaf's totalNav reconciles with the pane rollup algorithm.
 *   4. A 12% single-name equity flags; a 12% ETF does not; Unclassified / funds
 *      buckets never sector-flag.
 *   5. effectivePositions = 1/Σw²; top-5 = sum of the five largest exposure weights.
 *   6. Total-function discipline: cash-only / unpriced / excluded / negative-qty
 *      inputs produce nulls, never NaN/Infinity.
 *
 * Mandate drift/compliance (`computeAllocationDrift`) is the FIX-761-gated slice
 * and is not covered here (it does not exist yet).
 */
import { describe, expect, it } from "vitest";
import {
  summarizePortfolioHealth,
  FUNDS_BUCKET,
  UNCLASSIFIED_BUCKET,
  type QuoteMap,
  type ClassificationMap,
} from "@/src/domain/portfolio/math/portfolio-health";
import { holdingMarketValue } from "@/src/domain/portfolio/math/value-holding";
import type { AccountState, Holding } from "@/src/domain/portfolio/schema/portfolio-schema";

function holding(overrides: Partial<Holding> & Pick<Holding, "ticker" | "quantity">): Holding {
  return {
    costBasis: null,
    acquiredDate: null,
    assetClass: "equity",
    assetType: "equity",
    attributes: { kind: "none" },
    dataQuality: null,
    ...overrides,
  };
}

function account(overrides: Partial<AccountState> & Pick<AccountState, "accountId">): AccountState {
  return {
    name: overrides.accountId,
    type: "taxable",
    currency: "USD",
    cashBalance: 0,
    holdings: [],
    riskMandate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** UPPER ticker → { price, asOf }. */
function quotes(map: Record<string, number | null>): QuoteMap {
  const q: QuoteMap = new Map();
  for (const [ticker, price] of Object.entries(map)) q.set(ticker.toUpperCase(), { price, asOf: "2026-07-10T20:00:00.000Z" });
  return q;
}

function classifications(map: Record<string, string | null>): ClassificationMap {
  const c: ClassificationMap = new Map();
  for (const [ticker, sector] of Object.entries(map)) c.set(ticker.toUpperCase(), sector);
  return c;
}

/** The main multi-account fixture: AAPL held in two accounts, plus MSFT and an
 *  equity ETF, and $1,000 cash. Hand-computed: invested NAV 3,300; total NAV 4,300. */
function multiAccountBook(): AccountState[] {
  return [
    account({
      accountId: "A",
      cashBalance: 1000,
      holdings: [
        holding({ ticker: "AAPL", quantity: 10 }), // @100 → 1000
        holding({ ticker: "MSFT", quantity: 5 }), //  @200 → 1000
      ],
    }),
    account({
      accountId: "B",
      holdings: [
        holding({ ticker: "AAPL", quantity: 5 }), // @100 → 500 (same name, 2nd account)
        holding({ ticker: "SPY", quantity: 2, assetType: "etf" }), // @400 → 800
      ],
    }),
  ];
}

const MAIN_QUOTES = quotes({ AAPL: 100, MSFT: 200, SPY: 400 });
const MAIN_CLASS = classifications({ AAPL: "Technology", MSFT: "Technology" });

describe("summarizePortfolioHealth — ticker merge + weights", () => {
  it("merges the same ticker across accounts into one summed position", () => {
    const h = summarizePortfolioHealth(multiAccountBook(), MAIN_QUOTES, MAIN_CLASS, null);
    const aapl = h.positions.find((p) => p.ticker === "AAPL");
    expect(aapl).toBeDefined();
    expect(aapl!.quantity).toBe(15);
    expect(aapl!.marketValue).toBe(1500);
    expect(aapl!.accounts.map((a) => a.accountId).sort()).toEqual(["A", "B"]);
    // Exactly one merged AAPL row (not three).
    expect(h.positions.filter((p) => p.ticker === "AAPL")).toHaveLength(1);
  });

  it("computes NAV, invested NAV, and cash from valued rows + account cash", () => {
    const h = summarizePortfolioHealth(multiAccountBook(), MAIN_QUOTES, MAIN_CLASS, null);
    expect(h.totalNav).toBe(4300);
    expect(h.investedNav).toBe(3300);
    expect(h.cash.amount).toBe(1000);
    expect(h.cash.pct).toBeCloseTo((1000 / 4300) * 100);
  });

  it("allocation weights (incl. cash) sum to ~100% of totalNav", () => {
    const h = summarizePortfolioHealth(multiAccountBook(), MAIN_QUOTES, MAIN_CLASS, null);
    const positionsPct = h.positions.reduce((s, p) => s + (p.allocationWeightPct ?? 0), 0);
    expect(positionsPct + (h.cash.pct ?? 0)).toBeCloseTo(100);
    const classPct = h.assetClassAllocation.reduce((s, c) => s + (c.pct ?? 0), 0);
    expect(classPct).toBeCloseTo(100);
  });

  it("exposure weights exclude cash and re-normalize over invested NAV", () => {
    const h = summarizePortfolioHealth(multiAccountBook(), MAIN_QUOTES, MAIN_CLASS, null);
    const exposurePct = h.positions.reduce((s, p) => s + (p.exposureWeightPct ?? 0), 0);
    expect(exposurePct).toBeCloseTo(100); // cash has no exposure weight
    const aapl = h.positions.find((p) => p.ticker === "AAPL")!;
    expect(aapl.exposureWeightPct).toBeCloseTo((1500 / 3300) * 100);
    expect(aapl.allocationWeightPct).toBeCloseTo((1500 / 4300) * 100);
  });

  it("buckets sector exposure over invested NAV, funds as their own opaque bucket", () => {
    const h = summarizePortfolioHealth(multiAccountBook(), MAIN_QUOTES, MAIN_CLASS, null);
    const tech = h.sectorExposure.find((s) => s.bucket === "Technology");
    const funds = h.sectorExposure.find((s) => s.bucket === FUNDS_BUCKET);
    expect(tech!.marketValue).toBe(2500); // AAPL 1500 + MSFT 1000
    expect(tech!.pct).toBeCloseTo((2500 / 3300) * 100);
    expect(funds!.marketValue).toBe(800); // SPY (etf → no look-through)
    expect(h.lookThrough).toBe("none");
  });

  it("carries each sector bucket's constituent tickers, weight desc, summing to the bucket", () => {
    const h = summarizePortfolioHealth(multiAccountBook(), MAIN_QUOTES, MAIN_CLASS, null);
    const tech = h.sectorExposure.find((s) => s.bucket === "Technology")!;
    // AAPL (1500, merged across two accounts) ranks above MSFT (1000).
    expect(tech.constituents.map((c) => c.ticker)).toEqual(["AAPL", "MSFT"]);
    expect(tech.constituents.map((c) => c.marketValue)).toEqual([1500, 1000]);
    // Each constituent weight is of investedNav (same denom as the bucket pct),
    // so the constituents sum to the bucket weight.
    const sum = tech.constituents.reduce((s, c) => s + (c.weightPct ?? 0), 0);
    expect(sum).toBeCloseTo(tech.pct!);
    // Funds bucket drills to the ETF that drives it — the FIX-762 answer to
    // "which funds make up my 'no look-through' slice?".
    const funds = h.sectorExposure.find((s) => s.bucket === FUNDS_BUCKET)!;
    expect(funds.constituents.map((c) => c.ticker)).toEqual(["SPY"]);
    expect(funds.constituents[0]!.assetType).toBe("etf");
  });
});

describe("summarizePortfolioHealth — inconsistent_history reconciliation", () => {
  it("excludes an inconsistent_history row from money math but counts it", () => {
    const book: AccountState[] = [
      account({
        accountId: "A",
        cashBalance: 1000,
        holdings: [
          holding({ ticker: "AAPL", quantity: 10 }), // @100 → 1000
          holding({ ticker: "NVDA", quantity: 0, dataQuality: "inconsistent_history" }),
        ],
      }),
    ];
    const h = summarizePortfolioHealth(book, quotes({ AAPL: 100, NVDA: 500 }), classifications({ AAPL: "Technology" }), null);
    expect(h.totalNav).toBe(2000); // 1000 AAPL + 1000 cash — NVDA excluded
    const nvda = h.positions.find((p) => p.ticker === "NVDA")!;
    expect(nvda.marketValue).toBeNull();
    expect(nvda.excludedRows).toBe(1);
    expect(h.coverage.excludedTickers).toContain("NVDA");
    expect(h.coverage.totalPositions).toBe(2);
    expect(h.coverage.pricedPositions).toBe(1);
  });

  it("classifies a merged position by its dominant (largest-mass) lot, not iteration order", () => {
    // Same symbol tagged etf in the first account (small) and equity in the
    // second (large). The larger lot must decide the classification, so the
    // merged line is single-name-eligible (equity) — deterministic regardless of
    // account order.
    const book: AccountState[] = [
      account({ accountId: "A", holdings: [holding({ ticker: "XX", quantity: 1, assetType: "etf" })] }), // @100 → 100
      account({ accountId: "B", holdings: [holding({ ticker: "XX", quantity: 9, assetType: "equity" })] }), // @100 → 900
    ];
    const h = summarizePortfolioHealth(book, quotes({ XX: 100 }), classifications({ XX: "Technology" }), null);
    const xx = h.positions.find((p) => p.ticker === "XX")!;
    expect(xx.assetType).toBe("equity"); // the 900 lot wins over the 100 lot
    expect(xx.sector).toBe("Technology");
    // Single-name-eligible now → it can carry a single-name concentration read.
    expect(h.concentration.maxPosition?.ticker).toBe("XX");
  });

  it("reconciles totalNav with the pane rollup algorithm on a shared fixture", () => {
    const book = multiAccountBook();
    const h = summarizePortfolioHealth(book, MAIN_QUOTES, MAIN_CLASS, null);
    // The pane's totals memo (portfolio-pane.tsx): per account, Σ included-holding
    // market value + cashBalance, summed across accounts.
    let paneTotal = 0;
    for (const acc of book) {
      let value = 0;
      for (const hld of acc.holdings) {
        if (hld.dataQuality === "inconsistent_history") continue;
        const mv = holdingMarketValue(hld, MAIN_QUOTES.get(hld.ticker.toUpperCase()));
        if (mv !== null) value += mv;
      }
      paneTotal += value + acc.cashBalance;
    }
    expect(h.totalNav).toBe(paneTotal);
  });
});

describe("summarizePortfolioHealth — concentration flags", () => {
  it("flags a 12% single-name equity as warn but exempts a 12% ETF", () => {
    // Invested NAV 10,000: NVDA equity 12%, SPY ETF 12%, a bond makes up the rest
    // (not single-name-eligible). No cash.
    const book: AccountState[] = [
      account({
        accountId: "A",
        holdings: [
          holding({ ticker: "NVDA", quantity: 12 }), // @100 → 1200 (12%)
          holding({ ticker: "SPY", quantity: 12, assetType: "etf" }), // @100 → 1200 (12%)
          holding({
            ticker: "TBOND",
            quantity: 76,
            assetClass: "fixed_income",
            assetType: "bond",
            attributes: { kind: "bond", cusip: null, markPrice: 100 },
          }), // → 7600 (76%)
        ],
      }),
    ];
    const h = summarizePortfolioHealth(book, quotes({ NVDA: 100, SPY: 100 }), classifications({ NVDA: "Technology" }), null);
    const singleNameFlags = h.concentration.flags.filter((f) => f.kind === "single_name");
    expect(singleNameFlags).toHaveLength(1);
    expect(singleNameFlags[0]).toMatchObject({ ticker: "NVDA", level: "warn" });
    // The ETF is never a single-name flag.
    expect(singleNameFlags.some((f) => f.kind === "single_name" && f.ticker === "SPY")).toBe(false);
    expect(h.concentration.maxPosition).toMatchObject({ ticker: "NVDA" });
  });

  it("never sector-flags the Unclassified or Funds buckets even above threshold", () => {
    // Funds bucket 50%, Unclassified bucket 50% — both above the 30% sector warn.
    const book: AccountState[] = [
      account({
        accountId: "A",
        holdings: [
          holding({ ticker: "SPY", quantity: 50, assetType: "etf" }), // @100 → 5000 funds
          holding({ ticker: "XYZ", quantity: 50 }), // @100 → 5000 unclassified equity
        ],
      }),
    ];
    const h = summarizePortfolioHealth(book, quotes({ SPY: 100, XYZ: 100 }), classifications({}), null);
    expect(h.sectorExposure.find((s) => s.bucket === FUNDS_BUCKET)!.pct).toBeCloseTo(50);
    expect(h.sectorExposure.find((s) => s.bucket === UNCLASSIFIED_BUCKET)!.pct).toBeCloseTo(50);
    expect(h.concentration.flags.filter((f) => f.kind === "sector")).toHaveLength(0);
  });

  it("alerts a single name above the alert threshold", () => {
    const book: AccountState[] = [
      account({
        accountId: "A",
        holdings: [
          holding({ ticker: "NVDA", quantity: 40 }), // @100 → 4000 (40% > 25)
          holding({ ticker: "AAPL", quantity: 60 }), // @100 → 6000 (60% > 25)
        ],
      }),
    ];
    const h = summarizePortfolioHealth(book, quotes({ NVDA: 100, AAPL: 100 }), classifications({}), null);
    const alerts = h.concentration.flags.filter((f) => f.kind === "single_name" && f.level === "alert");
    expect(alerts).toHaveLength(2);
  });
});

describe("summarizePortfolioHealth — concentration metrics", () => {
  it("computes effective positions = 1/Σw² and top-N over invested weights", () => {
    const h = summarizePortfolioHealth(multiAccountBook(), MAIN_QUOTES, MAIN_CLASS, null);
    // Weights of invested NAV: AAPL 1500/3300, MSFT 1000/3300, SPY 800/3300.
    const ws = [1500 / 3300, 1000 / 3300, 800 / 3300];
    const sumSq = ws.reduce((s, w) => s + w * w, 0);
    expect(h.concentration.effectivePositions).toBeCloseTo(1 / sumSq);
    // Only three invested positions → top-5 and top-10 are the whole book (~100%).
    expect(h.concentration.top5Pct).toBeCloseTo(100);
    expect(h.concentration.top10Pct).toBeCloseTo(100);
  });

  it("top-5 sums the five largest exposure weights when there are more than five", () => {
    const holdings = Array.from({ length: 8 }, (_, i) =>
      holding({ ticker: `T${i}`, quantity: i + 1 }), // qty 1..8 @ 100 → 100..800
    );
    const priceMap = quotes(Object.fromEntries(holdings.map((hld) => [hld.ticker, 100])));
    const h = summarizePortfolioHealth([account({ accountId: "A", holdings })], priceMap, classifications({}), null);
    const invested = 100 + 200 + 300 + 400 + 500 + 600 + 700 + 800; // 3600
    const topFive = (800 + 700 + 600 + 500 + 400) / invested; // five largest
    expect(h.concentration.top5Pct).toBeCloseTo(topFive * 100);
  });
});

describe("summarizePortfolioHealth — total-function edge cases", () => {
  it("handles a cash-only book with no invested positions (no NaN)", () => {
    const h = summarizePortfolioHealth([account({ accountId: "A", cashBalance: 5000 })], new Map(), new Map(), null);
    expect(h.totalNav).toBe(5000);
    expect(h.investedNav).toBe(0);
    expect(h.cash.pct).toBeCloseTo(100);
    expect(h.positions).toHaveLength(0);
    expect(h.sectorExposure).toHaveLength(0);
    expect(h.concentration.effectivePositions).toBeNull();
    expect(h.concentration.maxPosition).toBeNull();
    expect(h.concentration.top5Pct).toBeNull();
  });

  it("lists an unpriced holding in coverage and out of every weight", () => {
    const book = [account({ accountId: "A", cashBalance: 100, holdings: [holding({ ticker: "AAPL", quantity: 10 })] })];
    const h = summarizePortfolioHealth(book, new Map(), new Map(), null); // no quote for AAPL
    expect(h.coverage.unpricedTickers).toEqual(["AAPL"]);
    expect(h.coverage.pricedPositions).toBe(0);
    expect(h.positions[0].marketValue).toBeNull();
    expect(h.positions[0].exposureWeightPct).toBeNull();
    expect(h.totalNav).toBe(100); // cash only
    expect(h.investedNav).toBe(0);
  });

  it("returns null totals for an empty portfolio (no accounts)", () => {
    const h = summarizePortfolioHealth([], new Map(), new Map(), null);
    expect(h.totalNav).toBeNull();
    expect(h.investedNav).toBeNull();
    expect(h.positions).toHaveLength(0);
  });

  it("keeps concentration finite under a negative quantity (short, not currently producible)", () => {
    const book = [
      account({
        accountId: "A",
        holdings: [holding({ ticker: "AAPL", quantity: 10 }), holding({ ticker: "SHORT", quantity: -5 })],
      }),
    ];
    const h = summarizePortfolioHealth(book, quotes({ AAPL: 100, SHORT: 100 }), classifications({}), null);
    // 1000 long, -500 short → invested 500. No NaN/Infinity anywhere in the metrics.
    for (const p of h.positions) {
      if (p.exposureWeightPct !== null) expect(Number.isFinite(p.exposureWeightPct)).toBe(true);
    }
    expect(h.concentration.effectivePositions === null || Number.isFinite(h.concentration.effectivePositions)).toBe(true);
    expect(Number.isFinite(h.concentration.top5Pct ?? 0)).toBe(true);
  });

  it("passes through the snapshot as-of", () => {
    const h = summarizePortfolioHealth(multiAccountBook(), MAIN_QUOTES, MAIN_CLASS, "2026-07-10T20:00:00.000Z");
    expect(h.asOf).toBe("2026-07-10T20:00:00.000Z");
  });
});
