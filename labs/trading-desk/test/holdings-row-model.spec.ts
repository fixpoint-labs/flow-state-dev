/**
 * Unit tests for `buildHoldingRowModel` — the shared view-model behind BOTH the
 * desktop holdings table row and the mobile holding card (FIX-757).
 *
 * The test env is node + `.spec.ts` (no JSX rendering), so — matching the
 * `buildLensCardModel` precedent — the load-bearing logic is extracted into a
 * pure helper and tested directly. These are INTENT-ENCODING tests: each
 * assertion locks the real-money trust gate for the mobile card layout, not
 * just a code path. Because the table row and the card consume the SAME model,
 * formatting parity between the two layouts holds by construction.
 *
 *   - a missing price renders "—" on price, value, weight, and uP/L — NEVER a
 *     fabricated number (BP-020 spirit at the formatting layer);
 *   - a null cost basis blanks avg cost and uP/L but keeps the real
 *     market value (value depends only on the live quote);
 *   - uP/L direction drives the up/down coloring, so a wrong sign would
 *     mis-color a loss as a gain.
 */
import { describe, expect, it } from "vitest";
import { buildHoldingRowModel } from "../components/portfolio/holdings-table";
import { DASH } from "../components/portfolio/portfolio-format";
import type { Holding } from "../src/flows/portfolio/portfolio-schema";
import type { Quote } from "../src/flows/portfolio/get-quotes";

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    ticker: "NVDA",
    quantity: 10,
    costBasis: 100,
    acquiredDate: null,
    ...overrides,
  };
}

function quote(price: number | null): Quote {
  return { ticker: "NVDA", price, asOf: "2026-05-06" };
}

describe("buildHoldingRowModel", () => {
  it("formats a fully priced holding (value, weight, gain direction)", () => {
    const m = buildHoldingRowModel(holding(), quote(120), "USD", 2400);
    expect(m.ticker).toBe("NVDA");
    expect(m.quantity).toBe("10");
    expect(m.avgCost).toBe("$100.00");
    expect(m.price).toBe("$120.00");
    expect(m.value).toBe("$1,200.00");
    // 1200 / 2400 of the account
    expect(m.weight).toBe("50.0%");
    // (120 − 100) × 10 = +$200, a gain → "up" drives the green coloring
    expect(m.upl.text).toBe("+$200.00");
    expect(m.upl.direction).toBe("up");
  });

  it("renders a loss with a down direction (never mis-colored)", () => {
    const m = buildHoldingRowModel(holding(), quote(80), "USD", 800);
    expect(m.upl.text).toBe("-$200.00");
    expect(m.upl.direction).toBe("down");
  });

  it("degrades EVERY price-derived field to — when the quote is missing", () => {
    const m = buildHoldingRowModel(holding(), undefined, "USD", 2400);
    expect(m.price).toBe(DASH);
    expect(m.value).toBe(DASH);
    expect(m.weight).toBe(DASH);
    expect(m.upl.text).toBe(DASH);
    expect(m.upl.direction).toBe("flat");
    // Stored fields stay real — only price-derived ones degrade.
    expect(m.quantity).toBe("10");
    expect(m.avgCost).toBe("$100.00");
  });

  it("treats a null-price quote the same as a missing quote", () => {
    const m = buildHoldingRowModel(holding(), quote(null), "USD", 2400);
    expect(m.price).toBe(DASH);
    expect(m.value).toBe(DASH);
    expect(m.upl.text).toBe(DASH);
  });

  it("blanks avg cost and uP/L on a null cost basis but keeps market value", () => {
    const m = buildHoldingRowModel(
      holding({ costBasis: null }),
      quote(120),
      "USD",
      2400,
    );
    expect(m.avgCost).toBe(DASH);
    expect(m.upl.text).toBe(DASH);
    expect(m.upl.direction).toBe("flat");
    expect(m.value).toBe("$1,200.00");
    expect(m.weight).toBe("50.0%");
  });

  it("blanks weight while the account total is still unknown", () => {
    const m = buildHoldingRowModel(holding(), quote(120), "USD", null);
    expect(m.weight).toBe(DASH);
    expect(m.value).toBe("$1,200.00");
  });
});
