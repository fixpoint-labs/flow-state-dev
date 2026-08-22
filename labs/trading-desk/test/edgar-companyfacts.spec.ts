/**
 * Unit tests for the pure SEC EDGAR companyfacts mapper.
 *
 * EDGAR is the authoritative statements source (primary, ahead of Yahoo) for
 * the three statement tools. The mapping is non-trivial: balance-sheet facts
 * are instant (end-date only) while income/cashflow facts are duration
 * (start+end), total debt has no single tag, and revenue lives under one of
 * two tags depending on filing era. These tests pin that selection against a
 * captured live AAPL companyfacts response.
 */
import { describe, expect, it } from "vitest";
import {
  mapEdgarCompanyFacts,
  mapEdgarFinancialsHistory,
  type EdgarCompanyFacts,
} from "../lib/providers/edgar-companyfacts";
import { altmanZDoublePrime } from "../flows/analysis/tools/data/composite-math";

import rawAapl from "./__fixtures__/edgar-companyfacts-aapl.json";

/** Two-fiscal-year companyfacts covering the line items the composites need —
 *  including current assets/liabilities and retained earnings, which the
 *  single-period statement mapper does not surface (so Altman X1/X2 were
 *  always uncomputable before). Instant facts (balance sheet) carry no
 *  `start`; duration facts (income/cashflow) span a full fiscal year. */
const twoYear: EdgarCompanyFacts = {
  cik: 1,
  entityName: "Test",
  facts: {
    "us-gaap": {
      Assets: { units: { USD: [
        { end: "2023-09-30", val: 352e9, form: "10-K", fp: "FY", fy: 2023 },
        { end: "2024-09-28", val: 364e9, form: "10-K", fp: "FY", fy: 2024 },
      ] } },
      AssetsCurrent: { units: { USD: [
        { end: "2023-09-30", val: 143e9, form: "10-K", fp: "FY", fy: 2023 },
        { end: "2024-09-28", val: 152e9, form: "10-K", fp: "FY", fy: 2024 },
      ] } },
      LiabilitiesCurrent: { units: { USD: [
        { end: "2023-09-30", val: 145e9, form: "10-K", fp: "FY", fy: 2023 },
        { end: "2024-09-28", val: 176e9, form: "10-K", fp: "FY", fy: 2024 },
      ] } },
      Liabilities: { units: { USD: [
        { end: "2023-09-30", val: 290e9, form: "10-K", fp: "FY", fy: 2023 },
        { end: "2024-09-28", val: 308e9, form: "10-K", fp: "FY", fy: 2024 },
      ] } },
      RetainedEarningsAccumulatedDeficit: { units: { USD: [
        { end: "2023-09-30", val: 8e9, form: "10-K", fp: "FY", fy: 2023 },
        { end: "2024-09-28", val: 4e9, form: "10-K", fp: "FY", fy: 2024 },
      ] } },
      StockholdersEquity: { units: { USD: [
        { end: "2023-09-30", val: 62e9, form: "10-K", fp: "FY", fy: 2023 },
        { end: "2024-09-28", val: 56e9, form: "10-K", fp: "FY", fy: 2024 },
      ] } },
      Revenues: { units: { USD: [
        { start: "2022-10-01", end: "2023-09-30", val: 383e9, form: "10-K", fp: "FY", fy: 2023 },
        { start: "2023-10-01", end: "2024-09-28", val: 391e9, form: "10-K", fp: "FY", fy: 2024 },
      ] } },
      GrossProfit: { units: { USD: [
        { start: "2022-10-01", end: "2023-09-30", val: 169e9, form: "10-K", fp: "FY", fy: 2023 },
        { start: "2023-10-01", end: "2024-09-28", val: 180e9, form: "10-K", fp: "FY", fy: 2024 },
      ] } },
      OperatingIncomeLoss: { units: { USD: [
        { start: "2022-10-01", end: "2023-09-30", val: 114e9, form: "10-K", fp: "FY", fy: 2023 },
        { start: "2023-10-01", end: "2024-09-28", val: 123e9, form: "10-K", fp: "FY", fy: 2024 },
      ] } },
      NetIncomeLoss: { units: { USD: [
        { start: "2022-10-01", end: "2023-09-30", val: 97e9, form: "10-K", fp: "FY", fy: 2023 },
        { start: "2023-10-01", end: "2024-09-28", val: 93e9, form: "10-K", fp: "FY", fy: 2024 },
      ] } },
      NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
        { start: "2022-10-01", end: "2023-09-30", val: 110e9, form: "10-K", fp: "FY", fy: 2023 },
        { start: "2023-10-01", end: "2024-09-28", val: 118e9, form: "10-K", fp: "FY", fy: 2024 },
      ] } },
    },
  },
};

const aapl = () =>
  mapEdgarCompanyFacts(rawAapl as EdgarCompanyFacts, "AAPL", "2026-05-06");

describe("mapEdgarCompanyFacts — income statement", () => {
  it("maps revenue/grossProfit/operatingIncome/netIncome from us-gaap tags (in $B)", () => {
    const { incomeStatement } = aapl();
    expect(incomeStatement.grossProfit).toBeCloseTo(195.2, 1);
    expect(incomeStatement.operatingIncome).toBeCloseTo(133.1, 1);
    expect(incomeStatement.netIncome).toBeCloseTo(112.0, 1);
    expect(incomeStatement.source).toBe("edgar");
  });

  it("picks the most RECENT revenue across both revenue tags, not a fixed preference", () => {
    // The fixture has `Revenues` ending 2018 (stale — Apple switched tags) and
    // `RevenueFromContractWithCustomerExcludingAssessedTax` ending 2025. A naive
    // "prefer Revenues" would return the 7-year-old 265.6; the mapper must pick
    // the latest-period value (416.2).
    const { incomeStatement } = aapl();
    expect(incomeStatement.revenue).toBeCloseTo(416.2, 1);
  });
});

describe("mapEdgarCompanyFacts — balance sheet (instant facts)", () => {
  it("maps totals from the latest annual instant snapshot (in $B)", () => {
    const { balanceSheet } = aapl();
    expect(balanceSheet.totalAssets).toBeCloseTo(359.2, 1);
    expect(balanceSheet.totalLiabilities).toBeCloseTo(285.5, 1);
    expect(balanceSheet.totalEquity).toBeCloseTo(73.7, 1);
    expect(balanceSheet.cashAndEquivalents).toBeCloseTo(35.9, 1);
    expect(balanceSheet.source).toBe("edgar");
  });

  it("sums total debt from current + noncurrent long-term debt", () => {
    // EDGAR has no single total-debt tag: 78.3 (noncurrent) + 12.3 (current) = 90.7
    const { balanceSheet } = aapl();
    expect(balanceSheet.totalDebt).toBeCloseTo(90.7, 1);
  });
});

describe("mapEdgarCompanyFacts — cashflow (duration facts)", () => {
  it("maps operating cash flow and computes FCF = operating - capex (in $B)", () => {
    // EDGAR reports capex (PaymentsToAcquire...) as a positive outflow, so
    // FCF = 111.5 - 12.7 = 98.8 (Yahoo reports capex negative; the sign
    // convention differs by source and the mapper handles EDGAR's).
    const { cashflow } = aapl();
    expect(cashflow.operating).toBeCloseTo(111.5, 1);
    expect(cashflow.freeCashFlow).toBeCloseTo(98.8, 1);
    expect(cashflow.source).toBe("edgar");
  });
});

describe("mapEdgarCompanyFacts — missing tags map to null, not 0", () => {
  it("returns null for a statement field whose us-gaap tag is absent", () => {
    const sparse: EdgarCompanyFacts = {
      cik: 1,
      entityName: "Test",
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                { end: "2025-09-27", val: 100_000_000_000, form: "10-K", fp: "FY" },
              ],
            },
          },
        },
      },
    };
    const { balanceSheet, incomeStatement, cashflow } = mapEdgarCompanyFacts(
      sparse,
      "TEST",
      "2026-05-06",
    );
    expect(balanceSheet.totalAssets).toBeCloseTo(100, 1);
    // Everything else absent → null, never 0.
    expect(balanceSheet.totalEquity).toBeNull();
    expect(balanceSheet.totalDebt).toBeNull();
    expect(incomeStatement.revenue).toBeNull();
    expect(incomeStatement.grossProfit).toBeNull();
    expect(cashflow.freeCashFlow).toBeNull();
  });
});

describe("mapEdgarCompanyFacts — total debt: a single leg is not zero-filled (review round 6, P1)", () => {
  // `LongTermDebtNoncurrent` / `LongTermDebtCurrent` / `LongTermDebt` are
  // themselves anchor-discovery tags, so every fixture here also carries
  // `Assets` at the intended anchor to keep the anchor choice unambiguous
  // and independent of which debt tags are present.
  const anchorEnd = "2025-12-31";
  const priorYear = "2024-12-31";

  function debtFixture(opts: {
    noncurrent?: number;
    current?: number;
    currentAt?: string;
    combined?: number;
  }): EdgarCompanyFacts {
    const usGaap: Record<string, { units: { USD: Array<Record<string, unknown>> } }> = {
      Assets: { units: { USD: [{ end: anchorEnd, val: 400e9, form: "10-K", fp: "FY", fy: 2025 }] } },
    };
    if (opts.noncurrent != null) {
      usGaap.LongTermDebtNoncurrent = {
        units: { USD: [{ end: anchorEnd, val: opts.noncurrent, form: "10-K", fp: "FY", fy: 2025 }] },
      };
    }
    if (opts.current != null) {
      usGaap.LongTermDebtCurrent = {
        units: {
          USD: [{ end: opts.currentAt ?? anchorEnd, val: opts.current, form: "10-K", fp: "FY", fy: 2025 }],
        },
      };
    }
    if (opts.combined != null) {
      usGaap.LongTermDebt = {
        units: { USD: [{ end: anchorEnd, val: opts.combined, form: "10-K", fp: "FY", fy: 2025 }] },
      };
    }
    return { cik: 1, entityName: "Test", facts: { "us-gaap": usGaap } };
  }

  it("THE BUG: noncurrent at the anchor, current only in a PRIOR year -> total debt is null, not the noncurrent figure alone", () => {
    const { balanceSheet } = mapEdgarCompanyFacts(
      debtFixture({ noncurrent: 50e9, current: 8e9, currentAt: priorYear }),
      "TEST",
      "2026-05-06",
    );
    expect(balanceSheet.periodEnd).toBe(anchorEnd);
    expect(balanceSheet.totalDebt).toBeNull();
    // Naming what a regression would look like: the noncurrent leg alone.
    expect(balanceSheet.totalDebt).not.toBeCloseTo(50, 1);
  });

  it("control: both legs present at the anchor still sums", () => {
    const { balanceSheet } = mapEdgarCompanyFacts(
      debtFixture({ noncurrent: 50e9, current: 8e9 }),
      "TEST",
      "2026-05-06",
    );
    expect(balanceSheet.totalDebt).toBeCloseTo(58, 1);
  });

  it("control: an explicit tagged zero for one leg still yields a real figure, not null", () => {
    // A filer that tags `LongTermDebtCurrent: 0` (has none, said so) is not the
    // same shape as one who never tagged it at all — `valueAtB` must tell them
    // apart, since a fact entry exists here with a real (zero) value.
    const { balanceSheet } = mapEdgarCompanyFacts(
      debtFixture({ noncurrent: 50e9, current: 0 }),
      "TEST",
      "2026-05-06",
    );
    expect(balanceSheet.totalDebt).toBeCloseTo(50, 1);
    expect(balanceSheet.totalDebt).not.toBeNull();
  });

  it("control: a combined-only filer (no split tags at the anchor) still resolves via LongTermDebt", () => {
    const { balanceSheet } = mapEdgarCompanyFacts(
      debtFixture({ combined: 60e9 }),
      "TEST",
      "2026-05-06",
    );
    expect(balanceSheet.totalDebt).toBeCloseTo(60, 1);
  });
});

describe("mapEdgarCompanyFacts — a quarterly filing cannot become the annual anchor (review round 6, P2)", () => {
  it("THE BUG: a 10-Q instant with no fp, dated after the last 10-K, is not selected as the anchor", () => {
    const tenK = "2024-12-31";
    const tenQAfter = "2025-03-31"; // newer than the 10-K, but a quarter-end
    const facts: EdgarCompanyFacts = {
      cik: 1,
      entityName: "Test",
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                { end: tenK, val: 400e9, form: "10-K", fp: "FY", fy: 2024 },
                // No `fp` at all — the exact shape that slipped past a check
                // that only ever looked at `fp`.
                { end: tenQAfter, val: 420e9, form: "10-Q" },
              ],
            },
          },
        },
      },
    };
    const { balanceSheet } = mapEdgarCompanyFacts(facts, "TEST", "2026-05-06");
    expect(balanceSheet.periodEnd).toBe(tenK);
    expect(balanceSheet.totalAssets).toBeCloseTo(400, 0);
  });

  it("control: a 10-K with no fp at all is still selected as the anchor over an older 10-Q", () => {
    // Otherwise the fix reads as "reject everything undated" rather than
    // "reject known quarterly forms."
    const olderTenQ = "2023-12-31";
    const newerTenK = "2024-12-31";
    const facts: EdgarCompanyFacts = {
      cik: 1,
      entityName: "Test",
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                { end: olderTenQ, val: 300e9, form: "10-Q" },
                { end: newerTenK, val: 400e9, form: "10-K" }, // no `fp`
              ],
            },
          },
        },
      },
    };
    const { balanceSheet } = mapEdgarCompanyFacts(facts, "TEST", "2026-05-06");
    expect(balanceSheet.periodEnd).toBe(newerTenK);
    expect(balanceSheet.totalAssets).toBeCloseTo(400, 0);
  });
});

describe("mapEdgarCompanyFacts — an instant fact needs AFFIRMATIVE annual evidence, not absence of a denylisted form (Codex review, FIX-1113)", () => {
  it("THE BUG: an 8-K instant with no fp, dated after the last 10-K, is not selected as the anchor", () => {
    // `QUARTERLY_FORMS` rejected `10-Q`/`10-Q/A` by name and admitted every
    // other form by default — including an 8-K, an S-1, a 424B4, or any form
    // this codebase has never seen. Our own fixtures carry 8-K, S-1/A, and
    // 424B4 (`git grep '"form"'`), so this is not a hypothetical.
    const tenK = "2024-12-31";
    const eightKAfter = "2025-03-31"; // newer than the 10-K, not an annual filing
    const facts: EdgarCompanyFacts = {
      cik: 1,
      entityName: "Test",
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                { end: tenK, val: 400e9, form: "10-K", fp: "FY", fy: 2024 },
                // No `fp` at all, and a form no denylist named.
                { end: eightKAfter, val: 420e9, form: "8-K" },
              ],
            },
          },
        },
      },
    };
    const { balanceSheet } = mapEdgarCompanyFacts(facts, "TEST", "2026-05-06");
    expect(balanceSheet.periodEnd).toBe(tenK);
    expect(balanceSheet.totalAssets).toBeCloseTo(400, 0);
  });

  it("control: a 10-K with no fp at all is still selected (the form allowlist alone is enough)", () => {
    const olderEightK = "2023-12-31";
    const newerTenK = "2024-12-31";
    const facts: EdgarCompanyFacts = {
      cik: 1,
      entityName: "Test",
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                { end: olderEightK, val: 300e9, form: "8-K" },
                { end: newerTenK, val: 400e9, form: "10-K" }, // no `fp`
              ],
            },
          },
        },
      },
    };
    const { balanceSheet } = mapEdgarCompanyFacts(facts, "TEST", "2026-05-06");
    expect(balanceSheet.periodEnd).toBe(newerTenK);
    expect(balanceSheet.totalAssets).toBeCloseTo(400, 0);
  });

  it("control: fp: \"FY\" wins regardless of form (a filer whose form we don't recognize)", () => {
    const olderTenK = "2023-12-31";
    const newerUnknownForm = "2024-12-31";
    const facts: EdgarCompanyFacts = {
      cik: 1,
      entityName: "Test",
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                { end: olderTenK, val: 300e9, form: "10-K", fp: "FY" },
                // A form this codebase has never seen, but fp says FY.
                { end: newerUnknownForm, val: 400e9, form: "NT 10-K", fp: "FY" },
              ],
            },
          },
        },
      },
    };
    const { balanceSheet } = mapEdgarCompanyFacts(facts, "TEST", "2026-05-06");
    expect(balanceSheet.periodEnd).toBe(newerUnknownForm);
    expect(balanceSheet.totalAssets).toBeCloseTo(400, 0);
  });

  it("control: a 10-Q with no fp still fails to win the anchor (unchanged from the prior fix)", () => {
    const tenK = "2024-12-31";
    const tenQAfter = "2025-03-31";
    const facts: EdgarCompanyFacts = {
      cik: 1,
      entityName: "Test",
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                { end: tenK, val: 400e9, form: "10-K", fp: "FY", fy: 2024 },
                { end: tenQAfter, val: 420e9, form: "10-Q" },
              ],
            },
          },
        },
      },
    };
    const { balanceSheet } = mapEdgarCompanyFacts(facts, "TEST", "2026-05-06");
    expect(balanceSheet.periodEnd).toBe(tenK);
    expect(balanceSheet.totalAssets).toBeCloseTo(400, 0);
  });

  it("an entry with NEITHER form NOR fp carries no affirmative annual evidence and is rejected", () => {
    const tenK = "2024-12-31";
    const undocumented = "2025-03-31";
    const facts: EdgarCompanyFacts = {
      cik: 1,
      entityName: "Test",
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                { end: tenK, val: 400e9, form: "10-K", fp: "FY", fy: 2024 },
                { end: undocumented, val: 420e9 }, // neither field present
              ],
            },
          },
        },
      },
    };
    const { balanceSheet } = mapEdgarCompanyFacts(facts, "TEST", "2026-05-06");
    expect(balanceSheet.periodEnd).toBe(tenK);
    expect(balanceSheet.totalAssets).toBeCloseTo(400, 0);
  });
});

describe("mapEdgarFinancialsHistory — multi-period for composites", () => {
  it("returns one period per fiscal year, newest first, with the composite line items", () => {
    const periods = mapEdgarFinancialsHistory(twoYear);
    expect(periods).toHaveLength(2);

    const fy24 = periods[0];
    expect(fy24.endDate).toBe("2024-09-28");
    // The fields the single-period mapper never surfaced — the X1/X2 inputs:
    expect(fy24.totalCurrentAssets).toBeCloseTo(152, 0);
    expect(fy24.totalCurrentLiabilities).toBeCloseTo(176, 0);
    expect(fy24.retainedEarnings).toBeCloseTo(4, 0);
    expect(fy24.totalAssets).toBeCloseTo(364, 0);
    expect(fy24.operatingIncome).toBeCloseTo(123, 0);
    expect(fy24.netIncome).toBeCloseTo(93, 0);
    expect(fy24.cfo).toBeCloseTo(118, 0);

    // Prior period present so Piotroski's change-based criteria can compute.
    expect(periods[1].endDate).toBe("2023-09-30");
    expect(periods[1].totalAssets).toBeCloseTo(352, 0);
  });

  it("makes Altman Z'' computable (X1 + X2 now populated) — the end-to-end fix", () => {
    const fy24 = mapEdgarFinancialsHistory(twoYear)[0];
    const altman = altmanZDoublePrime({
      totalAssets: fy24.totalAssets,
      totalCurrentAssets: fy24.totalCurrentAssets,
      totalCurrentLiabilities: fy24.totalCurrentLiabilities,
      totalLiabilities: fy24.totalLiabilities,
      retainedEarnings: fy24.retainedEarnings,
      totalEquity: fy24.totalEquity,
      totalRevenue: fy24.totalRevenue,
      costOfRevenue: fy24.costOfRevenue,
      grossProfit: fy24.grossProfit,
      operatingIncome: fy24.operatingIncome,
      netIncome: fy24.netIncome,
      cfo: fy24.cfo,
      capitalExpenditures: fy24.capitalExpenditures,
      sharesOutstanding: null,
    });
    expect(altman).not.toBeNull();
    // All four inputs present → no missing-input flags.
    expect(altman!.missingInputs).toHaveLength(0);
  });

  it("returns an empty array when no annual facts are present", () => {
    expect(mapEdgarFinancialsHistory({ facts: { "us-gaap": {} } })).toEqual([]);
  });
});

/** A foreign private issuer (20-F) reports under `ifrs-full`, not `us-gaap`,
 *  with a USD convenience translation alongside the local currency. Shaped on
 *  TSM's real companyfacts: instant balance-sheet facts (no `start`), duration
 *  income/cashflow facts (full fiscal year), USD units. */
const ifrsTwoYear: EdgarCompanyFacts = {
  cik: 1046179,
  entityName: "Taiwan Semiconductor Manufacturing Company Limited",
  facts: {
    "ifrs-full": {
      Assets: { units: { USD: [
        { end: "2023-12-31", val: 187e9, form: "20-F", fp: "FY", fy: 2023 },
        { end: "2024-12-31", val: 204e9, form: "20-F", fp: "FY", fy: 2024 },
      ] } },
      CurrentAssets: { units: { USD: [
        { end: "2023-12-31", val: 88e9, form: "20-F", fp: "FY", fy: 2023 },
        { end: "2024-12-31", val: 94e9, form: "20-F", fp: "FY", fy: 2024 },
      ] } },
      CurrentLiabilities: { units: { USD: [
        { end: "2023-12-31", val: 34e9, form: "20-F", fp: "FY", fy: 2023 },
        { end: "2024-12-31", val: 40e9, form: "20-F", fp: "FY", fy: 2024 },
      ] } },
      Liabilities: { units: { USD: [
        { end: "2023-12-31", val: 73e9, form: "20-F", fp: "FY", fy: 2023 },
        { end: "2024-12-31", val: 74e9, form: "20-F", fp: "FY", fy: 2024 },
      ] } },
      RetainedEarnings: { units: { USD: [
        { end: "2023-12-31", val: 105e9, form: "20-F", fp: "FY", fy: 2023 },
        { end: "2024-12-31", val: 118e9, form: "20-F", fp: "FY", fy: 2024 },
      ] } },
      Equity: { units: { USD: [
        { end: "2023-12-31", val: 114e9, form: "20-F", fp: "FY", fy: 2023 },
        { end: "2024-12-31", val: 130e9, form: "20-F", fp: "FY", fy: 2024 },
      ] } },
      Revenue: { units: { USD: [
        { start: "2023-01-01", end: "2023-12-31", val: 69e9, form: "20-F", fp: "FY", fy: 2023 },
        { start: "2024-01-01", end: "2024-12-31", val: 88e9, form: "20-F", fp: "FY", fy: 2024 },
      ] } },
      CostOfSales: { units: { USD: [
        { start: "2023-01-01", end: "2023-12-31", val: 34e9, form: "20-F", fp: "FY", fy: 2023 },
        { start: "2024-01-01", end: "2024-12-31", val: 39e9, form: "20-F", fp: "FY", fy: 2024 },
      ] } },
      GrossProfit: { units: { USD: [
        { start: "2023-01-01", end: "2023-12-31", val: 35e9, form: "20-F", fp: "FY", fy: 2023 },
        { start: "2024-01-01", end: "2024-12-31", val: 49e9, form: "20-F", fp: "FY", fy: 2024 },
      ] } },
      ProfitLossFromOperatingActivities: { units: { USD: [
        { start: "2023-01-01", end: "2023-12-31", val: 30e9, form: "20-F", fp: "FY", fy: 2023 },
        { start: "2024-01-01", end: "2024-12-31", val: 40e9, form: "20-F", fp: "FY", fy: 2024 },
      ] } },
      ProfitLoss: { units: { USD: [
        { start: "2023-01-01", end: "2023-12-31", val: 27e9, form: "20-F", fp: "FY", fy: 2023 },
        { start: "2024-01-01", end: "2024-12-31", val: 35e9, form: "20-F", fp: "FY", fy: 2024 },
      ] } },
      CashFlowsFromUsedInOperatingActivities: { units: { USD: [
        { start: "2023-01-01", end: "2023-12-31", val: 48e9, form: "20-F", fp: "FY", fy: 2023 },
        { start: "2024-01-01", end: "2024-12-31", val: 56e9, form: "20-F", fp: "FY", fy: 2024 },
      ] } },
    },
  },
};

describe("mapEdgarFinancialsHistory — ifrs-full (foreign private issuers, e.g. TSM)", () => {
  it("maps IFRS tags when us-gaap is absent, in USD, newest first", () => {
    const periods = mapEdgarFinancialsHistory(ifrsTwoYear);
    expect(periods).toHaveLength(2);
    const fy24 = periods[0];
    expect(fy24.endDate).toBe("2024-12-31");
    expect(fy24.totalAssets).toBeCloseTo(204, 0);
    expect(fy24.totalCurrentAssets).toBeCloseTo(94, 0);
    expect(fy24.totalCurrentLiabilities).toBeCloseTo(40, 0);
    expect(fy24.retainedEarnings).toBeCloseTo(118, 0);
    expect(fy24.totalEquity).toBeCloseTo(130, 0);
    expect(fy24.operatingIncome).toBeCloseTo(40, 0); // ProfitLossFromOperatingActivities
    expect(fy24.netIncome).toBeCloseTo(35, 0); // ProfitLoss
    expect(fy24.cfo).toBeCloseTo(56, 0);
    expect(fy24.costOfRevenue).toBeCloseTo(39, 0);
  });

  it("makes Altman Z'' computable for an IFRS filer (the TSM regression)", () => {
    const fy24 = mapEdgarFinancialsHistory(ifrsTwoYear)[0];
    const altman = altmanZDoublePrime({
      totalAssets: fy24.totalAssets,
      totalCurrentAssets: fy24.totalCurrentAssets,
      totalCurrentLiabilities: fy24.totalCurrentLiabilities,
      totalLiabilities: fy24.totalLiabilities,
      retainedEarnings: fy24.retainedEarnings,
      totalEquity: fy24.totalEquity,
      totalRevenue: fy24.totalRevenue,
      costOfRevenue: fy24.costOfRevenue,
      grossProfit: fy24.grossProfit,
      operatingIncome: fy24.operatingIncome,
      netIncome: fy24.netIncome,
      cfo: fy24.cfo,
      capitalExpenditures: fy24.capitalExpenditures,
      sharesOutstanding: null,
    });
    expect(altman).not.toBeNull();
    expect(altman!.missingInputs).toHaveLength(0);
    // TSM is a financially strong name → safe zone.
    expect(altman!.zone).toBe("safe");
  });

  it("prefers us-gaap when both taxonomies carry data", () => {
    const both: EdgarCompanyFacts = {
      facts: {
        "us-gaap": (twoYear.facts!["us-gaap"]!),
        "ifrs-full": (ifrsTwoYear.facts!["ifrs-full"]!),
      },
    };
    const periods = mapEdgarFinancialsHistory(both);
    // us-gaap FY2024 totalAssets is 364; ifrs is 204.
    expect(periods[0].totalAssets).toBeCloseTo(364, 0);
  });

  it("a 20-F with no fp at all is still selected over a non-annual form (this codebase's own confirmed annual form, Codex review FIX-1113)", () => {
    // 20-F is a real, already-supported form in this mapper (this fixture, this
    // describe block) — it belongs in the annual-form allowlist alongside 10-K.
    const olderEightK = "2023-06-30";
    const newerTwentyF = "2023-12-31";
    const facts: EdgarCompanyFacts = {
      facts: {
        "ifrs-full": {
          Assets: {
            units: {
              USD: [
                { end: olderEightK, val: 300e9, form: "8-K" },
                { end: newerTwentyF, val: 400e9, form: "20-F" }, // no `fp`
              ],
            },
          },
        },
      },
    };
    const periods = mapEdgarFinancialsHistory(facts);
    expect(periods).toHaveLength(1);
    expect(periods[0].endDate).toBe(newerTwentyF);
    expect(periods[0].totalAssets).toBeCloseTo(400, 0);
  });
});
