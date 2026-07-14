/**
 * Unit tests for realized-gains derivation (`deriveLots(...).disposals`, FIX-874).
 *
 * Intent encoded — the realized side is the tax-facing artifact, so these pin the
 * honest-basis contract the persisted `app.realized_gains` table depends on:
 *   1. A sell emits one record per consumed lot; proceeds allocate pro-rata.
 *   2. Short vs long is per lot (a single sale can be part-short, part-long).
 *   3. The two provenance axes are separate: a transfer-in has an UNKNOWN term
 *      even with a KNOWN basis; a no-price buy has a KNOWN term but a null gain.
 *   4. A currency-mismatched sale nulls the gain, never a mixed-currency number.
 *   5. A `transfer`-out is not a disposition — no record.
 *   6. An over-sell surfaces its rows (real proceeds) but nulls their gains — the
 *      whole sale is in mismatched units (unaccounted split), so no phantom loss.
 *   7. A proceeds-unknown import placeholder nulls proceeds/gain; a genuine $0
 *      sale is a real loss.
 */
import { describe, expect, it } from "vitest";
import { deriveLots } from "@/domain/portfolio/math/lots";
import type { LedgerRow } from "@/domain/portfolio/schema/ledger-schema";

let seq = 0;
function row(overrides: Partial<LedgerRow>): LedgerRow {
  seq += 1;
  return {
    id: `evt-${seq}`,
    accountId: "acc-1",
    userId: "devuser",
    type: "buy",
    ticker: "AAPL",
    tradeDate: "2026-01-01",
    settleDate: null,
    quantity: 10,
    unitPrice: 100,
    amount: -1000,
    fee: null,
    currency: "USD",
    source: "manual",
    externalId: null,
    description: null,
    basisUnknown: null,
    proceedsUnknown: null,
    attributes: null,
    voidedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("deriveLots — realized disposals", () => {
  it("emits a gain record on a simple buy→sell", () => {
    const { disposals } = deriveLots([
      row({ id: "b1", tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({ id: "s1", type: "sell", tradeDate: "2026-06-01", quantity: -10, amount: 1500 }),
    ]);
    expect(disposals).toHaveLength(1);
    expect(disposals[0]).toMatchObject({
      ticker: "AAPL",
      disposedDate: "2026-06-01",
      acquiredDate: "2026-01-01",
      quantity: 10,
      proceeds: 1500,
      costBasis: 1000,
      gain: 500,
      term: "short",
      disposalEventId: "s1",
      lotIndex: 0,
    });
  });

  it("reads a legacy negative sell amount as positive proceeds (never an inflated loss)", () => {
    // Before the FIX-874 ingest guard, the manual dialog allowed a negative sell
    // amount ("negative = cash out"). deriveLots must read proceeds as the
    // magnitude so a legacy row — and the backfill that materializes it — doesn't
    // surface negative proceeds / an inflated capital loss.
    const { disposals } = deriveLots([
      row({ id: "b1", tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({ id: "s1", type: "sell", tradeDate: "2026-06-01", quantity: -10, amount: -1500 }),
    ]);
    expect(disposals).toHaveLength(1);
    expect(disposals[0]).toMatchObject({ proceeds: 1500, costBasis: 1000, gain: 500 });
  });

  it("allocates proceeds pro-rata across two lots with mixed ST/LT", () => {
    const { disposals } = deriveLots([
      row({ id: "b1", tradeDate: "2024-01-01", quantity: 10, unitPrice: 100 }), // long by 2026
      row({ id: "b2", tradeDate: "2026-02-01", quantity: 10, unitPrice: 200 }), // short
      row({ id: "s1", type: "sell", tradeDate: "2026-03-01", quantity: -15, amount: 4500 }),
    ]);
    expect(disposals).toHaveLength(2);
    // Oldest (long) lot fully consumed: 10/15 of 4500 = 3000 proceeds.
    expect(disposals[0]).toMatchObject({
      quantity: 10,
      proceeds: 3000,
      costBasis: 1000,
      gain: 2000,
      term: "long",
      lotIndex: 0,
    });
    // Second (short) lot partly consumed: 5 shares, 5/15 of 4500 = 1500.
    expect(disposals[1]).toMatchObject({
      quantity: 5,
      proceeds: 1500,
      costBasis: 1000,
      gain: 500,
      term: "short",
      lotIndex: 1,
    });
  });

  it("classifies exactly one year held as short (boundary exclusive)", () => {
    const { disposals } = deriveLots([
      row({ id: "b1", tradeDate: "2025-03-10", quantity: 10, unitPrice: 100 }),
      row({ id: "s1", type: "sell", tradeDate: "2026-03-10", quantity: -10, amount: 1200 }),
    ]);
    expect(disposals[0].term).toBe("short");
  });

  it("a KNOWN-basis transfer-in sold keeps its real gain but term unknown", () => {
    const { disposals } = deriveLots([
      row({ id: "t1", type: "transfer", tradeDate: "2024-01-01", quantity: 10, unitPrice: 100 }),
      row({ id: "s1", type: "sell", tradeDate: "2026-06-01", quantity: -10, amount: 1500 }),
    ]);
    expect(disposals[0]).toMatchObject({
      acquiredDate: null,
      term: "unknown",
      costBasis: 1000,
      gain: 500,
      basisUnknown: null,
    });
  });

  it("an UNKNOWN-basis transfer-in sold nulls gain and term", () => {
    const { disposals } = deriveLots([
      row({
        id: "t1",
        type: "transfer",
        tradeDate: "2024-01-01",
        quantity: 10,
        unitPrice: null,
        amount: 0,
        basisUnknown: "transfer-in-no-basis",
      }),
      row({ id: "s1", type: "sell", tradeDate: "2026-06-01", quantity: -10, amount: 1500 }),
    ]);
    expect(disposals[0]).toMatchObject({
      acquiredDate: null,
      term: "unknown",
      costBasis: null,
      gain: null,
      basisUnknown: "transfer-in-no-basis",
      proceeds: 1500,
    });
  });

  it("a no-price BUY sold has a real term but a null gain", () => {
    const { disposals } = deriveLots([
      row({ id: "b1", type: "buy", tradeDate: "2026-01-01", quantity: 10, unitPrice: null, amount: 0 }),
      row({ id: "s1", type: "sell", tradeDate: "2026-06-01", quantity: -10, amount: 1500 }),
    ]);
    expect(disposals[0]).toMatchObject({
      acquiredDate: "2026-01-01",
      term: "short",
      costBasis: null,
      gain: null,
      basisUnknown: "basis-unknown",
    });
  });

  it("nulls the gain on a currency-mismatched sale, never a mixed number", () => {
    const { disposals } = deriveLots([
      row({ id: "b1", type: "buy", tradeDate: "2026-01-01", quantity: 10, unitPrice: 100, currency: "EUR" }),
      row({ id: "s1", type: "sell", tradeDate: "2026-06-01", quantity: -10, amount: 1500, currency: "USD" }),
    ]);
    expect(disposals[0]).toMatchObject({
      costBasis: null,
      gain: null,
      basisUnknown: "currency-mismatch",
      term: "short", // date IS known — only the basis side is nulled
    });
  });

  it("emits NO record for a transfer-out", () => {
    const { disposals } = deriveLots([
      row({ id: "b1", type: "buy", tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({ id: "t1", type: "transfer", tradeDate: "2026-06-01", quantity: -10, amount: 0 }),
    ]);
    expect(disposals).toHaveLength(0);
  });

  it("excludes an over-sold sale's matched gains (phantom units), keeping real proceeds", () => {
    const { disposals, oversold } = deriveLots([
      row({ id: "b1", type: "buy", tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({ id: "s1", type: "sell", tradeDate: "2026-06-01", quantity: -15, amount: 2250 }),
    ]);
    expect(disposals).toHaveLength(2);
    expect(oversold.has("AAPL")).toBe(true);
    // The over-sell means an unaccounted split, so even the MATCHED 10 shares are
    // in mismatched units — the gain is phantom. Proceeds (10/15 of 2250 = 1500)
    // are kept, but basis/gain are nulled so the tax estimate excludes them (they
    // self-heal once the split is backfilled).
    expect(disposals[0]).toMatchObject({
      quantity: 10,
      proceeds: 1500,
      costBasis: null,
      gain: null,
      basisUnknown: "oversold-unreconciled",
      lotIndex: 0,
    });
    // The unmatched 5 shares: real proceeds (5/15 of 2250 = 750), unknown basis.
    expect(disposals[1]).toMatchObject({
      quantity: 5,
      proceeds: 750,
      costBasis: null,
      gain: null,
      term: "unknown",
      basisUnknown: "no-acquisition-lot",
      lotIndex: 1,
    });
  });

  it("a genuine $0 sale is a real loss, not excluded", () => {
    const { disposals } = deriveLots([
      row({ id: "b1", type: "buy", tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({ id: "s1", type: "sell", tradeDate: "2026-06-01", quantity: -10, amount: 0 }),
    ]);
    expect(disposals[0]).toMatchObject({ proceeds: 0, costBasis: 1000, gain: -1000 });
  });

  it("a proceeds-unknown import placeholder nulls proceeds and gain", () => {
    const { disposals } = deriveLots([
      row({ id: "b1", type: "buy", tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({
        id: "s1",
        type: "sell",
        tradeDate: "2026-06-01",
        quantity: -10,
        amount: 0,
        proceedsUnknown: "import-no-proceeds",
      }),
    ]);
    expect(disposals[0]).toMatchObject({
      proceeds: null,
      gain: null,
      basisUnknown: "import-no-proceeds",
    });
  });
});
