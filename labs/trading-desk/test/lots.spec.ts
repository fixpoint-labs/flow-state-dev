/**
 * Unit tests for FIFO cost-basis reconstruction (`deriveLots`, FIX-774).
 *
 * Intent encoded — these pin the "basis becomes derived" contract every writer
 * (manual entry, FIX-775 file import, FIX-853 Plaid sync) depends on:
 *   1. Acquisitions push lots; disposals consume them oldest-first (FIFO).
 *   2. Average cost is the weighted mean over the open lots; acquired date is the
 *      earliest open lot's date.
 *   3. A transfer-in with no acquisition record is a basis-unknown lot — null
 *      cost, flagged, NEVER zero-filled.
 *   4. Cash events (null quantity) and voided rows never touch lots.
 *   5. A fully-closed position is omitted (no current holding).
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
    splitRatio: null,
    proceedsUnknown: null,
    voidedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function split(ticker: string, tradeDate: string, ratio: number): LedgerRow {
  return row({
    type: "split",
    ticker,
    tradeDate,
    quantity: null,
    unitPrice: null,
    amount: 0,
    splitRatio: ratio,
  });
}

describe("deriveLots — FIFO", () => {
  it("consumes the oldest lot first on a sell", () => {
    const { positions } = deriveLots([
      row({ tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({ tradeDate: "2026-02-01", quantity: 10, unitPrice: 200 }),
      row({ type: "sell", tradeDate: "2026-03-01", quantity: -10, unitPrice: 250, amount: 2500 }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    // The first (100) lot is consumed; only the 200 lot remains.
    expect(aapl?.quantity).toBe(10);
    expect(aapl?.avgCost).toBe(200);
    expect(aapl?.acquiredDate).toBe("2026-02-01");
    expect(aapl?.hasUnknownBasis).toBe(false);
  });

  it("weights average cost across remaining lots", () => {
    const { positions } = deriveLots([
      row({ tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({ tradeDate: "2026-02-01", quantity: 30, unitPrice: 200 }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    expect(aapl?.quantity).toBe(40);
    expect(aapl?.avgCost).toBe((10 * 100 + 30 * 200) / 40); // 175
    expect(aapl?.acquiredDate).toBe("2026-01-01"); // earliest open lot
  });

  it("partially consumes a lot, keeping the residual at its cost", () => {
    const { positions } = deriveLots([
      row({ tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({ type: "sell", tradeDate: "2026-02-01", quantity: -4, amount: 800 }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    expect(aapl?.quantity).toBe(6);
    expect(aapl?.avgCost).toBe(100);
  });

  it("omits a fully-closed position", () => {
    const { positions } = deriveLots([
      row({ tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({ type: "sell", tradeDate: "2026-02-01", quantity: -10, amount: 1200 }),
    ]);
    expect(positions.find((p) => p.ticker === "AAPL")).toBeUndefined();
  });

  it("flags a transfer-in with no basis as unknown — never zero", () => {
    const { positions, lots } = deriveLots([
      row({
        type: "transfer",
        tradeDate: "2026-01-01",
        quantity: 25,
        unitPrice: null,
        amount: 0,
        basisUnknown: "transferred in from another broker; no acquisition record",
      }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    expect(aapl?.quantity).toBe(25);
    expect(aapl?.avgCost).toBeNull(); // unknown — NOT 0
    expect(aapl?.hasUnknownBasis).toBe(true);
    expect(lots[0].basisUnknown).toBe(true);
    expect(lots[0].costPerShare).toBeNull();
  });

  it("reports avg cost over the known lots when basis is partly unknown", () => {
    const { positions } = deriveLots([
      row({
        type: "transfer",
        tradeDate: "2026-01-01",
        quantity: 10,
        unitPrice: null,
        amount: 0,
        basisUnknown: "no record",
      }),
      row({ tradeDate: "2026-02-01", quantity: 10, unitPrice: 200 }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    expect(aapl?.quantity).toBe(20);
    expect(aapl?.avgCost).toBe(200); // weighted over the known lot only
    expect(aapl?.hasUnknownBasis).toBe(true); // the gap is surfaced
  });

  it("ignores cash events (null quantity) and voided rows", () => {
    const { positions } = deriveLots([
      row({ tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({ type: "dividend", tradeDate: "2026-02-01", quantity: null, unitPrice: null, amount: 42 }),
      row({ tradeDate: "2026-03-01", quantity: 5, unitPrice: 300, voidedAt: "2026-03-02T00:00:00.000Z" }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    expect(aapl?.quantity).toBe(10); // dividend + voided buy both ignored
    expect(aapl?.avgCost).toBe(100);
  });

  it("derives lot cost from amount when unit price is absent", () => {
    const { positions } = deriveLots([
      row({ tradeDate: "2026-01-01", quantity: 4, unitPrice: null, amount: -600 }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    expect(aapl?.avgCost).toBe(150); // |−600| / 4
    expect(aapl?.hasUnknownBasis).toBe(false);
  });
});

describe("deriveLots — same-day ordering", () => {
  it("nets a same-day buy then sell to a closed position", () => {
    const { positions } = deriveLots([
      row({ tradeDate: "2026-03-01", quantity: 10, unitPrice: 100 }),
      row({ type: "sell", tradeDate: "2026-03-01", quantity: -10, amount: 1200 }),
    ]);
    expect(positions.find((p) => p.ticker === "AAPL")).toBeUndefined();
  });

  it("does not phantom a position when the sell is ordered before the buy", () => {
    // Acquisitions are processed before disposals on the same day, so even with
    // the sell listed first the buy is in the queue when the sell consumes it —
    // no over-sell into a phantom open lot.
    const { positions } = deriveLots([
      row({ type: "sell", tradeDate: "2026-03-01", quantity: -10, amount: 1200 }),
      row({ tradeDate: "2026-03-01", quantity: 10, unitPrice: 100 }),
    ]);
    expect(positions.find((p) => p.ticker === "AAPL")).toBeUndefined();
  });

  it("a same-day sell still consumes the OLDEST lot, not that day's buy", () => {
    const { positions } = deriveLots([
      row({ tradeDate: "2026-01-01", quantity: 10, unitPrice: 10 }), // old lot
      row({ tradeDate: "2026-03-01", quantity: 10, unitPrice: 200 }), // same-day buy
      row({ type: "sell", tradeDate: "2026-03-01", quantity: -10, amount: 2500 }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    // FIFO: the sell consumes the Jan lot; the same-day Mar buy remains.
    expect(aapl?.quantity).toBe(10);
    expect(aapl?.avgCost).toBe(200);
    expect(aapl?.acquiredDate).toBe("2026-03-01");
  });
});

describe("deriveLots — stock splits (FIX-874 follow-up)", () => {
  it("a 2:1 split scales open lots so a full sell realizes ~$0, not a phantom loss", () => {
    // The SCHO scenario: buy 100 @ $48, 2:1 split → 200 @ $24, sell all 200 @ $24.
    // Real gain ≈ 0. Without split handling FIFO matched $48 basis to $24 proceeds
    // (a −$2,400 fake loss) AND over-sold 100 shares into a basis-unknown remainder.
    const { disposals, positions } = deriveLots([
      row({ ticker: "SCHO", tradeDate: "2024-01-01", quantity: 100, unitPrice: 48, amount: -4800 }),
      split("SCHO", "2024-11-07", 2),
      row({ type: "sell", ticker: "SCHO", tradeDate: "2024-12-01", quantity: -200, unitPrice: 24, amount: 4800 }),
    ]);
    // Position fully closed, no phantom remainder.
    expect(positions.find((p) => p.ticker === "SCHO")).toBeUndefined();
    // Exactly one disposal (the single split-adjusted lot), no over-sell remainder.
    expect(disposals).toHaveLength(1);
    const d = disposals[0];
    expect(d.quantity).toBe(200);
    expect(d.proceeds).toBeCloseTo(4800, 6);
    expect(d.costBasis).toBeCloseTo(4800, 6);
    expect(d.gain).toBeCloseTo(0, 6);
    expect(d.basisUnknown).toBeNull();
  });

  it("adjusts the OPEN position quantity + average cost through a split", () => {
    // NVDA 10:1: buy 10 @ $1,200 → hold 100 @ $120. Total basis preserved.
    const { positions } = deriveLots([
      row({ ticker: "NVDA", tradeDate: "2024-01-01", quantity: 10, unitPrice: 1200, amount: -12000 }),
      split("NVDA", "2024-06-10", 10),
    ]);
    const nvda = positions.find((p) => p.ticker === "NVDA");
    expect(nvda?.quantity).toBeCloseTo(100, 6);
    expect(nvda?.avgCost).toBeCloseTo(120, 6);
    expect(nvda?.acquiredDate).toBe("2024-01-01"); // the split doesn't reset holding period
  });

  it("handles a reverse split (ratio < 1)", () => {
    // 1:10 reverse: buy 100 @ $5 → 10 @ $50, sell 10 @ $50 → ~$0 gain.
    const { disposals } = deriveLots([
      row({ ticker: "XYZ", tradeDate: "2025-01-01", quantity: 100, unitPrice: 5, amount: -500 }),
      split("XYZ", "2025-06-01", 0.1),
      row({ type: "sell", ticker: "XYZ", tradeDate: "2025-07-01", quantity: -10, unitPrice: 50, amount: 500 }),
    ]);
    expect(disposals).toHaveLength(1);
    expect(disposals[0].gain).toBeCloseTo(0, 6);
  });

  it("splits only the pre-split lots; a post-split buy is unaffected", () => {
    // Buy 100 @ $48, 2:1 split (→200 @ $24), then buy 50 more @ $24. Hold 250 @ $24.
    const { positions } = deriveLots([
      row({ ticker: "SCHO", tradeDate: "2024-01-01", quantity: 100, unitPrice: 48, amount: -4800 }),
      split("SCHO", "2024-11-07", 2),
      row({ ticker: "SCHO", tradeDate: "2024-11-20", quantity: 50, unitPrice: 24, amount: -1200 }),
    ]);
    const scho = positions.find((p) => p.ticker === "SCHO");
    expect(scho?.quantity).toBeCloseTo(250, 6);
    expect(scho?.avgCost).toBeCloseTo(24, 6);
  });

  it("a split before any lot exists is a harmless no-op", () => {
    const { positions, disposals } = deriveLots([
      split("SCHO", "2024-11-07", 2),
      row({ ticker: "SCHO", tradeDate: "2024-12-01", quantity: 10, unitPrice: 24, amount: -240 }),
    ]);
    expect(positions.find((p) => p.ticker === "SCHO")?.quantity).toBe(10);
    expect(disposals).toHaveLength(0);
  });

  it("keeps a same-day buy→split→sell consistent (split applies after the buy)", () => {
    const { disposals } = deriveLots([
      row({ ticker: "SCHO", tradeDate: "2024-11-07", quantity: 100, unitPrice: 48, amount: -4800 }),
      split("SCHO", "2024-11-07", 2),
      row({ type: "sell", ticker: "SCHO", tradeDate: "2024-11-07", quantity: -200, unitPrice: 24, amount: 4800 }),
    ]);
    expect(disposals).toHaveLength(1);
    expect(disposals[0].gain).toBeCloseTo(0, 6);
  });
});
