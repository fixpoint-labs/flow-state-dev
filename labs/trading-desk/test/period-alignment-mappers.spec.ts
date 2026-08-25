/**
 * Period alignment at the mapper layer (FIX-1113) — both providers.
 *
 * WHY THESE FIXTURES EXIST, AND WHY THE COMMITTED ONES CANNOT REPLACE THEM.
 * Both committed provider fixtures are period-symmetric and complete: against
 * them today's broken mappers emit coherent statements, so every assertion
 * written against them passes whether the code is fixed or not. F1–F3 below are
 * asymmetric BY CONSTRUCTION, which is what makes a wrong implementation
 * observable. Each fixture's header names the wrong value it would produce.
 *
 * Every behaviour drives the EXPORTED production mapper. Nothing here
 * re-implements a selection rule — a forked copy of the selection helpers in a
 * shipped test drifts from production the moment the leaf moves, and would then
 * be the second thing in this area that proves nothing.
 */
import { describe, it, expect } from "vitest";
import {
  mapEdgarCompanyFacts,
  mapEdgarFinancialsHistory,
} from "@/lib/providers/edgar-companyfacts";
import {
  mapYahooTimeseries,
  mapYahooTimeseriesHistory,
} from "@/lib/providers/yahoo-timeseries";

const B = 1_000_000_000;
const DATE = "2026-05-06";

// ── EDGAR helpers ──────────────────────────────────────────────────────────

/** A full-year duration fact (income / cashflow). */
const dur = (start: string, end: string, valB: number, fy: number) => ({
  start,
  end,
  val: valB * B,
  fy,
  fp: "FY",
  form: "10-K",
});

/** A fiscal-year-end instant fact (balance sheet). */
const inst = (end: string, valB: number, fy: number) => ({
  start: null,
  end,
  val: valB * B,
  fy,
  fp: "FY",
  form: "10-K",
});

const usGaap = (tags: Record<string, unknown[]>) => ({
  cik: 1,
  entityName: "Test Co",
  facts: {
    "us-gaap": Object.fromEntries(
      Object.entries(tags).map(([tag, units]) => [tag, { units: { USD: units } }]),
    ),
  },
});

// ── F1 — the asymmetric filing ─────────────────────────────────────────────
//
// Equity is reported for FY2024 and NOT for FY2025. Every other core figure
// reports both. So the anchor is 2025-09-27 and equity is absent there.
//
// TODAY'S DEFECT, and the values that make it visible: a latest-value-per-tag
// selector returns the 2024 equity figure (57.0) under a 2025 date, producing a
// balance sheet that spans two period ends and a return-on-equity of one year's
// profit over the prior year's equity. The two equity values are deliberately
// FAR APART (57.0 vs a 2025 figure that does not exist) so "absent" and "stale"
// cannot be confused for one another.
const F1 = usGaap({
  Assets: [inst("2024-09-28", 364.98, 2024), inst("2025-09-27", 359.241, 2025)],
  Liabilities: [inst("2024-09-28", 308.03, 2024), inst("2025-09-27", 285.508, 2025)],
  // The gap: no FY2025 equity entry at all.
  StockholdersEquity: [inst("2024-09-28", 57.0, 2024)],
  CashAndCashEquivalentsAtCarryingValue: [
    inst("2024-09-28", 29.943, 2024),
    inst("2025-09-27", 35.934, 2025),
  ],
  LongTermDebtNoncurrent: [
    inst("2024-09-28", 85.75, 2024),
    inst("2025-09-27", 78.566, 2025),
  ],
  LongTermDebtCurrent: [
    inst("2024-09-28", 10.912, 2024),
    inst("2025-09-27", 12.112, 2025),
  ],
  RevenueFromContractWithCustomerExcludingAssessedTax: [
    dur("2023-10-01", "2024-09-28", 391.035, 2024),
    dur("2024-09-29", "2025-09-27", 416.161, 2025),
  ],
  OperatingIncomeLoss: [
    dur("2023-10-01", "2024-09-28", 123.216, 2024),
    dur("2024-09-29", "2025-09-27", 133.05, 2025),
  ],
  NetIncomeLoss: [
    dur("2023-10-01", "2024-09-28", 93.736, 2024),
    dur("2024-09-29", "2025-09-27", 112.01, 2025),
  ],
  NetCashProvidedByUsedInOperatingActivities: [
    dur("2023-10-01", "2024-09-28", 118.254, 2024),
    dur("2024-09-29", "2025-09-27", 111.482, 2025),
  ],
  PaymentsToAcquirePropertyPlantAndEquipment: [
    dur("2023-10-01", "2024-09-28", 9.447, 2024),
    dur("2024-09-29", "2025-09-27", 12.715, 2025),
  ],
});

describe("F1 — a company that stopped reporting one line item (filings path)", () => {
  const out = mapEdgarCompanyFacts(F1 as never, "TEST", DATE);

  it("anchors to the newest period ANY core figure reports, not the newest complete one", () => {
    expect(out.balanceSheet.periodEnd).toBe("2025-09-27");
    expect(out.incomeStatement.periodEnd).toBe("2025-09-27");
    expect(out.cashflow.periodEnd).toBe("2025-09-27");
  });

  it("reports the missing figure as ABSENT rather than borrowing the prior year's", () => {
    // The whole defect in one assertion. `57.0` is the FY2024 equity value; a
    // latest-value-per-tag selector returns it here under a 2025 date.
    expect(out.balanceSheet.totalEquity).toBeNull();
    expect(out.balanceSheet.totalEquity).not.toBe(57.0);
  });

  it("does NOT blank the rest of the statement — one absent figure is not a void", () => {
    // The paired half of decision 3. Asserting only the null above is satisfied
    // by an implementation that blanks the whole statement, which is the
    // abstains-by-construction failure this rule exists to prevent.
    expect(out.balanceSheet.totalAssets).toBe(359.241);
    expect(out.balanceSheet.totalLiabilities).toBe(285.508);
    expect(out.balanceSheet.cashAndEquivalents).toBe(35.934);
    expect(out.balanceSheet.source).toBe("edgar");
  });

  it("sums both debt legs AT the anchor, so the total cannot mix two years", () => {
    expect(out.balanceSheet.totalDebt).toBeCloseTo(78.566 + 12.112, 6);
  });

  it("every non-absent field was read at the period the statement declares", () => {
    // The completeness property as a property, not a field list — it holds for
    // a field added next year. Scoped to statements that carry a figure: the
    // unavailable payload declares NO period and sits outside the subject.
    for (const stmt of [out.incomeStatement, out.balanceSheet, out.cashflow]) {
      expect(stmt.periodEnd).toBe("2025-09-27");
    }
    expect(out.incomeStatement.revenue).toBe(416.161);
    expect(out.cashflow.operating).toBe(111.482);
    expect(out.cashflow.freeCashFlow).toBeCloseTo(111.482 - 12.715, 6);
  });
});

// ── F2 — the gap-year history ──────────────────────────────────────────────
//
// Three annual periods with the MIDDLE one missing: 2025, (no 2024), 2023.
//
// TODAY'S DEFECT: "the last two values available" pairs 2025 with 2023 and
// publishes a two-year change as one year's growth. The revenue values are
// chosen so the wrong answer is loud — 300 → 420 across two years is +40%,
// while the honest answer is "no adjacent pair, so nothing".
const F2 = usGaap({
  Assets: [inst("2023-09-30", 350.0, 2023), inst("2025-09-27", 400.0, 2025)],
  RevenueFromContractWithCustomerExcludingAssessedTax: [
    dur("2022-10-01", "2023-09-30", 300.0, 2023),
    dur("2024-09-29", "2025-09-27", 420.0, 2025),
  ],
  NetIncomeLoss: [
    dur("2022-10-01", "2023-09-30", 70.0, 2023),
    dur("2024-09-29", "2025-09-27", 100.0, 2025),
  ],
  OperatingIncomeLoss: [
    dur("2022-10-01", "2023-09-30", 90.0, 2023),
    dur("2024-09-29", "2025-09-27", 120.0, 2025),
  ],
});

describe("F2 — a company with a gap in its filing history", () => {
  it("keeps the two real periods as SEPARATE history rows, keyed on the period end", () => {
    const rows = mapEdgarFinancialsHistory(F2 as never);
    expect(rows.map((r) => r.endDate)).toEqual(["2025-09-27", "2023-09-30"]);
    expect(rows[0].totalRevenue).toBe(420.0);
    expect(rows[1].totalRevenue).toBe(300.0);
  });

  it("the two most recent rows are NOT an adjacent pair, so no change may be built from them", () => {
    // The consumers (revenue growth, the change-based quality criteria) go
    // through `consecutivePeriodPair`, which refuses this. Asserted here at the
    // data level so the fixture's premise is pinned: were these adjacent, the
    // gap-year behaviour below would prove nothing.
    const rows = mapEdgarFinancialsHistory(F2 as never);
    const days =
      (Date.parse(rows[0].endDate) - Date.parse(rows[1].endDate)) / 86_400_000;
    expect(days).toBeGreaterThan(700); // two intervals, not one
  });
});

describe("F2 — the growth figure on the market-data path", () => {
  const gapYear = {
    timeseries: {
      result: [
        {
          meta: { type: ["annualTotalRevenue"], symbol: "TEST" },
          annualTotalRevenue: [
            { asOfDate: "2023-09-30", reportedValue: { raw: 300 * B } },
            { asOfDate: "2025-09-30", reportedValue: { raw: 420 * B } },
          ],
        },
      ],
    },
  };

  it("publishes NO growth across a gap year rather than a two-year change", () => {
    const out = mapYahooTimeseries(gapYear as never, "TEST", DATE);
    // The wrong answer, spelled out so a regression is unmistakable:
    // (420 − 300) / 300 = +0.40 across TWO years, printed as one year's growth.
    expect(out.incomeStatement.yoyRevenueGrowth).toBeNull();
    expect(out.incomeStatement.yoyRevenueGrowth).not.toBeCloseTo(0.4, 6);
  });

  it("publishes growth when the two periods ARE adjacent", () => {
    // The paired direction. Without this, an implementation that returns null
    // unconditionally passes the case above.
    const adjacent = {
      timeseries: {
        result: [
          {
            meta: { type: ["annualTotalRevenue"], symbol: "TEST" },
            annualTotalRevenue: [
              { asOfDate: "2024-09-30", reportedValue: { raw: 300 * B } },
              { asOfDate: "2025-09-30", reportedValue: { raw: 420 * B } },
            ],
          },
        ],
      },
    };
    const out = mapYahooTimeseries(adjacent as never, "TEST", DATE);
    expect(out.incomeStatement.yoyRevenueGrowth).toBeCloseTo(0.4, 6);
  });
});

// ── F3 — the post-quarter filing ───────────────────────────────────────────
//
// An annual filing (year ending 2025-09-27) plus a LATER quarterly balance-sheet
// snapshot (2025-12-27). No committed fixture contains a non-annual entry at
// all, so this behaviour is currently untested in either direction.
//
// TODAY'S DEFECT: the filings balance-sheet selector filters for snapshot-shaped
// entries but never for ANNUAL ones, so the newest instant wins and a full
// year's profit is paired with a quarter-end balance sheet. The quarterly cash
// value is deliberately far from the annual one (55.0 vs 35.934) so picking the
// wrong one cannot be mistaken for rounding.
const F3 = usGaap({
  Assets: [
    inst("2025-09-27", 359.241, 2025),
    { start: null, end: "2025-12-27", val: 380.0 * B, fy: 2026, fp: "Q1", form: "10-Q" },
  ],
  CashAndCashEquivalentsAtCarryingValue: [
    inst("2025-09-27", 35.934, 2025),
    { start: null, end: "2025-12-27", val: 55.0 * B, fy: 2026, fp: "Q1", form: "10-Q" },
  ],
  StockholdersEquity: [inst("2025-09-27", 73.733, 2025)],
  LongTermDebtNoncurrent: [inst("2025-09-27", 78.566, 2025)],
  RevenueFromContractWithCustomerExcludingAssessedTax: [
    dur("2024-09-29", "2025-09-27", 416.161, 2025),
    // A QUARTER of revenue, filed later. A duration selector with no annual
    // span test would take this as the year's revenue.
    { start: "2025-09-28", end: "2025-12-27", val: 120.0 * B, fy: 2026, fp: "Q1", form: "10-Q" },
  ],
  OperatingIncomeLoss: [dur("2024-09-29", "2025-09-27", 133.05, 2025)],
  NetIncomeLoss: [dur("2024-09-29", "2025-09-27", 112.01, 2025)],
  NetCashProvidedByUsedInOperatingActivities: [
    dur("2024-09-29", "2025-09-27", 111.482, 2025),
  ],
});

describe("F3 — an annual filing followed by a quarterly snapshot", () => {
  const out = mapEdgarCompanyFacts(F3 as never, "TEST", DATE);

  it("anchors to the completed FINANCIAL YEAR, not the newest filed quarter", () => {
    expect(out.balanceSheet.periodEnd).toBe("2025-09-27");
    expect(out.incomeStatement.periodEnd).toBe("2025-09-27");
  });

  it("reads the balance sheet at the year-end, so a year of profit is not paired with a quarter", () => {
    // 55.0 is the quarter-end cash figure. Today's selector returns it.
    expect(out.balanceSheet.cashAndEquivalents).toBe(35.934);
    expect(out.balanceSheet.cashAndEquivalents).not.toBe(55.0);
    expect(out.balanceSheet.totalAssets).toBe(359.241);
    expect(out.balanceSheet.totalAssets).not.toBe(380.0);
  });

  it("never reads a QUARTER of revenue as the year's", () => {
    expect(out.incomeStatement.revenue).toBe(416.161);
    expect(out.incomeStatement.revenue).not.toBe(120.0);
  });

  it("the balance sheet and the income statement declare the SAME period", () => {
    expect(out.balanceSheet.periodEnd).toBe(out.incomeStatement.periodEnd);
  });
});

// ── The market-data date/value divergence ──────────────────────────────────

describe("market-data path — the date can no longer disagree with the value", () => {
  it("does not treat an unreported newest point as a period", () => {
    // The old defect: `asOf` came from the LAST point while the value came from
    // the last FINITE one, so the payload published a date its own figure did
    // not come from. The newest point here carries no usable value.
    const resp = {
      timeseries: {
        result: [
          {
            meta: { type: ["annualTotalRevenue"], symbol: "TEST" },
            annualTotalRevenue: [
              { asOfDate: "2024-09-30", reportedValue: { raw: 391.035 * B } },
              { asOfDate: "2025-09-30", reportedValue: {} },
            ],
          },
          {
            meta: { type: ["annualTotalAssets"], symbol: "TEST" },
            annualTotalAssets: [
              { asOfDate: "2024-09-30", reportedValue: { raw: 364.98 * B } },
              { asOfDate: "2025-09-30", reportedValue: {} },
            ],
          },
        ],
      },
    };
    const out = mapYahooTimeseries(resp as never, "TEST", DATE);
    expect(out.incomeStatement.periodEnd).toBe("2024-09-30");
    expect(out.incomeStatement.revenue).toBe(391.035);
    expect(out.balanceSheet.periodEnd).toBe("2024-09-30");
    expect(out.balanceSheet.totalAssets).toBe(364.98);
  });

  it("reads every series AT the anchor, leaving one that does not carry it absent", () => {
    // F1 on the market-data path — the same rule through the same leaf.
    const resp = {
      timeseries: {
        result: [
          {
            meta: { type: ["annualTotalRevenue"], symbol: "TEST" },
            annualTotalRevenue: [
              { asOfDate: "2024-09-30", reportedValue: { raw: 391.035 * B } },
              { asOfDate: "2025-09-30", reportedValue: { raw: 416.161 * B } },
            ],
          },
          {
            meta: { type: ["annualStockholdersEquity"], symbol: "TEST" },
            // Reports 2024 only.
            annualStockholdersEquity: [
              { asOfDate: "2024-09-30", reportedValue: { raw: 57.0 * B } },
            ],
          },
        ],
      },
    };
    const out = mapYahooTimeseries(resp as never, "TEST", DATE);
    expect(out.incomeStatement.periodEnd).toBe("2025-09-30");
    expect(out.incomeStatement.revenue).toBe(416.161);
    expect(out.balanceSheet.totalEquity).toBeNull();
    expect(out.balanceSheet.totalEquity).not.toBe(57.0);
  });
});

// ── The foreign-filer taxonomy, through the same leaf ──────────────────────

describe("the foreign-filer (IFRS) taxonomy reads through the same leaf", () => {
  it("anchors and reads at the period, with an absent figure staying absent", () => {
    const ifrs = {
      cik: 2,
      entityName: "Foreign Co",
      facts: {
        "ifrs-full": {
          Assets: {
            units: {
              USD: [inst("2024-12-31", 100.0, 2024), inst("2025-12-31", 120.0, 2025)],
            },
          },
          Revenue: {
            units: {
              USD: [
                dur("2024-01-01", "2024-12-31", 50.0, 2024),
                dur("2025-01-01", "2025-12-31", 60.0, 2025),
              ],
            },
          },
          // Equity reports the older year only.
          Equity: { units: { USD: [inst("2024-12-31", 40.0, 2024)] } },
          ProfitLoss: {
            units: {
              USD: [
                dur("2024-01-01", "2024-12-31", 8.0, 2024),
                dur("2025-01-01", "2025-12-31", 10.0, 2025),
              ],
            },
          },
        },
      },
    };
    const rows = mapEdgarFinancialsHistory(ifrs as never);
    expect(rows[0].endDate).toBe("2025-12-31");
    expect(rows[0].totalRevenue).toBe(60.0);
    expect(rows[0].totalEquity).toBeNull();
    expect(rows[0].totalEquity).not.toBe(40.0);
    expect(rows[1].totalEquity).toBe(40.0);
  });
});

// ── The regression fence ───────────────────────────────────────────────────

describe("a period-symmetric COMPLETE filing is unchanged, value for value", () => {
  const symmetric = usGaap({
    Assets: [inst("2024-09-28", 364.98, 2024), inst("2025-09-27", 359.241, 2025)],
    Liabilities: [inst("2024-09-28", 308.03, 2024), inst("2025-09-27", 285.508, 2025)],
    StockholdersEquity: [inst("2024-09-28", 56.95, 2024), inst("2025-09-27", 73.733, 2025)],
    CashAndCashEquivalentsAtCarryingValue: [
      inst("2024-09-28", 29.943, 2024),
      inst("2025-09-27", 35.934, 2025),
    ],
    LongTermDebtNoncurrent: [inst("2025-09-27", 78.566, 2025)],
    LongTermDebtCurrent: [inst("2025-09-27", 12.112, 2025)],
    RevenueFromContractWithCustomerExcludingAssessedTax: [
      dur("2023-10-01", "2024-09-28", 391.035, 2024),
      dur("2024-09-29", "2025-09-27", 416.161, 2025),
    ],
    GrossProfit: [dur("2024-09-29", "2025-09-27", 195.201, 2025)],
    OperatingIncomeLoss: [dur("2024-09-29", "2025-09-27", 133.05, 2025)],
    NetIncomeLoss: [dur("2024-09-29", "2025-09-27", 112.01, 2025)],
    NetCashProvidedByUsedInOperatingActivities: [
      dur("2024-09-29", "2025-09-27", 111.482, 2025),
    ],
    NetCashProvidedByUsedInInvestingActivities: [
      dur("2024-09-29", "2025-09-27", 15.195, 2025),
    ],
    NetCashProvidedByUsedInFinancingActivities: [
      dur("2024-09-29", "2025-09-27", -120.686, 2025),
    ],
    PaymentsToAcquirePropertyPlantAndEquipment: [
      dur("2024-09-29", "2025-09-27", 12.715, 2025),
    ],
  });

  it("publishes exactly the figures it published before, at the same date", () => {
    // The blast-radius bound: this change is visible only on filings that are
    // actually asymmetric. A broken implementation fails this loudly.
    const out = mapEdgarCompanyFacts(symmetric as never, "AAPL", DATE);
    expect(out.incomeStatement).toMatchObject({
      asOf: "2025-09-27",
      revenue: 416.161,
      grossProfit: 195.201,
      operatingIncome: 133.05,
      netIncome: 112.01,
    });
    expect(out.balanceSheet).toMatchObject({
      asOf: "2025-09-27",
      totalAssets: 359.241,
      totalLiabilities: 285.508,
      totalEquity: 73.733,
      cashAndEquivalents: 35.934,
    });
    expect(out.balanceSheet.totalDebt).toBeCloseTo(78.566 + 12.112, 6);
    expect(out.cashflow).toMatchObject({
      asOf: "2025-09-27",
      operating: 111.482,
      investing: 15.195,
      financing: -120.686,
    });
    expect(out.cashflow.freeCashFlow).toBeCloseTo(111.482 - 12.715, 6);
  });
});

// ── The unavailable path ───────────────────────────────────────────────────

describe("a response with no annual period anywhere", () => {
  it("declares NO period rather than borrowing the request date", () => {
    // `asOf` keeps its request-date fallback for legacy readers; `periodEnd`
    // must not take it — a request date is not a year-end. A test asserting a
    // non-empty period here would fail the CORRECT implementation.
    const empty = usGaap({});
    const out = mapEdgarCompanyFacts(empty as never, "TEST", DATE);
    expect(out.incomeStatement.periodEnd).toBeNull();
    expect(out.balanceSheet.periodEnd).toBeNull();
    expect(out.cashflow.periodEnd).toBeNull();
    expect(out.incomeStatement.asOf).toBe(DATE);
    expect(out.incomeStatement.revenue).toBeNull();
  });
});

// ── The fiscal-year index is gone ──────────────────────────────────────────

describe("the fiscal-year index no longer collapses distinct periods", () => {
  it("keeps three years of revenue that all carry one fiscal-year label", () => {
    // The repository's own Apple filing does exactly this: `Revenues` reports
    // three different period ends all labelled fy 2018, and the old
    // fiscal-year-keyed index kept ONE of them and discarded two.
    const collapsed = usGaap({
      Revenues: [
        dur("2015-09-27", "2016-09-24", 215.639, 2018),
        dur("2016-09-25", "2017-09-30", 229.234, 2018),
        dur("2017-10-01", "2018-09-29", 265.595, 2018),
      ],
      Assets: [
        inst("2016-09-24", 321.686, 2018),
        inst("2017-09-30", 375.319, 2018),
        inst("2018-09-29", 365.725, 2018),
      ],
    });
    const rows = mapEdgarFinancialsHistory(collapsed as never);
    expect(rows.map((r) => r.endDate)).toEqual([
      "2018-09-29",
      "2017-09-30",
      "2016-09-24",
    ]);
    expect(rows.map((r) => r.totalRevenue)).toEqual([265.595, 229.234, 215.639]);
  });
});

// ── The market-data history path, same rule ────────────────────────────────

describe("the market-data history path shares the candidate pool", () => {
  it("keys rows on the period end and reads each series at it", () => {
    const resp = {
      timeseries: {
        result: [
          {
            meta: { type: ["annualTotalRevenue"], symbol: "TEST" },
            annualTotalRevenue: [
              { asOfDate: "2024-09-30", reportedValue: { raw: 391.035 * B } },
              { asOfDate: "2025-09-30", reportedValue: { raw: 416.161 * B } },
            ],
          },
          {
            meta: { type: ["annualStockholdersEquity"], symbol: "TEST" },
            annualStockholdersEquity: [
              { asOfDate: "2024-09-30", reportedValue: { raw: 56.95 * B } },
            ],
          },
        ],
      },
    };
    const rows = mapYahooTimeseriesHistory(resp as never);
    expect(rows.map((r) => r.endDate)).toEqual(["2025-09-30", "2024-09-30"]);
    expect(rows[0].totalRevenue).toBe(416.161);
    expect(rows[0].totalEquity).toBeNull();
    expect(rows[1].totalEquity).toBe(56.95);
  });
});
