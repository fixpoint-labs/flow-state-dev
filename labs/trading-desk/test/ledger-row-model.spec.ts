/**
 * Unit tests for `buildLedgerRowModel` — the pure view-model behind the
 * transactions list (FIX-774).
 *
 * The test env is node + `.spec.ts` (no JSX), so — matching the
 * `buildHoldingRowModel` precedent — the load-bearing null/sign logic is
 * extracted into a pure helper and tested directly. These are INTENT-ENCODING
 * tests: each assertion locks a real-money trust gate, not just a code path.
 *
 *   - a buy carries a negative cash amount + positive quantity (sign fidelity:
 *     a flipped sign would read a buy as a sale);
 *   - a pure-cash event (dividend) renders "—" for quantity — NEVER a fabricated
 *     0 (a 0-share row would corrupt a lot derivation read);
 *   - a `basisUnknown` transfer sets the badge flag so the basis hole is visible;
 *   - a `voidedAt` row sets the voided flag so a tombstone renders muted;
 *   - missing values render "—", never 0.
 */
import { describe, expect, it } from "vitest";
import { buildLedgerRowModel } from "../components/portfolio/ledger-row-model";
import { DASH } from "../components/portfolio/portfolio-format";
import type { LedgerRow } from "../domain/portfolio/schema/ledger-schema";

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: "evt_1",
    accountId: "acc_1",
    userId: "devuser",
    type: "buy",
    ticker: "NVDA",
    tradeDate: "2026-05-06",
    settleDate: null,
    quantity: 10,
    unitPrice: 120,
    amount: -1200,
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
    createdAt: "2026-05-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildLedgerRowModel", () => {
  it("renders a buy with negative cash and positive quantity", () => {
    const m = buildLedgerRowModel(row());
    expect(m.type).toBe("Buy");
    expect(m.ticker).toBe("NVDA");
    expect(m.tradeDate).toBe("2026-05-06");
    expect(m.quantity).toBe("+10");
    expect(m.amount.text).toBe("-$1,200.00");
    expect(m.amount.direction).toBe("down");
    expect(m.source).toBe("manual");
    expect(m.basisUnknown).toBe(false);
    expect(m.voided).toBe(false);
  });

  it("renders a sell with positive cash and negative quantity", () => {
    const m = buildLedgerRowModel(
      row({ type: "sell", quantity: -10, amount: 1300 }),
    );
    expect(m.type).toBe("Sell");
    expect(m.quantity).toBe("-10");
    expect(m.amount.text).toBe("+$1,300.00");
    expect(m.amount.direction).toBe("up");
  });

  it("shows — for quantity on a cash dividend, never a fabricated 0", () => {
    const m = buildLedgerRowModel(
      row({ type: "dividend", quantity: null, amount: 42, unitPrice: null }),
    );
    expect(m.type).toBe("Dividend");
    // Dividends carry a ticker even with no share movement.
    expect(m.ticker).toBe("NVDA");
    expect(m.quantity).toBe(DASH);
    expect(m.amount.text).toBe("+$42.00");
  });

  it("sets the basisUnknown flag on a transfer-in basis hole", () => {
    const m = buildLedgerRowModel(
      row({ type: "transfer", basisUnknown: "transfer-in, no acquisition record" }),
    );
    expect(m.basisUnknown).toBe(true);
  });

  it("sets the voided flag on a tombstoned row", () => {
    const m = buildLedgerRowModel(
      row({ voidedAt: "2026-05-07T00:00:00.000Z" }),
    );
    expect(m.voided).toBe(true);
  });

  it("renders — for a missing ticker, never a fabricated value", () => {
    const m = buildLedgerRowModel(
      row({ type: "deposit", ticker: null, quantity: null, amount: 5000 }),
    );
    expect(m.ticker).toBe(DASH);
    expect(m.quantity).toBe(DASH);
    expect(m.amount.text).toBe("+$5,000.00");
  });

  it("renders a split with its ratio in the quantity column (FIX-876)", () => {
    const m = buildLedgerRowModel(
      row({
        type: "split",
        quantity: null,
        unitPrice: null,
        amount: 0,
        attributes: { numerator: 10, denominator: 1 },
      }),
    );
    expect(m.type).toBe("Split");
    // The split carries no share delta — show the 10:1 ratio instead of "—".
    expect(m.quantity).toBe("10:1");
    expect(m.amount.text).toBe("$0.00");
  });
});
