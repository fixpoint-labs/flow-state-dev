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
import { deriveLots, inferSplit, previewSplitResult } from "@/domain/portfolio/math/lots";
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
    lotKey: null,
    closesLotKey: null,
    attributes: null,
    voidedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
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

/** A `split` event: no share delta / cash — carries a numerator:denominator ratio. */
describe("deriveLots — specific-lot consumption (FIX-895)", () => {
  it("splices the NAMED lot out, leaving the older unnamed-by-the-sell lot open", () => {
    // Two open keyed lots. The sell closes the NEWER lot by key; the OLDER lot
    // must remain open at its own cost. FIFO (oldest-first) would instead consume
    // the older lot — the corruption specific-lot identity prevents.
    const { positions } = deriveLots([
      row({ id: "b1", tradeDate: "2024-01-01", quantity: 10, unitPrice: 100, lotKey: "lot-old" }),
      row({ id: "b2", tradeDate: "2026-02-01", quantity: 10, unitPrice: 200, lotKey: "lot-new" }),
      row({
        id: "s1",
        type: "sell",
        tradeDate: "2026-03-01",
        quantity: -10,
        amount: 2500,
        closesLotKey: "lot-new",
      }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    expect(aapl?.quantity).toBe(10); // only the older lot remains
    expect(aapl?.avgCost).toBe(100); // the OLDER lot's cost, not a FIFO residual
    expect(aapl?.acquiredDate).toBe("2024-01-01");
  });

  it("partially closes the named lot, keeping the residual at its cost", () => {
    const { positions } = deriveLots([
      row({ id: "b1", tradeDate: "2024-01-01", quantity: 10, unitPrice: 100, lotKey: "lot-old" }),
      row({ id: "b2", tradeDate: "2026-02-01", quantity: 10, unitPrice: 200, lotKey: "lot-new" }),
      row({
        id: "s1",
        type: "sell",
        tradeDate: "2026-03-01",
        quantity: -4,
        amount: 1000,
        closesLotKey: "lot-new",
      }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    expect(aapl?.quantity).toBe(16); // 10 old + 6 residual of the newer lot
    expect(aapl?.avgCost).toBe((10 * 100 + 6 * 200) / 16); // 137.5
  });

  it("a keyed disposal for a missing lot consumes NOTHING (no FIFO fallback)", () => {
    const { positions } = deriveLots([
      row({ id: "b1", tradeDate: "2024-01-01", quantity: 10, unitPrice: 100, lotKey: "lot-a" }),
      row({
        id: "s1",
        type: "sell",
        tradeDate: "2026-03-01",
        quantity: -10,
        amount: 2500,
        closesLotKey: "lot-missing",
      }),
    ]);
    // The unrelated lot is untouched — the whole position stays open.
    expect(positions.find((p) => p.ticker === "AAPL")?.quantity).toBe(10);
  });
});

describe("deriveLots — D5 aggregate basis (FIX-895)", () => {
  it("flags hasUnknownKeyedBasis when a KEYED open lot lacks basis", () => {
    const { positions } = deriveLots([
      row({ id: "b1", tradeDate: "2026-01-01", quantity: 10, unitPrice: 100, lotKey: "lot-known" }),
      row({
        id: "b2",
        tradeDate: "2026-02-01",
        quantity: 5,
        unitPrice: null,
        amount: 0,
        basisUnknown: "import-missing-basis",
        lotKey: "lot-nobasis",
      }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    expect(aapl?.hasUnknownBasis).toBe(true);
    expect(aapl?.hasUnknownKeyedBasis).toBe(true); // materializePositions nulls basis
    expect(aapl?.avgCost).toBe(100); // deriveLots itself still reports the known portion
  });

  it("does NOT flag hasUnknownKeyedBasis for an UNKEYED unknown-basis lot (FIFO feeds unchanged, BP-030)", () => {
    const { positions } = deriveLots([
      row({ id: "b1", tradeDate: "2026-01-01", quantity: 10, unitPrice: 100 }),
      row({
        id: "t1",
        type: "transfer",
        tradeDate: "2026-02-01",
        quantity: 5,
        unitPrice: null,
        amount: 0,
        basisUnknown: "no record",
      }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    expect(aapl?.hasUnknownBasis).toBe(true);
    expect(aapl?.hasUnknownKeyedBasis).toBe(false); // keeps its partial-average holding basis
  });
});

function split(numerator: number, denominator: number, over: Partial<LedgerRow> = {}): LedgerRow {
  return row({
    type: "split",
    quantity: null,
    unitPrice: null,
    amount: 0,
    attributes: { numerator, denominator },
    ...over,
  });
}

describe("deriveLots — stock splits (FIX-876)", () => {
  it("rebases open lots by the ratio and divides basis, preserving the acquired date", () => {
    const { positions } = deriveLots([
      row({ tradeDate: "2024-01-01", quantity: 10, unitPrice: 900 }),
      split(10, 1, { tradeDate: "2024-06-10" }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    expect(aapl?.quantity).toBe(100); // 10 × 10
    expect(aapl?.avgCost).toBe(90); // 900 ÷ 10
    // The holding period is unchanged by a split (IRS rule) — earliest lot date holds.
    expect(aapl?.acquiredDate).toBe("2024-01-01");
  });

  it("supports a reverse split (1-for-10): fewer shares, higher basis", () => {
    const { positions } = deriveLots([
      row({ tradeDate: "2024-01-01", quantity: 100, unitPrice: 5 }),
      split(1, 10, { tradeDate: "2024-06-10" }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    expect(aapl?.quantity).toBe(10); // 100 × 0.1
    expect(aapl?.avgCost).toBe(50); // 5 ÷ 0.1
  });

  it("applies the split BEFORE same-day trades (no double-adjust)", () => {
    // The split is effective at the open, so a same-day post-split buy is already
    // in post-split units and must NOT be rebased. Only the pre-split lot scales.
    const { positions } = deriveLots([
      row({ tradeDate: "2024-01-01", quantity: 10, unitPrice: 900 }), // pre-split lot
      split(10, 1, { tradeDate: "2024-06-10" }),
      row({ tradeDate: "2024-06-10", quantity: 5, unitPrice: 90 }), // same-day post-split buy
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    // 10×10 (rebased) + 5 (not re-scaled) = 105.
    expect(aapl?.quantity).toBe(105);
  });

  it("lets a post-split sell consume the rebased lots correctly", () => {
    const { positions, oversold } = deriveLots([
      row({ tradeDate: "2024-01-01", quantity: 12, unitPrice: 900 }),
      split(10, 1, { tradeDate: "2024-06-10" }),
      row({ type: "sell", tradeDate: "2024-07-31", quantity: -50, amount: 6000 }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    // 12×10 = 120 rebased shares, minus a 50-share post-split sell = 70.
    expect(aapl?.quantity).toBe(70);
    expect(oversold.has("AAPL")).toBe(false);
  });

  it("flags OVERSOLD when a post-split sell exceeds the un-split holding, and clears it once the split is recorded", () => {
    // The FIX-876 root cause: 12 pre-split shares, a 50-share post-split sell. With
    // NO split, FIFO over-sells (only 12 held) → no position AND an oversold signal.
    const withoutSplit = deriveLots([
      row({ tradeDate: "2024-01-01", quantity: 12, unitPrice: 900 }),
      row({ type: "sell", tradeDate: "2024-07-31", quantity: -50, amount: 6000 }),
    ]);
    expect(withoutSplit.positions.find((p) => p.ticker === "AAPL")).toBeUndefined();
    expect(withoutSplit.oversold.has("AAPL")).toBe(true);

    // Recording the split explains the gap: the position derives and oversold clears.
    const withSplit = deriveLots([
      row({ tradeDate: "2024-01-01", quantity: 12, unitPrice: 900 }),
      split(10, 1, { tradeDate: "2024-06-10" }),
      row({ type: "sell", tradeDate: "2024-07-31", quantity: -50, amount: 6000 }),
    ]);
    expect(withSplit.positions.find((p) => p.ticker === "AAPL")?.quantity).toBe(70);
    expect(withSplit.oversold.has("AAPL")).toBe(false);
  });

  it("a split with no open lots for the ticker is a harmless no-op", () => {
    const { positions } = deriveLots([split(10, 1, { tradeDate: "2024-06-10" })]);
    expect(positions.find((p) => p.ticker === "AAPL")).toBeUndefined();
  });

  it("does NOT rebase a KEYED lot spanning the split date (broker file already split-adjusted, FIX-895)", () => {
    // A tax-lot import's quantities/basis are already split-adjusted as of export,
    // so a split event must not double-adjust a keyed lot. An unkeyed lot on the
    // same ticker still rebases — the skip is per-lot, not per-ticker.
    const { positions } = deriveLots([
      row({ tradeDate: "2024-01-01", quantity: 100, unitPrice: 90, lotKey: "lot-keyed" }),
      row({ tradeDate: "2024-01-02", quantity: 10, unitPrice: 900 }), // unkeyed
      split(10, 1, { tradeDate: "2024-06-10" }),
    ]);
    const aapl = positions.find((p) => p.ticker === "AAPL");
    // Keyed lot stays 100 @ 90; unkeyed lot rebases 10×10=100 @ 90. Total 200.
    expect(aapl?.quantity).toBe(200);
    expect(aapl?.avgCost).toBe(90);
  });

  it("infers a forward split from the price cliff when a near-split trade exists", () => {
    // Pre-split buys near the split price ($900, $1100) then a post-split sell at
    // $120: the largest adjacent cliff is 1100/120 ≈ 9.17 → snaps to 10:1, and it
    // resolves the over-sell, so it's returned.
    const s = inferSplit(
      [
        row({ ticker: "NVDA", tradeDate: "2024-01-01", quantity: 10, unitPrice: 900 }),
        row({ ticker: "NVDA", tradeDate: "2024-03-01", quantity: 5, unitPrice: 1100 }),
        row({ ticker: "NVDA", type: "sell", tradeDate: "2024-07-31", quantity: -50, unitPrice: 120, amount: 6000 }),
      ],
      "NVDA",
    );
    expect(s).toEqual({ numerator: 10, denominator: 1, tradeDate: "2024-07-31" });
  });

  it("returns null when no clean price cliff resolves the over-sell", () => {
    // A single far-from-split buy ($300) vs a $120 sell → cliff 2.5, and no
    // standard-ratio candidate that snaps actually reconciles the position cleanly
    // in a way we'd trust → null (never a fabricated ratio).
    const s = inferSplit(
      [
        row({ ticker: "NVDA", tradeDate: "2024-01-01", quantity: 10, unitPrice: 300 }),
        row({ ticker: "NVDA", type: "sell", tradeDate: "2024-07-31", quantity: -18, unitPrice: 120, amount: 2160 }),
      ],
      "NVDA",
    );
    // Documents the heuristic's honest limit: a sparse/ambiguous history isn't
    // force-fit. (Either null, or a snapped guess — assert it never throws and, if
    // returned, actually resolves the over-sell.)
    if (s !== null) {
      const { oversold } = deriveLots([
        row({ ticker: "NVDA", tradeDate: "2024-01-01", quantity: 10, unitPrice: 300 }),
        row({ ticker: "NVDA", type: "sell", tradeDate: "2024-07-31", quantity: -18, unitPrice: 120, amount: 2160 }),
        row({ ticker: "NVDA", type: "split", tradeDate: s.tradeDate, quantity: null, unitPrice: null, amount: 0, attributes: { numerator: s.numerator, denominator: s.denominator } }),
      ]);
      expect(oversold.has("NVDA")).toBe(false);
    }
  });

  it("returns null for a healthy (non-oversold) position — nothing to infer", () => {
    const s = inferSplit(
      [row({ ticker: "NVDA", tradeDate: "2024-01-01", quantity: 10, unitPrice: 900 })],
      "NVDA",
    );
    expect(s).toBeNull();
  });

  it("NVDA 10-for-1: a pre-split holding derives to exactly its post-split share count", () => {
    // The acceptance shape: applying the 10× split to the pre-split trades
    // reconstructs the true post-split position (the real WF: Investing Accounts
    // NVDA nets to 121.9346 shares).
    const { positions } = deriveLots([
      row({ ticker: "NVDA", tradeDate: "2024-01-01", quantity: 12.19346, unitPrice: 900 }),
      split(10, 1, { ticker: "NVDA", tradeDate: "2024-06-10" }),
    ]);
    const nvda = positions.find((p) => p.ticker === "NVDA");
    expect(nvda?.quantity).toBeCloseTo(121.9346, 4);
    expect(nvda?.avgCost).toBeCloseTo(90, 6); // 900 ÷ 10
  });

  it("previewSplitResult dry-runs the position a candidate split WOULD produce", () => {
    // 12 pre-split shares + a 50-share post-split sell — over-sold without a split.
    // Previewing a 10:1 split shows the resolved position (120 rebased − 50 = 70)
    // WITHOUT mutating the ledger, so the confirm dialog can show the post-calc amount.
    const events = [
      row({ ticker: "NVDA", tradeDate: "2024-01-01", quantity: 12, unitPrice: 900 }),
      row({ ticker: "NVDA", type: "sell", tradeDate: "2024-07-31", quantity: -50, amount: 6000 }),
    ];
    const preview = previewSplitResult(events, "NVDA", {
      numerator: 10,
      denominator: 1,
      tradeDate: "2024-06-10",
    });
    expect(preview?.quantity).toBe(70);
    expect(preview?.avgCost).toBeCloseTo(90, 6); // 900 ÷ 10
    // The candidate is a dry run: the source events are untouched (no split row added).
    expect(events).toHaveLength(2);
  });

  it("previewSplitResult returns null when the ratio leaves a residual buy open but STILL over-sells", () => {
    // The subtle case: a too-small split leaves the ticker oversold, but a later
    // buy clamps its way to a residual open position. `materializePositions` flags
    // this as inconsistent_history (oversold wins over the residual), so recording
    // the split would NOT heal the row — the preview must not show a reconciled
    // position nor enable confirm. 12 pre-split, 2:1 → 24, a 50-share sell (still
    // over-sells), then a 60-share buy leaves 60 open but oversold stays true.
    const preview = previewSplitResult(
      [
        row({ ticker: "NVDA", tradeDate: "2024-01-01", quantity: 12, unitPrice: 900 }),
        row({ ticker: "NVDA", type: "sell", tradeDate: "2024-07-31", quantity: -50, amount: 6000 }),
        row({ ticker: "NVDA", tradeDate: "2024-08-01", quantity: 60, unitPrice: 120 }),
      ],
      "NVDA",
      { numerator: 2, denominator: 1, tradeDate: "2024-06-10" },
    );
    expect(preview).toBeNull();
  });

  it("previewSplitResult returns null when the candidate ratio still leaves an over-sell", () => {
    // A 2:1 split only doubles 12 → 24 shares, still short of the 50-share sell.
    const preview = previewSplitResult(
      [
        row({ ticker: "NVDA", tradeDate: "2024-01-01", quantity: 12, unitPrice: 900 }),
        row({ ticker: "NVDA", type: "sell", tradeDate: "2024-07-31", quantity: -50, amount: 6000 }),
      ],
      "NVDA",
      { numerator: 2, denominator: 1, tradeDate: "2024-06-10" },
    );
    expect(preview).toBeNull();
  });
});
