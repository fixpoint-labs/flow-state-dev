/**
 * The pure view-model behind the Realized Gains table (FIX-874) — a browser-safe
 * roll-up of the persisted `RealizedGainRow`s into one entry per
 * `(ticker, year, term, currency)`, plus the by-year and grand-total gain
 * figures. No React, no IO — exported for the node-env spec
 * (`test/realized-gains-row-model.spec.ts`), the `buildHoldingRowModel`
 * precedent.
 *
 * Two load-bearing decisions:
 *  - **Currency is part of the key.** A default-USD account can still hold a
 *    non-USD disposal; summing USD + EUR proceeds into one figure would be
 *    nonsense, so a USD and a non-USD row for the same ticker/year/term never
 *    merge (they surface as separate rows, and the table shows the Currency
 *    column once any non-USD row exists).
 *  - **A null contributor makes the sum null** (the real-money gate): if ANY
 *    row in a group has a null proceeds / cost basis / gain, that group's total
 *    is null and renders "—", never a fabricated partial number. The same gate
 *    propagates to the by-year and grand totals — a total that silently omitted
 *    an unknown contributor would misstate realized gains. The totals extend the
 *    currency rule too: a year (or the grand total) whose rows span more than
 *    one currency is null rather than a single-currency-labeled USD + EUR sum.
 */
import type { RealizedGainRow } from "@/src/db/repository";

/** One rolled-up realized-gains row: all disposals of one ticker in one year,
 *  of one term, in one currency. Money fields are null when any contributing
 *  row's field is null (the "—" gate). */
export type RealizedGainRowModel = {
  ticker: string;
  /** Calendar year of the disposals (from `disposedDate`). */
  year: number;
  term: "short" | "long" | "unknown";
  currency: string;
  /** Summed quantity disposed. */
  quantity: number;
  /** Summed proceeds; null if any contributing row's proceeds is null. */
  proceeds: number | null;
  /** Summed cost basis; null if any contributing row's cost basis is null. */
  costBasis: number | null;
  /** Summed realized gain/loss; null if any contributing row's gain is null. */
  gain: number | null;
  /** Number of underlying disposal rows in this group. */
  count: number;
};

/** Sum a series where a single null makes the whole sum unknown — the
 *  real-money gate: a total that dropped an unknown contributor would be a
 *  fabricated number. */
function nullableSum(values: Iterable<number | null>): number | null {
  let total = 0;
  for (const v of values) {
    if (v === null) return null;
    total += v;
  }
  return total;
}

/** The calendar year of a disposal, from the `YYYY-MM-DD` `disposedDate`. */
function disposalYear(row: RealizedGainRow): number {
  return Number(row.disposedDate.slice(0, 4));
}

/**
 * Roll the persisted realized-gain rows up by `(ticker, year, term, currency)`.
 * Sorted newest year first, then ticker (term/currency break remaining ties for
 * a stable order). Pure — no IO.
 */
export function buildRealizedGainsRowModel(
  rows: RealizedGainRow[],
): RealizedGainRowModel[] {
  const groups = new Map<string, RealizedGainRow[]>();
  for (const row of rows) {
    const year = disposalYear(row);
    // Pipe-joined key — no field can contain `|` (tickers are alphanumeric via
    // `isImportableSymbol`, currency is a 3-letter code, term an enum, year a
    // number), so no collision. Currency is part of the key: a USD and a non-USD
    // row for the same ticker/term never merge (summing them is nonsense).
    const key = `${row.ticker}|${year}|${row.term}|${row.currency}`;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [row]);
    else list.push(row);
  }

  const models = [...groups.values()].map((groupRows): RealizedGainRowModel => {
    const first = groupRows[0];
    return {
      ticker: first.ticker,
      year: disposalYear(first),
      term: first.term,
      currency: first.currency,
      quantity: groupRows.reduce((sum, r) => sum + r.quantity, 0),
      proceeds: nullableSum(groupRows.map((r) => r.proceeds)),
      costBasis: nullableSum(groupRows.map((r) => r.costBasis)),
      gain: nullableSum(groupRows.map((r) => r.gain)),
      count: groupRows.length,
    };
  });

  return models.sort(
    (a, b) =>
      b.year - a.year ||
      a.ticker.localeCompare(b.ticker) ||
      a.term.localeCompare(b.term) ||
      a.currency.localeCompare(b.currency),
  );
}

/** The all-up realized-gain totals: one figure per year and one grand total.
 *  Each is null (renders "—") when ANY contributing group's gain is null (the
 *  "—" gate) OR the contributing rows span more than one currency (see
 *  `totalGain`). */
export type RealizedGainTotals = {
  /** year → summed realized gain (null if any of that year's groups is null, or
   *  that year mixes currencies). */
  byYear: Map<number, number | null>;
  /** Summed realized gain across every year (null if any group is null, or the
   *  set mixes currencies). */
  grandTotal: number | null;
};

/** Sum realized gain across a set of rolled-up rows, honest about the two ways
 *  the figure can't be stated as one number: a null contributing gain (the "—"
 *  gate), OR more than one currency in the set. The table renders these totals
 *  in the single account currency, so summing USD + EUR into one labeled figure
 *  would be a fabricated number — the same reason currency is part of the row
 *  key. Either case → null → "—". */
function totalGain(models: RealizedGainRowModel[]): number | null {
  const currencies = new Set(models.map((m) => m.currency));
  if (currencies.size > 1) return null;
  return nullableSum(models.map((m) => m.gain));
}

/**
 * Compute the by-year and grand-total realized gain from the row models. Both
 * follow the same real-money gates as the rows: a null contributing gain, or a
 * currency mix, makes the enclosing total null. Pure — no IO.
 */
export function computeRealizedGainTotals(
  models: RealizedGainRowModel[],
): RealizedGainTotals {
  const perYear = new Map<number, RealizedGainRowModel[]>();
  for (const m of models) {
    const list = perYear.get(m.year);
    if (list === undefined) perYear.set(m.year, [m]);
    else list.push(m);
  }
  const byYear = new Map<number, number | null>();
  for (const [year, yearModels] of perYear) byYear.set(year, totalGain(yearModels));
  return {
    byYear,
    grandTotal: totalGain(models),
  };
}
