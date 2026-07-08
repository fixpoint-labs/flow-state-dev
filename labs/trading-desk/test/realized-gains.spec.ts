/**
 * Unit tests for realized-gains derivation (`deriveLots().disposals`, FIX-874).
 *
 * Intent encoded — these pin the two-axis realized-disposal contract the tax
 * pane and materializer depend on:
 *   1. A disposal is emitted per (sell event × consumed FIFO lot), plus one per
 *      unmatched over-sell remainder — the gain the FIFO reduction used to
 *      discard is now recorded.
 *   2. TWO INDEPENDENT provenance axes: acquisition-DATE (drives acquiredDate /
 *      term) vs BASIS (drives costBasis / gain). A transfer-in with a known
 *      broker basis keeps its costBasis/gain but reads term "unknown"; a no-price
 *      buy keeps a real term but null costBasis/gain.
 *   3. Only a `sell` realizes a gain — a `transfer`-out consumes lots (position
 *      leaves) but emits NO realized record.
 *   4. proceeds allocate pro-rata by consumed quantity at the sell's FACE amount
 *      (an amount:0 sell is a real loss, not special-cased).
 *   5. A currency mismatch between the sell and the consumed lot nulls BOTH
 *      costBasis and gain (a USD−EUR figure is nonsense), never a mixed number.
 */
import { describe, expect, it } from "vitest";
import { deriveLots } from "@/src/flows/portfolio/lots";
import type { LedgerRow } from "@/src/flows/portfolio/ledger-schema";

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
    voidedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("deriveLots — realized disposals", () => {
  it("emits one disposal for a buy then a full sell (gain = proceeds − basis)", () => {
    const { disposals } = deriveLots([
      row({ id: "b1", tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({ id: "s1", type: "sell", tradeDate: "2026-06-01", quantity: -10, amount: 2500 }),
    ]);
    expect(disposals).toHaveLength(1);
    expect(disposals[0]).toMatchObject({
      ticker: "AAPL",
      disposedDate: "2026-06-01",
      acquiredDate: "2026-01-01",
      quantity: 10,
      proceeds: 2500,
      costBasis: 1000,
      gain: 1500,
      term: "short",
      currency: "USD",
      basisUnknown: null,
      disposalEventId: "s1",
      lotIndex: 0,
    });
  });

  it("allocates basis proportionally on a partial sell and leaves the residual open", () => {
    const { positions, disposals } = deriveLots([
      row({ tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({ id: "s1", type: "sell", tradeDate: "2026-02-01", quantity: -4, amount: 800 }),
    ]);
    expect(disposals).toHaveLength(1);
    expect(disposals[0]).toMatchObject({
      quantity: 4,
      proceeds: 800,
      costBasis: 400,
      gain: 400,
      lotIndex: 0,
    });
    const aapl = positions.find((p) => p.ticker === "AAPL");
    expect(aapl?.quantity).toBe(6); // residual still open
  });

  it("spans two lots — two rows, mixed ST/LT, pro-rata proceeds, lotIndex 0 and 1", () => {
    const { disposals } = deriveLots([
      row({ id: "b1", tradeDate: "2025-01-01", quantity: 10, unitPrice: 100 }), // long by the sell date
      row({ id: "b2", tradeDate: "2026-02-01", quantity: 10, unitPrice: 200 }), // short
      row({ id: "s1", type: "sell", tradeDate: "2026-06-01", quantity: -15, amount: 3000 }),
    ]);
    expect(disposals).toHaveLength(2);
    expect(disposals[0]).toMatchObject({
      acquiredDate: "2025-01-01",
      quantity: 10,
      proceeds: 2000, // 10/15 × 3000
      costBasis: 1000,
      gain: 1000,
      term: "long",
      lotIndex: 0,
    });
    expect(disposals[1]).toMatchObject({
      acquiredDate: "2026-02-01",
      quantity: 5,
      proceeds: 1000, // 5/15 × 3000
      costBasis: 1000,
      gain: 0,
      term: "short",
      lotIndex: 1,
    });
  });

  it("basis-unknown transfer-in sold → acquiredDate null, term unknown, costBasis/gain null", () => {
    const { disposals } = deriveLots([
      row({
        type: "transfer",
        tradeDate: "2026-01-01",
        quantity: 10,
        unitPrice: null,
        amount: 0,
        basisUnknown: "no record",
      }),
      row({ type: "sell", tradeDate: "2026-06-01", quantity: -10, amount: 2500 }),
    ]);
    expect(disposals).toHaveLength(1);
    expect(disposals[0]).toMatchObject({
      acquiredDate: null,
      term: "unknown",
      quantity: 10,
      proceeds: 2500,
      costBasis: null,
      gain: null,
      basisUnknown: "no record",
    });
  });

  it("known-basis transfer-in sold → term unknown, but real costBasis/gain KEPT (two-axis)", () => {
    const { disposals } = deriveLots([
      row({
        type: "transfer",
        tradeDate: "2026-01-01",
        quantity: 10,
        unitPrice: 100, // broker-supplied basis, NOT flagged
        amount: 0,
        basisUnknown: null,
      }),
      row({ type: "sell", tradeDate: "2026-06-01", quantity: -10, amount: 2500 }),
    ]);
    expect(disposals).toHaveLength(1);
    expect(disposals[0]).toMatchObject({
      acquiredDate: null, // date axis: transfer date is not the acquisition
      term: "unknown",
      costBasis: 1000, // basis axis: known basis preserved
      gain: 1500,
      basisUnknown: null,
    });
  });

  it("no-price buy sold → real term, but costBasis/gain null", () => {
    const { disposals } = deriveLots([
      row({ tradeDate: "2026-01-01", quantity: 10, unitPrice: null, amount: 0 }),
      row({ type: "sell", tradeDate: "2026-06-01", quantity: -10, amount: 2500 }),
    ]);
    expect(disposals).toHaveLength(1);
    expect(disposals[0]).toMatchObject({
      acquiredDate: "2026-01-01",
      term: "short", // date is known
      costBasis: null, // basis is not
      gain: null,
      basisUnknown: "no-price-buy",
    });
  });

  it("over-sell with no lot → unmatched remainder row, not dropped", () => {
    const { disposals } = deriveLots([
      row({ id: "s1", type: "sell", tradeDate: "2026-06-01", quantity: -10, amount: 2500 }),
    ]);
    expect(disposals).toHaveLength(1);
    expect(disposals[0]).toMatchObject({
      acquiredDate: null,
      term: "unknown",
      quantity: 10,
      proceeds: 2500,
      costBasis: null,
      gain: null,
      basisUnknown: "no-acquisition-lot",
      lotIndex: 0,
    });
  });

  it("over-sell after consuming a lot → matched row then unmatched remainder", () => {
    const { disposals } = deriveLots([
      row({ tradeDate: "2026-01-01", quantity: 5, unitPrice: 100 }),
      row({ type: "sell", tradeDate: "2026-06-01", quantity: -8, amount: 1600 }),
    ]);
    expect(disposals).toHaveLength(2);
    expect(disposals[0]).toMatchObject({
      quantity: 5,
      proceeds: 1000, // 5/8 × 1600
      costBasis: 500,
      gain: 500,
      lotIndex: 0,
    });
    expect(disposals[1]).toMatchObject({
      quantity: 3,
      proceeds: 600, // 3/8 × 1600
      acquiredDate: null,
      term: "unknown",
      costBasis: null,
      gain: null,
      basisUnknown: "no-acquisition-lot",
      lotIndex: 1,
    });
  });

  it("transfer-OUT consumes a lot but emits NO realized record", () => {
    const { positions, disposals } = deriveLots([
      row({ tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({ type: "transfer", tradeDate: "2026-06-01", quantity: -10, amount: 0 }),
    ]);
    expect(disposals).toHaveLength(0); // transfer-out is not a taxable disposition
    expect(positions.find((p) => p.ticker === "AAPL")).toBeUndefined(); // position still left
  });

  it("amount:0 sell → proceeds 0, gain = −basis (a real loss, not special-cased)", () => {
    const { disposals } = deriveLots([
      row({ tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({ type: "sell", tradeDate: "2026-06-01", quantity: -10, amount: 0 }),
    ]);
    expect(disposals).toHaveLength(1);
    expect(disposals[0]).toMatchObject({
      proceeds: 0,
      costBasis: 1000,
      gain: -1000,
    });
  });

  it("classifies term by the disposed date (short vs long)", () => {
    const short = deriveLots([
      row({ tradeDate: "2025-01-01", quantity: 10, unitPrice: 100 }),
      row({ type: "sell", tradeDate: "2025-06-01", quantity: -10, amount: 1200 }),
    ]).disposals;
    expect(short[0].term).toBe("short");

    const long = deriveLots([
      row({ tradeDate: "2025-01-01", quantity: 10, unitPrice: 100 }),
      row({ type: "sell", tradeDate: "2026-03-01", quantity: -10, amount: 1200 }),
    ]).disposals;
    expect(long[0].term).toBe("long");
  });

  it("currency mismatch nulls BOTH costBasis and gain (never a mixed-currency number)", () => {
    const { disposals } = deriveLots([
      row({ tradeDate: "2026-01-01", quantity: 10, unitPrice: 100, currency: "EUR" }),
      row({ type: "sell", tradeDate: "2026-06-01", quantity: -10, amount: 2500, currency: "USD" }),
    ]);
    expect(disposals).toHaveLength(1);
    expect(disposals[0]).toMatchObject({
      currency: "USD", // the sell event's currency
      costBasis: null,
      gain: null,
      proceeds: 2500,
      basisUnknown: "currency-mismatch",
    });
  });
});
