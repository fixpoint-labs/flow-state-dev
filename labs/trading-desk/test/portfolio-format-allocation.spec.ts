/**
 * Unit tests for `allocationByClass` — the derived stocks/bonds/cash breakdown.
 *
 * Intent, not just behavior: the allocation split is the point of the whole
 * asset-class taxonomy. It must group by class, weight each slice against the
 * priced total, and — the real-money gate — treat an unpriced holding as 0 mass
 * (never fabricate a value), the same "—" discipline the rest of this module
 * applies. Slices are ordered by value so the biggest exposure reads first.
 */
import { describe, expect, it } from "vitest";
import { allocationByClass } from "../components/portfolio/portfolio-format";

describe("allocationByClass", () => {
  it("groups holdings by class and weights each slice against the total", () => {
    const slices = allocationByClass([
      { assetClass: "equity", value: 30 },
      { assetClass: "fixed_income", value: 50 },
      { assetClass: "fixed_income", value: 10 },
      { assetClass: "cash", value: 10 },
    ]);
    // Sorted by value desc: fixed_income 60, equity 30, cash 10 (total 100).
    expect(slices).toEqual([
      { assetClass: "fixed_income", value: 60, weight: 0.6 },
      { assetClass: "equity", value: 30, weight: 0.3 },
      { assetClass: "cash", value: 10, weight: 0.1 },
    ]);
  });

  it("treats an unpriced (null) holding as 0 mass, not a fabricated value", () => {
    const slices = allocationByClass([
      { assetClass: "equity", value: 40 },
      { assetClass: "fixed_income", value: null },
    ]);
    // The bond ETF has no price → contributes nothing; it does not appear and
    // does not distort equity's weight (which is 100% of the priced book).
    expect(slices).toEqual([{ assetClass: "equity", value: 40, weight: 1 }]);
  });

  it("returns an empty array when nothing is priced", () => {
    expect(
      allocationByClass([{ assetClass: "equity", value: null }]),
    ).toEqual([]);
  });
});
