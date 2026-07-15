/**
 * Unit tests for `buildRealizedGainsRowModel` + `computeRealizedGainTotals` —
 * the pure view-model behind the Realized Gains table (FIX-874).
 *
 * The test env is node + `.spec.ts` (no JSX rendering), so — matching the
 * `buildHoldingRowModel` precedent — the load-bearing logic is a pure helper
 * tested directly. These are INTENT-ENCODING tests, not coverage:
 *
 *   - disposals roll up by (ticker, year, term, currency) — the grouping key;
 *   - currency is PART of the key, so a USD and a non-USD row for the same
 *     ticker/term never merge (summing USD + EUR proceeds would be nonsense);
 *   - a single null-gain contributor makes the group total gain null → "—" (the
 *     real-money gate; a fabricated partial sum would misstate realized gains);
 *   - short vs long disposals split into separate rows (holding period matters);
 *   - the by-year and grand totals sum the rows with a KNOWN gain and surface a
 *     count of the basis-unknown rows they excluded (the tax card's precedent) —
 *     rather than one unknown row voiding the whole total; the currency gate
 *     still renders "—" (a cross-currency sum can't be stated as one figure).
 */
import { describe, expect, it } from "vitest";
import {
  buildRealizedGainsRowModel,
  computeRealizedGainTotals,
  realizedTotalsByAccount,
} from "../components/portfolio/realized-gains-row-model";
import type { RealizedGainRow } from "../db/repository";

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

describe("buildRealizedGainsRowModel", () => {
  it("rolls up disposals sharing (ticker, year, term, currency) into one row", () => {
    const rows = buildRealizedGainsRowModel([
      gain({ id: "a", quantity: 10, proceeds: 1200, costBasis: 1000, gain: 200 }),
      gain({ id: "b", quantity: 5, proceeds: 600, costBasis: 500, gain: 100 }),
    ]);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.ticker).toBe("NVDA");
    expect(r.year).toBe(2026);
    expect(r.term).toBe("long");
    expect(r.currency).toBe("USD");
    expect(r.quantity).toBe(15);
    expect(r.proceeds).toBe(1800);
    expect(r.costBasis).toBe(1500);
    expect(r.gain).toBe(300);
    expect(r.count).toBe(2);
  });

  it("derives the year from disposedDate, splitting the same ticker across years", () => {
    const rows = buildRealizedGainsRowModel([
      gain({ id: "a", disposedDate: "2026-03-15", gain: 200 }),
      gain({ id: "b", disposedDate: "2025-11-02", gain: 50 }),
    ]);
    expect(rows).toHaveLength(2);
    // Newest year first.
    expect(rows[0].year).toBe(2026);
    expect(rows[1].year).toBe(2025);
  });

  it("keeps a USD and a non-USD row for the same ticker/year/term SEPARATE", () => {
    // Currency is part of the key — a default-USD account can hold a foreign
    // row, and summing USD + EUR into one figure would be nonsense.
    const rows = buildRealizedGainsRowModel([
      gain({ id: "a", currency: "USD", proceeds: 1200, gain: 200 }),
      gain({ id: "b", currency: "EUR", proceeds: 900, gain: 150 }),
    ]);
    expect(rows).toHaveLength(2);
    const usd = rows.find((r) => r.currency === "USD");
    const eur = rows.find((r) => r.currency === "EUR");
    expect(usd?.proceeds).toBe(1200);
    expect(usd?.gain).toBe(200);
    expect(eur?.proceeds).toBe(900);
    expect(eur?.gain).toBe(150);
  });

  it("makes the group total gain null when ANY contributing row's gain is null (— gate)", () => {
    const rows = buildRealizedGainsRowModel([
      gain({ id: "a", gain: 200, proceeds: 1200, costBasis: 1000 }),
      // A basis-unknown disposal: gain and cost basis are null.
      gain({ id: "b", gain: null, proceeds: 600, costBasis: null, basisUnknown: "transfer-in" }),
    ]);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    // One null contributor voids the whole gain and cost-basis sum.
    expect(r.gain).toBeNull();
    expect(r.costBasis).toBeNull();
    // Proceeds are both known, so they still sum.
    expect(r.proceeds).toBe(1800);
  });

  it("splits short vs long disposals into separate rows (holding period matters)", () => {
    const rows = buildRealizedGainsRowModel([
      gain({ id: "a", term: "short", gain: 80 }),
      gain({ id: "b", term: "long", gain: 200 }),
    ]);
    expect(rows).toHaveLength(2);
    const short = rows.find((r) => r.term === "short");
    const long = rows.find((r) => r.term === "long");
    expect(short?.gain).toBe(80);
    expect(long?.gain).toBe(200);
  });
});

describe("computeRealizedGainTotals", () => {
  it("sums the per-year and grand-total realized gain", () => {
    const models = buildRealizedGainsRowModel([
      gain({ id: "a", ticker: "NVDA", disposedDate: "2026-03-15", term: "long", gain: 200 }),
      gain({ id: "b", ticker: "AAPL", disposedDate: "2026-06-01", term: "short", gain: 80 }),
      gain({ id: "c", ticker: "JPM", disposedDate: "2025-02-10", term: "long", gain: 50 }),
    ]);
    const totals = computeRealizedGainTotals(models, "USD");
    expect(totals.byYear.get(2026)).toEqual({ gain: 280, excludedCount: 0 });
    expect(totals.byYear.get(2025)).toEqual({ gain: 50, excludedCount: 0 });
    expect(totals.grandTotal).toEqual({ gain: 330, excludedCount: 0 });
  });

  it("nulls a year and the grand total when its rows span more than one currency", () => {
    // The table renders totals in the single account currency, so a USD + EUR
    // year total would be a fabricated figure — the same reason currency is part
    // of the row key. It renders "—", not a mixed-currency sum.
    const models = buildRealizedGainsRowModel([
      gain({ id: "a", ticker: "NVDA", disposedDate: "2026-03-15", currency: "USD", gain: 200 }),
      gain({ id: "b", ticker: "SAP", disposedDate: "2026-06-01", currency: "EUR", gain: 150 }),
      gain({ id: "c", ticker: "JPM", disposedDate: "2025-02-10", currency: "USD", gain: 50 }),
    ]);
    const totals = computeRealizedGainTotals(models, "USD");
    // 2026 mixes USD + EUR → unknown, never 350.
    expect(totals.byYear.get(2026)).toEqual({ gain: null, excludedCount: 0 });
    // 2025 is single-currency → still a real figure.
    expect(totals.byYear.get(2025)).toEqual({ gain: 50, excludedCount: 0 });
    // The whole set mixes currencies → the grand total is unknown.
    expect(totals.grandTotal).toEqual({ gain: null, excludedCount: 0 });
  });

  it("nulls a total whose rows are a single currency that isn't the account currency", () => {
    // A USD account holding only EUR disposals: the rows don't MIX currencies,
    // but a EUR sum labeled in the account's USD would still be a fabricated
    // cross-currency figure. The per-row EUR gains still show; the total is "—".
    const models = buildRealizedGainsRowModel([
      gain({ id: "a", ticker: "SAP", disposedDate: "2026-03-15", currency: "EUR", gain: 200 }),
      gain({ id: "b", ticker: "BMW", disposedDate: "2026-06-01", currency: "EUR", gain: 150 }),
    ]);
    const totals = computeRealizedGainTotals(models, "USD");
    expect(totals.byYear.get(2026)).toEqual({ gain: null, excludedCount: 0 });
    expect(totals.grandTotal).toEqual({ gain: null, excludedCount: 0 });
    // A EUR account with those same EUR rows CAN state the total.
    const eurTotals = computeRealizedGainTotals(models, "EUR");
    expect(eurTotals.byYear.get(2026)).toEqual({ gain: 350, excludedCount: 0 });
    expect(eurTotals.grandTotal).toEqual({ gain: 350, excludedCount: 0 });
  });

  it("sums the known gain and excludes basis-unknown rows instead of voiding the whole total", () => {
    const models = buildRealizedGainsRowModel([
      gain({ id: "a", ticker: "NVDA", disposedDate: "2026-03-15", gain: 200 }),
      // 2026 also has a basis-unknown disposal (no acquisition lot) → null gain.
      gain({ id: "b", ticker: "AAPL", disposedDate: "2026-06-01", gain: null, costBasis: null }),
      gain({ id: "c", ticker: "JPM", disposedDate: "2025-02-10", gain: 50 }),
    ]);
    const totals = computeRealizedGainTotals(models, "USD");
    // 2026 states the known 200 and notes the one excluded row — not "—", not 200-only-silently.
    expect(totals.byYear.get(2026)).toEqual({ gain: 200, excludedCount: 1 });
    // 2025 is fully known.
    expect(totals.byYear.get(2025)).toEqual({ gain: 50, excludedCount: 0 });
    // Grand total sums the known gains across years and carries the excluded count.
    expect(totals.grandTotal).toEqual({ gain: 250, excludedCount: 1 });
  });

  it("preserves the known gain when a known + basis-unknown disposal collapse into ONE row", () => {
    // Both disposals share (NVDA, 2026, short, USD) — a priced lot AND a no-price
    // buy consumed by one sale — so they roll up into a SINGLE display row whose
    // gain is "—" (one null contributor). The total must still count the known
    // 200 and note the one excluded disposal, not drop the whole group.
    const models = buildRealizedGainsRowModel([
      gain({ id: "a", ticker: "NVDA", disposedDate: "2026-03-15", term: "short", gain: 200 }),
      gain({
        id: "b",
        ticker: "NVDA",
        disposedDate: "2026-06-01",
        term: "short",
        gain: null,
        costBasis: null,
        basisUnknown: "basis-unknown",
      }),
    ]);
    // The two collapse into one display row that reads "—" (a mixed group).
    expect(models).toHaveLength(1);
    expect(models[0].gain).toBeNull();
    // ...but the total preserves the known 200 and counts the ONE excluded disposal.
    const totals = computeRealizedGainTotals(models, "USD");
    expect(totals.byYear.get(2026)).toEqual({ gain: 200, excludedCount: 1 });
    expect(totals.grandTotal).toEqual({ gain: 200, excludedCount: 1 });
  });

  it("states — (not $0) for a year in which EVERY row's gain is unknown, still counting them", () => {
    // A "$0" total when nothing is known would misread as a real zero gain; the
    // honest figure is "—" with the excluded count surfaced.
    const models = buildRealizedGainsRowModel([
      gain({ id: "a", ticker: "NVDA", disposedDate: "2026-03-15", gain: null, costBasis: null }),
      gain({ id: "b", ticker: "AAPL", disposedDate: "2026-06-01", gain: null, costBasis: null }),
    ]);
    const totals = computeRealizedGainTotals(models, "USD");
    expect(totals.byYear.get(2026)).toEqual({ gain: null, excludedCount: 2 });
    expect(totals.grandTotal).toEqual({ gain: null, excludedCount: 2 });
  });

  it("an empty set is a real $0 total (no disposals, no gain), nothing excluded", () => {
    const totals = computeRealizedGainTotals([], "USD");
    expect(totals.grandTotal).toEqual({ gain: 0, excludedCount: 0 });
    expect(totals.byYear.size).toBe(0);
  });
});

describe("realizedTotalsByAccount", () => {
  it("gives each account its lifetime net realized total in its own currency", () => {
    const rows = [
      // acc1 (USD): a 2025 gain + a 2026 gain across years → summed lifetime.
      gain({ id: "a", accountId: "acc1", disposedDate: "2025-02-01", gain: 100 }),
      gain({ id: "b", accountId: "acc1", disposedDate: "2026-02-01", gain: 250 }),
      // acc2 (EUR): one gain, labeled in its own currency.
      gain({ id: "c", accountId: "acc2", disposedDate: "2026-03-01", currency: "EUR", gain: 40 }),
    ];
    const totals = realizedTotalsByAccount(
      rows,
      new Map([
        ["acc1", "USD"],
        ["acc2", "EUR"],
      ]),
    );
    expect(totals.get("acc1")).toEqual({ gain: 350, excludedCount: 0 });
    expect(totals.get("acc2")).toEqual({ gain: 40, excludedCount: 0 });
  });

  it("sums the known gain per account and counts that account's basis-unknown rows", () => {
    const rows = [
      gain({ id: "a", accountId: "acc1", ticker: "NVDA", gain: 200 }),
      gain({ id: "b", accountId: "acc1", ticker: "AAPL", gain: null, costBasis: null }),
    ];
    const totals = realizedTotalsByAccount(rows, new Map([["acc1", "USD"]]));
    expect(totals.get("acc1")).toEqual({ gain: 200, excludedCount: 1 });
  });

  it("nulls an account whose disposals aren't in the currency it's labeled in", () => {
    // A USD-labeled account holding only EUR disposals → "—" (the currency gate),
    // the same honesty as the per-year totals. An unlisted account defaults USD.
    const rows = [
      gain({ id: "a", accountId: "acc1", currency: "EUR", gain: 300 }),
    ];
    const totals = realizedTotalsByAccount(rows, new Map([["acc1", "USD"]]));
    expect(totals.get("acc1")).toEqual({ gain: null, excludedCount: 0 });
  });

  it("omits accounts with no realized rows (the map has only accounts with history)", () => {
    const totals = realizedTotalsByAccount([], new Map([["acc1", "USD"]]));
    expect(totals.size).toBe(0);
  });
});
