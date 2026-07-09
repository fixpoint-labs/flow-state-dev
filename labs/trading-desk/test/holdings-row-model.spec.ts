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
    assetClass: "equity",
    assetType: "equity",
    attributes: { kind: "none" },
    dataQuality: null,
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
    // A live quote is the honest provenance — no non-live marker in the UI.
    expect(m.priceSource).toBe("quote");
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

  it("surfaces a short uppercase asset-type label for an equity row", () => {
    const m = buildHoldingRowModel(holding(), quote(120), "USD", 2400);
    expect(m.typeLabel).toBe("EQ");
  });

  it("values a bond at its carried statement mark and labels it BOND (FIX-773 Slice C)", () => {
    // A bond has no live quote — `quote` is undefined — yet it values at the
    // carried mark, not "—". This is the whole point of the slice in the pane.
    const bond = holding({
      ticker: "912828YK0",
      quantity: 5,
      costBasis: null,
      assetType: "bond",
      assetClass: "fixed_income",
      attributes: { kind: "bond", cusip: "912828YK0", markPrice: 98.5 },
    });
    const m = buildHoldingRowModel(bond, undefined, "USD", 492.5);
    expect(m.typeLabel).toBe("BOND");
    expect(m.price).toBe("$98.50");
    expect(m.value).toBe("$492.50");
    expect(m.weight).toBe("100.0%");
    // The price is a carried statement mark, NOT a live quote — the UI flags it so
    // it is never read as a quote (the honesty this slice adds).
    expect(m.priceSource).toBe("statement");
  });

  it("values an MMF at par $1.00 even with no quote", () => {
    const mmf = holding({
      ticker: "SPAXX",
      quantity: 1500,
      costBasis: null,
      assetType: "money_market",
      assetClass: "cash",
      attributes: { kind: "cash_equivalent" },
    });
    const m = buildHoldingRowModel(mmf, undefined, "USD", 1500);
    expect(m.typeLabel).toBe("MMF");
    expect(m.price).toBe("$1.00");
    expect(m.value).toBe("$1,500.00");
    // Valued at par — provenance is "par", not a live quote.
    expect(m.priceSource).toBe("par");
  });

  it("shows — for an unpriced bond but still renders its type (no fabricated price)", () => {
    const bond = holding({
      ticker: "999999XX9",
      quantity: 7,
      costBasis: null,
      assetType: "bond",
      assetClass: "fixed_income",
      attributes: { kind: "bond", cusip: "999999XX9", markPrice: null },
    });
    const m = buildHoldingRowModel(bond, undefined, "USD", 1000);
    expect(m.typeLabel).toBe("BOND");
    expect(m.price).toBe(DASH);
    expect(m.value).toBe(DASH);
    expect(m.weight).toBe(DASH);
    // No mark and no quote → unavailable provenance (and the "—" gate above).
    expect(m.priceSource).toBe("unavailable");
  });

  it("renders uP/L percent from cost and blanks it with the dollar figure", () => {
    // price 120 on cost 100 → +20%; the % and $ figures always describe the
    // same book, so a missing price blanks both.
    const priced = buildHoldingRowModel(holding(), quote(120), "USD", 2400);
    expect(priced.uplPct).toBe("+20.0%");
    const unpriced = buildHoldingRowModel(holding(), undefined, "USD", 2400);
    expect(unpriced.uplPct).toBe(DASH);
    expect(unpriced.upl.text).toBe(DASH);
    // A zero cost basis has no return base — "—", not Infinity.
    const zeroCost = buildHoldingRowModel(
      holding({ costBasis: 0 }),
      quote(120),
      "USD",
      2400,
    );
    expect(zeroCost.uplPct).toBe(DASH);
  });

  it("classifies term per ledger lot, falling back to the holding's own acquiredDate", () => {
    const asOf = new Date(Date.UTC(2026, 6, 4));
    // Ledger lots present → per-lot mixed split, NOT the earliest-date label.
    // (`thesisTickers` sits before the pinned `asOf`, so pass `undefined` for it.)
    const mixed = buildHoldingRowModel(
      holding({ acquiredDate: "2024-01-10" }),
      quote(120),
      "USD",
      2400,
      null,
      [
        { quantity: 6, acquiredDate: "2024-01-10" },
        { quantity: 4, acquiredDate: "2026-04-04" },
      ],
      undefined,
      asOf,
    );
    expect(mixed.term).toBe("6L / 4S · 9 mo");
    // No ledger lots → the declared acquiredDate is one pseudo-lot.
    const csvOnly = buildHoldingRowModel(
      holding({ acquiredDate: "2024-01-10" }),
      quote(120),
      "USD",
      2400,
      null,
      null,
      undefined,
      asOf,
    );
    expect(csvOnly.term).toBe("Long");
    // No date anywhere → unknown, never a guessed term.
    const undated = buildHoldingRowModel(
      holding({ acquiredDate: null }),
      quote(120),
      "USD",
      2400,
      null,
      null,
      undefined,
      asOf,
    );
    expect(undated.term).toBe(DASH);
  });

  it("shows dividends earned when recorded and blanks when there is no history", () => {
    // No dividend history ≠ zero income — "—" is the honest render, $0 would
    // assert knowledge the ledger doesn't have.
    const withIncome = buildHoldingRowModel(holding(), quote(120), "USD", 2400, 55.5);
    expect(withIncome.dividends).toBe("$55.50");
    const noHistory = buildHoldingRowModel(holding(), quote(120), "USD", 2400, null);
    expect(noHistory.dividends).toBe(DASH);
  });

  // The `inconsistent` flag (FIX-876) flows through the ONE row model so the ⚠
  // "review transactions" marker + blanked numbers show identically in the table
  // and the card. It exists so an over-sold position (an unaccounted split) is
  // never shown as a fabricated figure OR silently dropped.
  describe("inconsistent-history marker", () => {
    it("flags an inconsistent row and blanks its quantity/value/weight/P-L", () => {
      const m = buildHoldingRowModel(
        holding({ quantity: 0, costBasis: null, dataQuality: "inconsistent_history" }),
        quote(120),
        "USD",
        2400,
      );
      expect(m.inconsistent).toBe(true);
      expect(m.quantity).toBe(DASH);
      expect(m.value).toBe(DASH);
      expect(m.weight).toBe(DASH);
      expect(m.upl.text).toBe(DASH);
      expect(m.upl.direction).toBe("flat");
      expect(m.term).toBe(DASH);
    });

    it("is false for a normal row", () => {
      const m = buildHoldingRowModel(holding(), quote(120), "USD", 2400);
      expect(m.inconsistent).toBe(false);
      expect(m.quantity).toBe("10");
    });
  });

  // The `hasThesis` flag flows through the ONE row model so both the desktop
  // table and the mobile card show the per-holding thesis indicator by
  // construction (the same parity guarantee as the price gates above).
  describe("hasThesis indicator", () => {
    it("is true when the household has a thesis for the ticker (case-insensitive)", () => {
      const m = buildHoldingRowModel(
        holding({ ticker: "nvda" }),
        quote(120),
        "USD",
        2400,
        null,
        null,
        new Set(["NVDA"]),
      );
      expect(m.hasThesis).toBe(true);
    });

    it("is false when no thesis exists for the ticker", () => {
      const m = buildHoldingRowModel(
        holding(),
        quote(120),
        "USD",
        2400,
        null,
        null,
        new Set(["AAPL"]),
      );
      expect(m.hasThesis).toBe(false);
    });

    it("defaults to false when the thesis-ticker set is omitted", () => {
      const m = buildHoldingRowModel(holding(), quote(120), "USD", 2400);
      expect(m.hasThesis).toBe(false);
    });
  });
});
