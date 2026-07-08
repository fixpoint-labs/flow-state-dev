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
 *   - the by-year and grand totals sum the groups, propagating the null gate.
 */
import { describe, expect, it } from "vitest";
import {
  buildRealizedGainsRowModel,
  computeRealizedGainTotals,
} from "../components/portfolio/realized-gains-row-model";
import type { RealizedGainRow } from "../src/db/repository";

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
    const totals = computeRealizedGainTotals(models);
    expect(totals.byYear.get(2026)).toBe(280);
    expect(totals.byYear.get(2025)).toBe(50);
    expect(totals.grandTotal).toBe(330);
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
    const totals = computeRealizedGainTotals(models);
    // 2026 mixes USD + EUR → unknown, never 350.
    expect(totals.byYear.get(2026)).toBeNull();
    // 2025 is single-currency → still a real figure.
    expect(totals.byYear.get(2025)).toBe(50);
    // The whole set mixes currencies → the grand total is unknown.
    expect(totals.grandTotal).toBeNull();
  });

  it("propagates the null gate: a null group gain nulls its year and the grand total", () => {
    const models = buildRealizedGainsRowModel([
      gain({ id: "a", ticker: "NVDA", disposedDate: "2026-03-15", gain: 200 }),
      // 2026 also has a basis-unknown disposal → that group's gain is null.
      gain({ id: "b", ticker: "AAPL", disposedDate: "2026-06-01", gain: null, costBasis: null }),
      gain({ id: "c", ticker: "JPM", disposedDate: "2025-02-10", gain: 50 }),
    ]);
    const totals = computeRealizedGainTotals(models);
    // 2026 has an unknown-gain group → the year total is unknown (—), not 200.
    expect(totals.byYear.get(2026)).toBeNull();
    // 2025 is fully known.
    expect(totals.byYear.get(2025)).toBe(50);
    // Any unknown anywhere → the grand total is unknown.
    expect(totals.grandTotal).toBeNull();
  });
});
