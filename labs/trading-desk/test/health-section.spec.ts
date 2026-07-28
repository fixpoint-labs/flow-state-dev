/**
 * Unit tests for the pure helpers behind `HealthSection` (FIX-954 Phase 1).
 *
 * The test env is node + `.spec.ts` (no JSX rendering), so — matching the
 * `buildHoldingRowModel` / `buildLensCardModel` precedent — the load-bearing
 * derivation logic is extracted into pure, exported helpers and tested
 * directly, importing them straight from the component file. JSX wiring
 * itself is verified via a browser check (see FIX-954 report), not here.
 */
import { describe, expect, it } from "vitest";
import {
  buildLookThroughHoldingsRowModel,
  buildTopPositionsRowModel,
  formatSourcesLabel,
  groupOpaqueFunds,
  shouldRenderLookThroughSectors,
} from "../components/portfolio/health-section";
import type { HealthPosition } from "../domain/portfolio/math/portfolio-health";
import type { EffectiveNamePosition, LookThroughResidual, OpaqueFund } from "../domain/portfolio/math/etf-look-through";
import {
  CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON,
  MUTUAL_FUND_ATTRIBUTION_SUPPRESSED_REASON,
} from "../domain/portfolio/math/etf-look-through";

function namePosition(
  ticker: string,
  marketValue: number,
  weightPct: number,
  sources: EffectiveNamePosition["sources"] = [{ from: "direct", marketValue }],
): EffectiveNamePosition {
  return { ticker, marketValue, weightPct, sources };
}

describe("formatSourcesLabel", () => {
  it("names a direct holding plus up to two fund sources by ticker", () => {
    const sources: EffectiveNamePosition["sources"] = [
      { from: "direct", marketValue: 46_500 },
      { from: "VTI", marketValue: 55_500 },
      { from: "QQQ", marketValue: 9_000 },
    ];
    expect(formatSourcesLabel(sources)).toBe("Direct + VTI, QQQ");
  });

  it("collapses to a count once a direct holding has more than two fund sources", () => {
    const sources: EffectiveNamePosition["sources"] = [
      { from: "direct", marketValue: 1 },
      { from: "VTI", marketValue: 1 },
      { from: "SPY", marketValue: 1 },
      { from: "QQQ", marketValue: 1 },
      { from: "IVV", marketValue: 1 },
    ];
    expect(formatSourcesLabel(sources)).toBe("Direct + 4");
  });

  it("lists every fund by ticker when there is no direct holding", () => {
    const sources: EffectiveNamePosition["sources"] = [
      { from: "VTI", marketValue: 1 },
      { from: "SPY", marketValue: 1 },
      { from: "QQQ", marketValue: 1 },
    ];
    expect(formatSourcesLabel(sources)).toBe("VTI, SPY, QQQ");
  });
});

describe("buildLookThroughHoldingsRowModel", () => {
  it("closes the footer to the full attributed + residual mass instead of silently dropping rows past the top 10 (FIX-954 §0.1 — the reported 'the percentages don't add up' defect)", () => {
    // 12 effective positions, each 5% — the old `positions.slice(0, 10)` in
    // `LookThroughPositions` silently dropped the last two (10%), so the
    // rendered column stopped at 90% with no accounting for the gap. The
    // fixed footer must recover exactly that dropped 10%, plus the residual.
    const positions: EffectiveNamePosition[] = Array.from({ length: 12 }, (_, i) =>
      namePosition(`T${i}`, 5_000, 5),
    );
    const residual: LookThroughResidual = { marketValue: 40_000, sharePct: 40, cause: "uncovered" };

    const model = buildLookThroughHoldingsRowModel(positions, residual);

    expect(model.shown).toHaveLength(10);
    expect(model.tail.count).toBe(2);
    expect(model.tail.weightPct).toBeCloseTo(10); // the previously-silent gap
    expect(model.tail.marketValue).toBeCloseTo(10_000);
    // Nothing is dropped: shown + tail + residual accounts for every input.
    const inputTotalWeightPct = positions.reduce((s, p) => s + p.weightPct, 0) + residual.sharePct;
    const inputTotalMarketValue = positions.reduce((s, p) => s + p.marketValue, 0) + residual.marketValue;
    expect(model.total.weightPct).toBeCloseTo(inputTotalWeightPct);
    expect(model.total.marketValue).toBeCloseTo(inputTotalMarketValue);
  });
});

function healthPosition(
  ticker: string,
  marketValue: number | null,
  exposureWeightPct: number | null,
): HealthPosition {
  return {
    ticker,
    assetClass: "equity",
    assetType: "equity",
    quantity: 1,
    marketValue,
    allocationWeightPct: exposureWeightPct,
    exposureWeightPct,
    sector: null,
    accounts: [],
    excludedRows: 0,
  };
}

describe("buildTopPositionsRowModel", () => {
  it("rolls the priced positions past the top 10 into a tail instead of dropping them (the identical `.slice(0, 10)` defect TopPositions shares with the look-through table)", () => {
    const positions: HealthPosition[] = [
      ...Array.from({ length: 12 }, (_, i) => healthPosition(`T${i}`, 10_000, 8)),
      healthPosition("UNPRICED", null, null), // unpriced rows never count toward the tail
    ];

    const model = buildTopPositionsRowModel(positions);

    expect(model.shown).toHaveLength(10);
    expect(model.tail.count).toBe(2);
    expect(model.tail.weightPct).toBeCloseTo(16);
    expect(model.tail.marketValue).toBeCloseTo(20_000);
    // The statement-basis read: every PRICED position's weight is still
    // accounted for in the total, not just the shown top 10.
    expect(model.total.weightPct).toBeCloseTo(12 * 8);
    expect(model.total.marketValue).toBeCloseTo(12 * 10_000);
  });
});

describe("shouldRenderLookThroughSectors", () => {
  it("renders the sector block when sectorExposure is empty but 100% of the mass sits in the residual (FIX-954 §7 step 3 — the per-axis coverage gate this guard used to hide)", () => {
    // A book where every fund passes the NAME axis and fails SECTORS: the
    // old guard (`exposure.sectorExposure.length > 0`) hid the block exactly
    // when the residual is the whole story.
    expect(
      shouldRenderLookThroughSectors({
        sectorExposure: [],
        sectorResidual: { marketValue: 100_000, sharePct: 100, cause: "opaque" },
      }),
    ).toBe(true);
  });

  it("stays hidden when there is neither attributed sector mass nor a residual (no funds held at all)", () => {
    expect(
      shouldRenderLookThroughSectors({
        sectorExposure: [],
        sectorResidual: { marketValue: 0, sharePct: 0, cause: "opaque" },
      }),
    ).toBe(false);
  });
});

function opaqueFund(ticker: string, axis: OpaqueFund["axis"], reason: string): OpaqueFund {
  return { ticker, axis, reason };
}

describe("groupOpaqueFunds", () => {
  it("groups a policy exclusion and a data-quality finding together as 'not attributable', separately from a temporary 'awaiting data' gap (FIX-954 §0.5 — the classifier's three-value split collapsed to the two rendered groups)", () => {
    const funds: OpaqueFund[] = [
      opaqueFund("TQQQ", "both", "leveraged/inverse fund"), // policy
      opaqueFund("BNDX", "both", MUTUAL_FUND_ATTRIBUTION_SUPPRESSED_REASON), // policy
      opaqueFund("VXUS", "both", "malformed"), // data
      opaqueFund("IEFA", "both", "no stored profile"), // awaiting
      opaqueFund("IEMG", "both", CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON), // awaiting
    ];

    const groups = groupOpaqueFunds(funds);

    expect(groups.notAttributable.map((f) => f.ticker).sort()).toEqual(["BNDX", "TQQQ", "VXUS"]);
    expect(groups.awaitingData.map((f) => f.ticker).sort()).toEqual(["IEFA", "IEMG"]);
    // Every input fund lands in exactly one group — none silently dropped.
    expect(groups.notAttributable.length + groups.awaitingData.length).toBe(funds.length);
  });
});
