/**
 * Tests for the `<portfolioContext>` formatter's household-health block (FIX-762).
 *
 * Intent encoded:
 *   1. When the snapshot carries a `health` block, the formatter renders the
 *      deterministic aggregate lines (allocation, concentration, sector, the
 *      no-look-through caveat) alongside the existing NAV/coverage lines.
 *   2. A drift line appears ONLY when `health.drift` is present (it is always null
 *      in v1 — the FIX-761-gated slice), never fabricated.
 *   3. The tag is still suppressed (null) on a portfolio-blind snapshot.
 */
import { describe, expect, it } from "vitest";
import { formatPortfolioContext } from "../flows/analysis/lib/format";
import type { PortfolioContextInput } from "../flows/analysis/flow-schema";

function snapshot(over: Partial<PortfolioContextInput> = {}): PortfolioContextInput {
  return {
    totalNav: 4000,
    snapshotAsOf: "2026-05-06",
    pricedHoldings: 2,
    totalHoldings: 2,
    accounts: [{ id: "acc-1", label: "Taxable", type: "taxable", cash: 1000 }],
    holdings: [
      { ticker: "AAPL", account: "acc-1", weightPct: 25, marketValue: 1000, costBasis: 900, sector: "Technology" },
      { ticker: "SPY", account: "acc-1", weightPct: 50, marketValue: 2000, costBasis: 1500, sector: null },
    ],
    health: {
      cashPct: 25,
      coveragePct: 100,
      assetClassAllocation: [{ assetClass: "equity", pct: 75 }, { assetClass: "cash", pct: 25 }],
      sectorExposure: [{ bucket: "Technology", pct: 33.3 }, { bucket: "Funds (no look-through)", pct: 66.7 }],
      concentration: {
        maxPosition: { ticker: "AAPL", weightPct: 33.3 },
        top5Pct: 100,
        effectivePositions: 1.8,
        flags: ["AAPL 33.3% (alert)"],
      },
      drift: null,
    },
    ...over,
  };
}

describe("formatPortfolioContext — health block (FIX-762)", () => {
  it("renders the household-health aggregate lines when present", () => {
    const out = formatPortfolioContext(snapshot(), [], "NVDA");
    expect(out).toContain("Household health");
    expect(out).toContain("Allocation by class: equity 75.0%, cash 25.0%.");
    expect(out).toContain("largest name AAPL 33.3%");
    expect(out).toContain("Sector exposure: Technology 33.3%, Funds (no look-through) 66.7%.");
    expect(out).toContain("Concentration flags: AAPL 33.3% (alert).");
    expect(out).toContain("no ETF look-through");
  });

  it("omits the drift line when there is no mandate (drift null)", () => {
    const out = formatPortfolioContext(snapshot(), [], "NVDA");
    expect(out).not.toContain("Drift vs mandate");
  });

  it("renders the drift line when a drift read is present (forward-compat)", () => {
    const out = formatPortfolioContext(
      snapshot({
        health: {
          ...snapshot().health!,
          drift: { totalDriftPct: 8, rebalanceSuggested: true, breaches: ["fixed_income 24% vs target 30 — LOW"] },
        },
      }),
      [],
      "NVDA",
    );
    expect(out).toContain("Drift vs mandate: total 8.0% — rebalance suggested");
    expect(out).toContain("fixed_income 24% vs target 30 — LOW");
  });

  it("still suppresses the tag on a portfolio-blind snapshot", () => {
    expect(formatPortfolioContext(null, [], "NVDA")).toBeNull();
  });

  it("renders NAV/coverage even when the health block is absent", () => {
    const out = formatPortfolioContext(snapshot({ health: null }), [], "NVDA");
    expect(out).toContain("Total portfolio NAV");
    expect(out).not.toContain("Household health");
  });
});
