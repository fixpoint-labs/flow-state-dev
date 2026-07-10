/**
 * realized-income-by-year.ts — the pure view-model behind the household Gains &
 * Taxes year cards (FIX-885 follow-up). A year produces two realized cash
 * flows: realized capital gains (from disposals) and realized income (dividends
 * + interest). This rolls both into one per-year summary so the UI can toggle
 * between "Capital gains" and "Total realized income" without re-deriving.
 *
 * No React, no IO — exported for the node-env spec
 * (`test/realized-income-by-year.spec.ts`), the `realized-gains-row-model`
 * precedent. Currency-gated the same way the gains model is: a year's income is
 * null ("—") when it can't be honestly stated in the display currency (any
 * non-display-currency income row that year), never a silent cross-currency
 * sum. The capital-gains total is reused verbatim from
 * `computeRealizedGainTotals`, so its own null / basis-unknown gates carry
 * through unchanged.
 */
import type { IncomeSummaryByYearRow, RealizedGainRow } from "@/src/db/repository";
import {
  buildRealizedGainsRowModel,
  computeRealizedGainTotals,
  type RealizedGainTotal,
} from "./realized-gains-row-model";

/** One year's combined realized picture. */
export type YearRealizedIncome = {
  year: number;
  /** Realized capital gains for the year — the gains model's total, so its
   *  null (currency / all-unknown) and `excludedCount` gates are unchanged. */
  capitalGains: RealizedGainTotal;
  /** Dividends earned in the year, display currency only; null when the year
   *  has any non-display-currency income row (can't state one clean figure). */
  dividends: number | null;
  /** Interest earned in the year, same currency gate as dividends. */
  interest: number | null;
  /** capitalGains.gain + dividends + interest. Null when ANY component is null
   *  (the real-money gate: a total that dropped an unknown contributor would
   *  misstate realized income). */
  totalIncome: number | null;
};

/**
 * Combine realized capital gains and realized income into one per-year summary,
 * newest year first. `currency` is the display currency the totals are stated in
 * (USD for the household view). Pure — no IO.
 *
 * A year appears if it has EITHER a disposal or an income event (the union of
 * the two sources' years), so an income-only year and a gains-only year are
 * both kept. A gains-only year has zero income (`0`, a known zero — the events
 * simply didn't happen); an income-only year has `capitalGains` `$0` for the
 * same reason (no disposals, no gain).
 */
export function buildRealizedIncomeByYear(
  realizedGains: RealizedGainRow[],
  incomeByYear: IncomeSummaryByYearRow[],
  currency: string,
): YearRealizedIncome[] {
  const gainsByYear = computeRealizedGainTotals(
    buildRealizedGainsRowModel(realizedGains),
    currency,
  ).byYear;

  // Income grouped by year. A year's dividends/interest gate to null if any of
  // that year's income rows is in another currency — mirroring the gains
  // currency gate; summing EUR + USD into one display figure is nonsense.
  const incomeYears = new Map<
    number,
    { dividends: number; interest: number; foreign: boolean }
  >();
  for (const row of incomeByYear) {
    const entry =
      incomeYears.get(row.year) ?? { dividends: 0, interest: 0, foreign: false };
    if (row.currency !== currency) {
      entry.foreign = true;
    } else {
      entry.dividends += row.dividends;
      entry.interest += row.interest;
    }
    incomeYears.set(row.year, entry);
  }

  const years = new Set<number>([...gainsByYear.keys(), ...incomeYears.keys()]);
  const result: YearRealizedIncome[] = [];
  for (const year of years) {
    // A year absent from the gains map had no disposals → a known $0 gain (the
    // "empty set is 0" rule the gains model itself applies to the grand total).
    const capitalGains = gainsByYear.get(year) ?? { gain: 0, excludedCount: 0 };
    const income = incomeYears.get(year);
    const dividends =
      income === undefined ? 0 : income.foreign ? null : income.dividends;
    const interest =
      income === undefined ? 0 : income.foreign ? null : income.interest;
    const totalIncome =
      capitalGains.gain === null || dividends === null || interest === null
        ? null
        : capitalGains.gain + dividends + interest;
    result.push({ year, capitalGains, dividends, interest, totalIncome });
  }
  return result.sort((a, b) => b.year - a.year);
}
