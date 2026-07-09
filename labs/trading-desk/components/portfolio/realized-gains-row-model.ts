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
 *    currency rule too: a year (or the grand total) is null unless every one of
 *    its rows is in the account currency the total is labeled in — a
 *    multi-currency mix, or a single foreign currency, both render "—" rather
 *    than a mislabeled cross-currency sum.
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

/** A realized-gain total (a year, or the grand total): the summed gain over the
 *  rows we CAN state, plus a count of the rows excluded because their gain is
 *  unknown. `gain` is null (renders "—") only when the set can't be stated as one
 *  figure in the account currency at all (a currency mismatch, or every
 *  contributing row unknown); a basis-unknown row no longer voids the whole
 *  total — it drops out of the sum and is surfaced via `excludedCount` instead
 *  (the tax-estimate card's `basisUnknownCount` precedent). */
export type RealizedGainTotal = {
  /** Summed realized gain over the rows with a known gain, in the account
   *  currency. Null when the set can't be honestly stated as one account-currency
   *  figure: a multi-currency mix, a single non-account currency, or every
   *  contributing row unknown (a fabricated "$0" would misread as "no gain"). */
  gain: number | null;
  /** Number of rolled-up rows dropped from `gain` because their gain is unknown
   *  (basis unknown). These render "—" in the table; the total notes them so it
   *  never silently omits an unknown contributor. */
  excludedCount: number;
};

/** The all-up realized-gain totals: one per year and one grand total. */
export type RealizedGainTotals = {
  /** year → its {@link RealizedGainTotal}. */
  byYear: Map<number, RealizedGainTotal>;
  /** The total across every year. */
  grandTotal: RealizedGainTotal;
};

/** Sum realized gain across a set of rolled-up rows for a single account
 *  currency (which is what the table labels these totals in). Rows with a known
 *  gain are summed; rows whose gain is unknown are EXCLUDED from the sum and
 *  counted in `excludedCount` (surfaced, not silently dropped). The figure is
 *  still "—" (`gain: null`) when it can't be stated in the account currency:
 *  more than one currency in the set, a single currency that isn't the account
 *  currency (summing EUR rows and labeling them USD fabricates a cross-currency
 *  figure — the reason currency is part of the row key), or when every row is
 *  unknown (a "$0" total would misread as a real zero gain). An empty set is 0
 *  (no disposals, no gain). */
function computeTotal(
  models: RealizedGainRowModel[],
  accountCurrency: string,
): RealizedGainTotal {
  const currencies = new Set(models.map((m) => m.currency));
  if (currencies.size > 1) return { gain: null, excludedCount: 0 };
  if (currencies.size === 1 && !currencies.has(accountCurrency))
    return { gain: null, excludedCount: 0 };
  let sum = 0;
  let known = 0;
  let excludedCount = 0;
  for (const m of models) {
    if (m.gain === null) excludedCount += 1;
    else {
      sum += m.gain;
      known += 1;
    }
  }
  // Rows present but none with a known gain → no statable figure (— + note),
  // not a fabricated $0. No rows at all → 0 (no disposals, no gain).
  const gain = models.length > 0 && known === 0 ? null : sum;
  return { gain, excludedCount };
}

/**
 * Compute the by-year and grand-total realized gain from the row models. Each
 * total sums the rows with a known gain and counts the basis-unknown rows it
 * excluded (see {@link RealizedGainTotal}); the currency gate still renders "—".
 * `accountCurrency` is the currency the table labels the totals in. Pure — no IO.
 */
export function computeRealizedGainTotals(
  models: RealizedGainRowModel[],
  accountCurrency: string,
): RealizedGainTotals {
  const perYear = new Map<number, RealizedGainRowModel[]>();
  for (const m of models) {
    const list = perYear.get(m.year);
    if (list === undefined) perYear.set(m.year, [m]);
    else list.push(m);
  }
  const byYear = new Map<number, RealizedGainTotal>();
  for (const [year, yearModels] of perYear)
    byYear.set(year, computeTotal(yearModels, accountCurrency));
  return {
    byYear,
    grandTotal: computeTotal(models, accountCurrency),
  };
}

/**
 * Lifetime net realized gain/loss per account — one {@link RealizedGainTotal}
 * per account (its all-year {@link computeRealizedGainTotals} grand total). This
 * is the account-card / account-glance figure: a single net number, honest about
 * basis-unknown rows (`excludedCount`) and cross-currency sets (`gain: null`).
 * Each account's total is labeled in its own currency (`currencyByAccountId`,
 * default "USD" if absent — the read routes default accounts to USD). The
 * household total is NOT this map's job: sum it in one currency with
 * `computeRealizedGainTotals(buildRealizedGainsRowModel(allRows), "USD")`, whose
 * currency gate renders "—" if any row isn't in that currency. Pure — no IO.
 */
export function realizedTotalsByAccount(
  rows: RealizedGainRow[],
  currencyByAccountId: Map<string, string>,
): Map<string, RealizedGainTotal> {
  const byAccount = new Map<string, RealizedGainRow[]>();
  for (const row of rows) {
    const list = byAccount.get(row.accountId);
    if (list === undefined) byAccount.set(row.accountId, [row]);
    else list.push(row);
  }
  const totals = new Map<string, RealizedGainTotal>();
  for (const [accountId, accountRows] of byAccount) {
    const models = buildRealizedGainsRowModel(accountRows);
    const currency = currencyByAccountId.get(accountId) ?? "USD";
    totals.set(accountId, computeRealizedGainTotals(models, currency).grandTotal);
  }
  return totals;
}
