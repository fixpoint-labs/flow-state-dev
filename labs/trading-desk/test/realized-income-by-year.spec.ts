/**
 * Unit tests for `buildRealizedIncomeByYear` — the pure view-model behind the
 * household Gains & Taxes year cards (FIX-885 follow-up).
 *
 * Node + `.spec.ts` (no JSX), so the load-bearing combine logic is tested
 * directly, the `realized-gains-row-model.spec` precedent. INTENT-ENCODING:
 *
 *   - a year's total realized income = capital gains + dividends + interest;
 *   - the year set is the UNION of disposal years and income years — an
 *     income-only year (no disposals) keeps a known $0 capital gain, a
 *     gains-only year keeps $0 income (the events didn't happen);
 *   - a non-display-currency income row gates that year's dividends/interest to
 *     "—" (null), mirroring the gains currency gate — never a cross-currency sum;
 *   - a null capital-gains total (basis-unknown / currency) makes total income
 *     null too (a total that dropped an unknown contributor would misstate it);
 *   - years come back newest-first.
 */
import { describe, expect, it } from "vitest";
import { buildRealizedIncomeByYear } from "../components/portfolio/realized-income-by-year";
import type { IncomeSummaryByYearRow, RealizedGainRow } from "../db/repository";

function gain(overrides: Partial<RealizedGainRow> = {}): RealizedGainRow {
  return {
    id: "g1",
    accountId: "acc1",
    userId: "u1",
    ticker: "NVDA",
    disposedDate: "2026-03-15",
    acquiredDate: "2024-01-10",
    quantity: 10,
    proceeds: 1200,
    costBasis: 1000,
    gain: 200,
    term: "long",
    currency: "USD",
    basisUnknown: null,
    disposalEventId: "d1",
    lotIndex: 0,
    createdAt: "2026-03-15T00:00:00Z",
    ...overrides,
  };
}

function income(
  overrides: Partial<IncomeSummaryByYearRow> = {},
): IncomeSummaryByYearRow {
  return {
    accountId: "acc1",
    ticker: "NVDA",
    dividends: 100,
    interest: 0,
    lastEventDate: "2026-06-01",
    year: 2026,
    currency: "USD",
    ...overrides,
  };
}

describe("buildRealizedIncomeByYear", () => {
  it("sums capital gains + dividends + interest into a year's total income", () => {
    const rows = buildRealizedIncomeByYear(
      [gain({ gain: 200 })],
      [income({ dividends: 100, interest: 50 })],
      "USD",
    );
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.year).toBe(2026);
    expect(r.capitalGains.gain).toBe(200);
    expect(r.dividends).toBe(100);
    expect(r.interest).toBe(50);
    expect(r.totalIncome).toBe(350);
  });

  it("aggregates multiple income rows within the same year", () => {
    const rows = buildRealizedIncomeByYear(
      [],
      [
        income({ ticker: "NVDA", dividends: 100, interest: 0 }),
        income({ ticker: "AAPL", dividends: 40, interest: 0 }),
        income({ ticker: null, dividends: 0, interest: 25 }),
      ],
      "USD",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].capitalGains.gain).toBe(0); // no disposals → known $0
    expect(rows[0].dividends).toBe(140);
    expect(rows[0].interest).toBe(25);
    expect(rows[0].totalIncome).toBe(165);
  });

  it("keeps a gains-only year (no income) with zero dividends/interest", () => {
    const rows = buildRealizedIncomeByYear([gain({ gain: 200 })], [], "USD");
    expect(rows).toHaveLength(1);
    expect(rows[0].dividends).toBe(0);
    expect(rows[0].interest).toBe(0);
    expect(rows[0].totalIncome).toBe(200);
  });

  it("keeps an income-only year with a known $0 capital gain", () => {
    const rows = buildRealizedIncomeByYear(
      [],
      [income({ year: 2025, dividends: 80 })],
      "USD",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].year).toBe(2025);
    expect(rows[0].capitalGains.gain).toBe(0);
    expect(rows[0].totalIncome).toBe(80);
  });

  it("unions disposal years and income years, newest first", () => {
    const rows = buildRealizedIncomeByYear(
      [gain({ disposedDate: "2024-05-01", gain: 10 })],
      [income({ year: 2026, dividends: 5 })],
      "USD",
    );
    expect(rows.map((r) => r.year)).toEqual([2026, 2024]);
  });

  it("gates a year's income to null when it holds a non-display-currency row", () => {
    const rows = buildRealizedIncomeByYear(
      [gain({ gain: 200 })],
      [
        income({ dividends: 100, currency: "USD" }),
        income({ ticker: "ASML", dividends: 30, currency: "EUR" }),
      ],
      "USD",
    );
    expect(rows[0].dividends).toBeNull();
    expect(rows[0].interest).toBeNull();
    // Capital gains are still statable (USD); only the income figures gate out,
    // and total income is null because a component is null.
    expect(rows[0].capitalGains.gain).toBe(200);
    expect(rows[0].totalIncome).toBeNull();
  });

  it("makes total income null when the capital-gains total is null", () => {
    // A basis-unknown-only disposal → capital-gains gain null (nothing statable).
    const rows = buildRealizedIncomeByYear(
      [gain({ gain: null, costBasis: null })],
      [income({ dividends: 100 })],
      "USD",
    );
    expect(rows[0].capitalGains.gain).toBeNull();
    expect(rows[0].dividends).toBe(100);
    expect(rows[0].totalIncome).toBeNull();
  });

  it("returns an empty list when there are no gains and no income", () => {
    expect(buildRealizedIncomeByYear([], [], "USD")).toEqual([]);
  });
});
