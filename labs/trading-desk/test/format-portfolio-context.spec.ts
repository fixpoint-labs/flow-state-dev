/**
 * Tests for the `<portfolioContext>` formatter's household-health block (FIX-762)
 * and its ETF look-through second axis (FIX-801).
 *
 * Intent encoded:
 *   1. When the snapshot carries a `health` block, the formatter renders the
 *      deterministic aggregate lines (allocation, concentration, sector)
 *      alongside the existing NAV/coverage lines.
 *   2. A drift line appears ONLY when `health.drift` is present (it is always null
 *      in v1 — the FIX-761-gated slice), never fabricated.
 *   3. A look-through line appears ONLY when `health.lookThrough` is present
 *      (something was attributed through a fund), states the reading is a
 *      LOWER BOUND, and says plainly that it does not move the decision gates
 *      — the model must not treat a look-through flag as a sizing cap.
 *   4. The tag is still suppressed (null) on a portfolio-blind snapshot.
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
      lookThrough: null,
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
  });

  it("omits the look-through line when nothing was attributed through a fund (null)", () => {
    const out = formatPortfolioContext(snapshot(), [], "NVDA");
    expect(out).not.toContain("ETF look-through");
  });

  it("renders the look-through line, framed as a lower bound that does not move the decision gates, when present (FIX-801)", () => {
    const out = formatPortfolioContext(
      snapshot({
        health: {
          ...snapshot().health!,
          lookThrough: {
            coveragePct: 99.0,
            sectorCoveragePct: 96.5,
            maxPosition: { ticker: "AAPL", weightPct: 16.9 },
            flags: ["AAPL 16.9% (alert, look-through)"],
            opaqueFundCount: 1,
            opaqueUnavailableFundCount: 0,
          },
        },
      }),
      [],
      "NVDA",
    );
    expect(out).toContain("ETF look-through");
    expect(out).toContain("LOWER BOUND");
    expect(out).toContain("does not move sizing gates");
    expect(out).toContain("name coverage 99.0%, sector coverage 96.5%");
    expect(out).toContain("largest effective name AAPL 16.9%");
    expect(out).toContain("1 fund(s) opaque (thin/ineligible data)");
    expect(out).toContain("Look-through concentration flags: AAPL 16.9% (alert, look-through).");
  });

  it("reports an unavailable (not-yet-fetched / quota-limited) opaque fund separately from a data-quality one (Codex review, FIX-801 sub-PR c)", () => {
    const out = formatPortfolioContext(
      snapshot({
        health: {
          ...snapshot().health!,
          lookThrough: {
            coveragePct: 99.0,
            sectorCoveragePct: 96.5,
            maxPosition: { ticker: "AAPL", weightPct: 16.9 },
            flags: [],
            opaqueFundCount: 2,
            opaqueUnavailableFundCount: 1,
          },
        },
      }),
      [],
      "NVDA",
    );
    expect(out).toContain("1 fund(s) opaque (thin/ineligible data)");
    expect(out).toContain("1 fund(s) not yet available (unfetched or temporarily rate/quota-limited)");
  });

  it("omits the opaque-fund clause and the flags line when there's nothing to report", () => {
    const out = formatPortfolioContext(
      snapshot({
        health: {
          ...snapshot().health!,
          lookThrough: {
            coveragePct: 99.0,
            sectorCoveragePct: 96.5,
            maxPosition: { ticker: "AAPL", weightPct: 16.9 },
            flags: [],
            opaqueFundCount: 0,
            opaqueUnavailableFundCount: 0,
          },
        },
      }),
      [],
      "NVDA",
    );
    expect(out).not.toContain("fund(s) opaque");
    expect(out).not.toContain("fund(s) not yet available");
    expect(out).not.toContain("Look-through concentration flags");
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
