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
} from "../flows/analysis/build-portfolio-context";
import type { AccountState } from "../domain/portfolio/schema/portfolio-schema";
import {
  CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON,
  FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON,
  type FundProfileInput,
} from "../domain/portfolio/math/etf-look-through";

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

describe("buildPortfolioContext — FIX-762 classifications + health block", () => {
  const book = [
    account({
      cashBalance: 1000,
      holdings: [
        { ticker: "AAPL", quantity: 10, costBasis: 90, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" }, dataQuality: null }, // @100 → 1000
        { ticker: "SPY", quantity: 5, costBasis: 300, acquiredDate: null, assetClass: "equity", assetType: "etf", attributes: { kind: "none" }, dataQuality: null }, // @400 → 2000
      ],
    }),
  ];
  const quotes = [
    { ticker: "AAPL", price: 100, asOf: "2026-05-06" },
    { ticker: "SPY", price: 400, asOf: "2026-05-06" },
  ];

  it("populates holdings[].sector for equities from the classification map (funds stay null)", () => {
    const out = buildPortfolioContext(book, quotes, "2026-05-06", new Map([["AAPL", "Technology"]]));
    const byTicker = new Map(out?.holdings.map((h) => [h.ticker, h]));
    expect(byTicker.get("AAPL")?.sector).toBe("Technology");
    // An ETF is not a single-name equity → sector stays null even if classified.
    expect(byTicker.get("SPY")?.sector).toBeNull();
  });

  it("leaves sector null when no classification is provided (honest, not guessed)", () => {
    const out = buildPortfolioContext(book, quotes, "2026-05-06");
    expect(out?.holdings.every((h) => h.sector === null)).toBe(true);
  });

  it("projects the compact health block computed from the same leaf", () => {
    const out = buildPortfolioContext(book, quotes, "2026-05-06", new Map([["AAPL", "Technology"]]));
    const health = out?.health;
    expect(health).not.toBeNull();
    // totalNav = 1000 AAPL + 2000 SPY + 1000 cash = 4000; cash 25%.
    expect(health?.cashPct).toBeCloseTo(25);
    expect(health?.coveragePct).toBeCloseTo(100);
    // Drift is the FIX-761-gated slice — always null in v1.
    expect(health?.drift).toBeNull();
    // AAPL is single-name-eligible; SPY (fund) is exempt from single-name flags.
    expect(health?.concentration.maxPosition?.ticker).toBe("AAPL");
    // Funds bucket present in the sector exposure (no look-through).
    expect(health?.sectorExposure.some((s) => s.bucket === "Funds (no look-through)")).toBe(true);
  });

  it("nulls the health block when nothing is priceable (no priced data)", () => {
    const out = buildPortfolioContext(
      [account({ cashBalance: 0, holdings: [{ ticker: "ZZZZ", quantity: 5, costBasis: 10, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" }, dataQuality: null }] })],
      [],
      null,
    );
    expect(out?.health).toBeNull();
  });
});

describe("buildPortfolioContext — FIX-801 ETF look-through wiring", () => {
  // AAPL held directly (10k) + a fund (SPY, 60k) whose stored profile says it
  // holds 10% AAPL — the §1 worked example. Effective AAPL exposure through
  // the fund must exceed the direct-only weight, and the health block's
  // `lookThrough` field carries it.
  const book = [
    account({
      cashBalance: 0,
      holdings: [
        { ticker: "AAPL", quantity: 100, costBasis: 90, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" }, dataQuality: null }, // @100 → 10,000
        { ticker: "SPY", quantity: 150, costBasis: 300, acquiredDate: null, assetClass: "equity", assetType: "etf", attributes: { kind: "none" }, dataQuality: null }, // @400 → 60,000
      ],
    }),
  ];
  const quotes = [
    { ticker: "AAPL", price: 100, asOf: "2026-05-06" },
    { ticker: "SPY", price: 400, asOf: "2026-05-06" },
  ];
  // Row weights reconcile against the declared coverage figures (the leaf's
  // own reconciliation check, FIX-801 sub-PR b) — mirrors the §1 worked
  // example's own fixture (`nameCoverage: 0.995` = 0.07 AAPL + 0.925 MSFT).
  const etfProfiles: Map<string, FundProfileInput> = new Map([
    [
      "SPY",
      {
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
        },
        refusalReason: null,
      },
    ],
  ]);

  it("omitted (default), the health block's lookThrough stays null — reproduces today's output exactly (BP-030)", () => {
    const out = buildPortfolioContext(book, quotes, "2026-05-06");
    expect(out?.health?.lookThrough).toBeNull();
  });

  it("passed through, the health block's lookThrough reports effective exposure beyond the direct holding, framed as a coverage-qualified lower bound", () => {
    const out = buildPortfolioContext(book, quotes, "2026-05-06", new Map(), etfProfiles);
    const lookThrough = out?.health?.lookThrough;
    expect(lookThrough).not.toBeNull();
    // Direct AAPL alone is 10,000 / 70,000 ≈ 14.3%; through SPY's 92.5% AAPL
    // stake (+55,500) it's 65,500 / 70,000 ≈ 93.6% — strictly more than direct
    // alone, and now also the largest EFFECTIVE name (the compact block's
    // `maxPosition` reads the look-through basis, not the wrapper one).
    expect(lookThrough?.maxPosition?.ticker).toBe("AAPL");
    expect(lookThrough?.maxPosition?.weightPct).toBeGreaterThan(100 / 7); // > direct-only 14.3%
    expect(lookThrough?.coveragePct).not.toBeNull();
    expect(lookThrough?.coveragePct as number).toBeLessThan(100); // never renormalized to 100%
    expect(lookThrough?.opaqueFundCount).toBe(0);
    expect(lookThrough?.opaqueUnavailableFundCount).toBe(0);
    expect(lookThrough?.opaqueFundDetails).toEqual([]);
    // The actual attributed sector DISTRIBUTION, not just its coverage number
    // (Codex review, FIX-801 sub-PR c round 28) — SPY's reported sectors
    // (Technology 30%, Financial Services 66% of its own $60,000) plus AAPL's
    // own direct (unclassified, no classification map passed) bucket, all as a
    // % of the $70,000 invested NAV, sorted by market value desc.
    expect(lookThrough?.sectorExposure).toEqual([
      { bucket: "Financial Services", pct: expect.closeTo((0.66 * 60_000 * 100) / 70_000, 5) },
      { bucket: "Technology", pct: expect.closeTo((0.3 * 60_000 * 100) / 70_000, 5) },
      { bucket: "Unclassified", pct: expect.closeTo((10_000 * 100) / 70_000, 5) },
    ]);
    // The leaf's own uncertainty-aware [low, high] interval (Decision 4,
    // docs/etf-look-through.md) — computed by the leaf but never threaded
    // through the projection until now (Codex review, FIX-801 sub-PR c). A
    // direct pass-through, so just assert it's a real interval, not that it
    // stays null.
    expect(lookThrough?.effectivePositions).not.toBeNull();
    expect(lookThrough?.effectivePositions?.low).toBeGreaterThan(0);
    expect(lookThrough?.effectivePositions?.high).toBeGreaterThanOrEqual(
      lookThrough?.effectivePositions?.low ?? 0,
    );
  });

  it("a fund with no stored profile leaves lookThrough null (nothing attributed) — same 'never fetches' read as an empty map", () => {
    const out = buildPortfolioContext(book, quotes, "2026-05-06", new Map(), new Map());
    expect(out?.health?.lookThrough).toBeNull();
  });

  it("opaqueFundCount counts distinct opaque FUNDS, not failed-axis entries — a fund thin on both axes must count once, not twice (Codex review, FIX-801 sub-PR c)", () => {
    // A separate, self-contained book: AAPL direct + the well-covered SPY
    // (attributes AAPL — needed so `lookThrough` is "partial", not "none",
    // since a fund that is opaque on both axes contributes zero attribution
    // by itself) + VTI, a fund thin on BOTH axes via two INDEPENDENT reasons
    // (not a single combined "both" cause) — the exact shape that produces
    // two entries in `opaqueFunds` for one ticker.
    const thinBook = [
      account({
        cashBalance: 0,
        holdings: [
          { ticker: "AAPL", quantity: 100, costBasis: 90, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" }, dataQuality: null }, // 10,000
          { ticker: "SPY", quantity: 150, costBasis: 300, acquiredDate: null, assetClass: "equity", assetType: "etf", attributes: { kind: "none" }, dataQuality: null }, // 60,000
          { ticker: "VTI", quantity: 50, costBasis: 150, acquiredDate: null, assetClass: "equity", assetType: "etf", attributes: { kind: "none" }, dataQuality: null }, // 10,000
        ],
      }),
    ];
    const thinQuotes = [
      { ticker: "AAPL", price: 100, asOf: "2026-05-06" },
      { ticker: "SPY", price: 400, asOf: "2026-05-06" },
      { ticker: "VTI", price: 200, asOf: "2026-05-06" },
    ];
    const thinProfiles: Map<string, FundProfileInput> = new Map([
      [
        "SPY",
        {
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
          },
          refusalReason: null,
        },
      ],
      [
        "VTI",
        {
          payload: {
            leveraged: false,
            // Both axes reconcile (declared coverage matches the rows'
            // actual summed weight) but sit well below the 85% floor — so
            // BOTH axes reject independently, each with its own reason,
            // rather than a single "both" cause (fund-of-funds / refusal /
            // leveraged / no-profile all short-circuit to one combined
            // reason instead).
            constituents: [{ ticker: "MSFT", weight: 0.5 }],
            nameCoverage: 0.5,
            sectors: [{ sector: "Technology", weight: 0.5 }],
            sectorCoverage: 0.5,
          },
          refusalReason: null,
        },
      ],
    ]);

    const out = buildPortfolioContext(thinBook, thinQuotes, "2026-05-06", new Map(), thinProfiles);
    const lookThrough = out?.health?.lookThrough;
    // SPY still attributes AAPL, so the axis overall is "partial", not "none".
    expect(lookThrough).not.toBeNull();
    // VTI is the only opaque fund. Before the fix this read 2 (one entry per
    // failed axis); the fix dedupes by ticker.
    expect(lookThrough?.opaqueFundCount).toBe(1);
    // VTI's opacity is a genuine data-quality finding (thin coverage on both
    // axes), not a temporary unavailability — it must NOT count toward
    // opaqueUnavailableFundCount.
    expect(lookThrough?.opaqueUnavailableFundCount).toBe(0);
    // Unlike the count, `opaqueFundDetails` is NOT deduped by ticker — VTI's
    // two INDEPENDENT axis failures both survive as distinct entries, each
    // naming its own reason, so the prompt can say exactly what's wrong with
    // each axis rather than a single collapsed "VTI opaque" (Codex review,
    // FIX-801 sub-PR c round 25).
    expect(lookThrough?.opaqueFundDetails).toEqual([
      { ticker: "VTI", axis: "names", reason: "holdings data incomplete (50.0% coverage, floor 85%)", unavailable: false },
      { ticker: "VTI", axis: "sectors", reason: "sector data incomplete (50.0% coverage, floor 85%)", unavailable: false },
    ]);
  });

  it("opaqueUnavailableFundCount counts a never-fetched fund separately from a data-quality one (Codex review, FIX-801 sub-PR c)", () => {
    // AAPL direct + the well-covered SPY (attributes AAPL, so lookThrough is
    // "partial") + QQQ, held as an ETF but with NO entry in the profiles map
    // at all — the leaf still recognizes it as a fund from its own assetType
    // (resolveTickerIsFund layer 1a) but has nothing to attribute, so it's
    // opaque with reason "no stored profile": temporarily unavailable, not a
    // data-quality judgment.
    const mixedBook = [
      account({
        cashBalance: 0,
        holdings: [
          { ticker: "AAPL", quantity: 100, costBasis: 90, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" }, dataQuality: null },
          { ticker: "SPY", quantity: 150, costBasis: 300, acquiredDate: null, assetClass: "equity", assetType: "etf", attributes: { kind: "none" }, dataQuality: null },
          { ticker: "QQQ", quantity: 50, costBasis: 200, acquiredDate: null, assetClass: "equity", assetType: "etf", attributes: { kind: "none" }, dataQuality: null },
        ],
      }),
    ];
    const mixedQuotes = [
      { ticker: "AAPL", price: 100, asOf: "2026-05-06" },
      { ticker: "SPY", price: 400, asOf: "2026-05-06" },
      { ticker: "QQQ", price: 200, asOf: "2026-05-06" },
    ];
    // Only SPY has a stored profile — QQQ is never fetched.
    const mixedProfiles: Map<string, FundProfileInput> = new Map([
      [
        "SPY",
        {
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
          },
          refusalReason: null,
        },
      ],
    ]);

    const out = buildPortfolioContext(mixedBook, mixedQuotes, "2026-05-06", new Map(), mixedProfiles);
    const lookThrough = out?.health?.lookThrough;
    expect(lookThrough).not.toBeNull();
    expect(lookThrough?.opaqueFundCount).toBe(1); // QQQ
    expect(lookThrough?.opaqueUnavailableFundCount).toBe(1); // QQQ — never fetched
    expect(lookThrough?.opaqueFundDetails).toEqual([
      { ticker: "QQQ", axis: "both", reason: "no stored profile", unavailable: true },
    ]);
  });

  it("a wrapper withdrawn by guards.ts's constituent-broadening-failure fix (round 14) counts toward opaqueUnavailableFundCount, not the data-quality default (Codex review, FIX-801 sub-PR c round 15)", () => {
    // Same shape as the test above, but QQQ's map entry is the ROUND-14
    // withdrawal refusal (`CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON`) instead
    // of simply absent from the map. This reason predates neither `quota` nor
    // `transient` nor "no stored profile" in `UNAVAILABLE_REASONS` — it's a
    // NEW reason class round 14 introduced, and round 4's set (this file)
    // didn't know about it, so a withdrawn wrapper fell into the default
    // data-quality bucket and misreported a transient DB hiccup as a real
    // data-quality finding ("thin/ineligible data") to the trader/PM.
    const mixedBook = [
      account({
        cashBalance: 0,
        holdings: [
          { ticker: "AAPL", quantity: 100, costBasis: 90, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" }, dataQuality: null },
          { ticker: "SPY", quantity: 150, costBasis: 300, acquiredDate: null, assetClass: "equity", assetType: "etf", attributes: { kind: "none" }, dataQuality: null },
          { ticker: "QQQ", quantity: 50, costBasis: 200, acquiredDate: null, assetClass: "equity", assetType: "etf", attributes: { kind: "none" }, dataQuality: null },
        ],
      }),
    ];
    const mixedQuotes = [
      { ticker: "AAPL", price: 100, asOf: "2026-05-06" },
      { ticker: "SPY", price: 400, asOf: "2026-05-06" },
      { ticker: "QQQ", price: 200, asOf: "2026-05-06" },
    ];
    const mixedProfiles: Map<string, FundProfileInput> = new Map([
      [
        "SPY",
        {
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
          },
          refusalReason: null,
        },
      ],
      // QQQ was withdrawn (its own constituent-broadening read failed) —
      // guards.ts writes exactly this shape (etf-look-through.ts round 14).
      ["QQQ", { payload: null, refusalReason: CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON }],
    ]);

    const out = buildPortfolioContext(mixedBook, mixedQuotes, "2026-05-06", new Map(), mixedProfiles);
    const lookThrough = out?.health?.lookThrough;
    expect(lookThrough).not.toBeNull();
    expect(lookThrough?.opaqueFundCount).toBe(1); // QQQ
    expect(lookThrough?.opaqueUnavailableFundCount).toBe(1); // QQQ — "not yet available", not "thin/ineligible data"
    expect(lookThrough?.opaqueFundDetails).toEqual([
      { ticker: "QQQ", axis: "both", reason: CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON, unavailable: true },
    ]);
  });

  it("a curated bond ETF proactively suppressed by excludeFixedIncomeFromProfileMap (round 28) reports as permanently policy-suppressed, not 'not yet available' (Codex review, FIX-801 sub-PR c round 28)", () => {
    // This is the downstream half of the round-28 fix: `excludeFixedIncomeFromProfileMap`
    // (etf-profile-map.ts) now proactively seeds a curated bond ETF with no
    // prior cache entry with FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON,
    // instead of leaving it absent (which the leaf would report as the
    // generic "no stored profile" — an UNAVAILABLE_REASONS member, implying a
    // future fetch might fill it in). This test simulates the caller-side
    // effect directly: BND's entry is ALREADY the post-suppression shape (as
    // `excludeFixedIncomeFromProfileMap` would produce it), never the raw
    // "absent" state a pre-fix caller would have passed through.
    const mixedBook = [
      account({
        cashBalance: 0,
        holdings: [
          { ticker: "AAPL", quantity: 100, costBasis: 90, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" }, dataQuality: null },
          { ticker: "SPY", quantity: 150, costBasis: 300, acquiredDate: null, assetClass: "equity", assetType: "etf", attributes: { kind: "none" }, dataQuality: null },
          { ticker: "BND", quantity: 50, costBasis: 80, acquiredDate: null, assetClass: "fixed_income", assetType: "etf", attributes: { kind: "none" }, dataQuality: null },
        ],
      }),
    ];
    const mixedQuotes = [
      { ticker: "AAPL", price: 100, asOf: "2026-05-06" },
      { ticker: "SPY", price: 400, asOf: "2026-05-06" },
      { ticker: "BND", price: 75, asOf: "2026-05-06" },
    ];
    const mixedProfiles: Map<string, FundProfileInput> = new Map([
      [
        "SPY",
        {
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
          },
          refusalReason: null,
        },
      ],
      ["BND", { payload: null, refusalReason: FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON }],
    ]);

    const out = buildPortfolioContext(mixedBook, mixedQuotes, "2026-05-06", new Map(), mixedProfiles);
    const lookThrough = out?.health?.lookThrough;
    expect(lookThrough).not.toBeNull();
    expect(lookThrough?.opaqueFundCount).toBe(1); // BND
    // The critical assertion: NOT counted as "not yet available" — the
    // suppression reason is fund-confirming but is not in
    // UNAVAILABLE_REASONS, so it correctly reads as a genuine, permanent
    // policy exclusion rather than a pending fetch.
    expect(lookThrough?.opaqueUnavailableFundCount).toBe(0);
    expect(lookThrough?.opaqueFundDetails).toEqual([
      { ticker: "BND", axis: "both", reason: FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON, unavailable: false },
    ]);
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
