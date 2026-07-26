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
            sectorExposure: [
              { bucket: "Technology", pct: 55.2 },
              { bucket: "Financial Services", pct: 30.1 },
            ],
            positions: [
              {
                ticker: "AAPL",
                weightPct: 16.9,
                sources: [
                  { from: "direct", marketValue: 10_000 },
                  { from: "SPY", marketValue: 4_200 },
                ],
              },
              { ticker: "MSFT", weightPct: 8.4, sources: [{ from: "direct", marketValue: 8_400 }] },
            ],
            maxPosition: { ticker: "AAPL", weightPct: 16.9 },
            effectivePositions: { low: 5.2, high: 8.4 },
            flags: ["AAPL 16.9% (alert, look-through)"],
            opaqueFundCount: 1,
            opaqueUnavailableFundCount: 0,
            opaqueFundDetails: [
              { ticker: "QQQ", axis: "both", reason: "thin coverage", unavailable: false },
            ],
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
    // The uncertainty-aware [low, high] interval — was computed by the leaf
    // but never rendered here until now (Codex review, FIX-801 sub-PR c).
    expect(out).toContain("effective positions 5.2–8.4 (interval — residual placement is uncertain)");
    expect(out).toContain("1 fund(s) opaque (thin/ineligible data)");
    expect(out).toContain("Look-through concentration flags: AAPL 16.9% (alert, look-through).");
    // The actual attributed sector distribution, not just its coverage number
    // (Codex review, FIX-801 sub-PR c round 28).
    expect(out).toContain("Look-through sector exposure: Technology 55.2%, Financial Services 30.1%.");
    // The top effective-name positions WITH source identity — traceable to
    // which wrapper each slice came through, not just a bare max position
    // (Codex review, FIX-801 sub-PR c round 32).
    expect(out).toContain(
      "Look-through top positions by weight: AAPL 16.9% (direct + SPY), MSFT 8.4% (direct).",
    );
    // The per-fund identity behind the count above — traceable to the actual
    // holding, not just a bare number (Codex review, FIX-801 sub-PR c round 25).
    expect(out).toContain("Opaque fund detail: QQQ (both: thin coverage).");
  });

  it("renders '—' for the effective-positions interval when null (no attribution to bound)", () => {
    const out = formatPortfolioContext(
      snapshot({
        health: {
          ...snapshot().health!,
          lookThrough: {
            coveragePct: 99.0,
            sectorCoveragePct: 96.5,
            sectorExposure: [],
            positions: [],
            maxPosition: { ticker: "AAPL", weightPct: 16.9 },
            effectivePositions: null,
            flags: [],
            opaqueFundCount: 0,
            opaqueUnavailableFundCount: 0,
            opaqueFundDetails: [],
          },
        },
      }),
      [],
      "NVDA",
    );
    expect(out).toContain("effective positions — (interval — residual placement is uncertain)");
  });

  it("reports an unavailable (not-yet-fetched / quota-limited) opaque fund separately from a data-quality one (Codex review, FIX-801 sub-PR c)", () => {
    const out = formatPortfolioContext(
      snapshot({
        health: {
          ...snapshot().health!,
          lookThrough: {
            coveragePct: 99.0,
            sectorCoveragePct: 96.5,
            sectorExposure: [],
            positions: [],
            maxPosition: { ticker: "AAPL", weightPct: 16.9 },
            effectivePositions: { low: 3.1, high: 6.0 },
            flags: [],
            opaqueFundCount: 2,
            opaqueUnavailableFundCount: 1,
            opaqueFundDetails: [
              { ticker: "QQQ", axis: "both", reason: "no stored profile", unavailable: true },
              { ticker: "IVV", axis: "both", reason: "holdings data incomplete", unavailable: false },
            ],
          },
        },
      }),
      [],
      "NVDA",
    );
    expect(out).toContain("1 fund(s) opaque (thin/ineligible data)");
    expect(out).toContain("1 fund(s) not yet available (unfetched or temporarily rate/quota-limited)");
    // The per-fund breakdown names each ticker, marking the temporarily
    // unavailable one distinctly from the data-quality one (Codex review,
    // FIX-801 sub-PR c round 25).
    expect(out).toContain(
      "Opaque fund detail: QQQ (both: no stored profile, not yet available); IVV (both: holdings data incomplete).",
    );
  });

  it("omits the opaque-fund clause and the flags line when there's nothing to report", () => {
    const out = formatPortfolioContext(
      snapshot({
        health: {
          ...snapshot().health!,
          lookThrough: {
            coveragePct: 99.0,
            sectorCoveragePct: 96.5,
            sectorExposure: [],
            positions: [],
            maxPosition: { ticker: "AAPL", weightPct: 16.9 },
            effectivePositions: { low: 4.0, high: 4.0 },
            flags: [],
            opaqueFundCount: 0,
            opaqueUnavailableFundCount: 0,
            opaqueFundDetails: [],
          },
        },
      }),
      [],
      "NVDA",
    );
    expect(out).not.toContain("fund(s) opaque");
    expect(out).not.toContain("fund(s) not yet available");
    expect(out).not.toContain("Look-through concentration flags");
    expect(out).not.toContain("Look-through sector exposure");
    expect(out).not.toContain("Look-through top positions");
    expect(out).not.toContain("Opaque fund detail");
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
