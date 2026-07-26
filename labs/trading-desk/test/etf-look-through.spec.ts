/**
 * Tests for the pure ETF look-through leaf (FIX-801 §8 step 4).
 *
 * Intent encoded — these pin the honesty arithmetic the whole feature exists
 * to get right:
 *   1. The §1 worked example (goal check): a direct name held ALSO through a
 *      fund reports MORE exposure than the direct holding alone, with a
 *      coverage figure below 100% and a residual that closes the total.
 *   2. Decision 3: uncovered weight is an explicit residual, never
 *      renormalized — the residual mass + attributed mass always sums to the
 *      fund's own market value (for a names-passing fund).
 *   3. Decision 4: the coverage floor gates PER AXIS independently, the
 *      asymmetric pass/fail case is honoured, and the effective-position
 *      count is the corrected overlap-aware INTERVAL (the §1 worked numeric
 *      example: 3.57, not the old wrong r² bound).
 *   4. Decision 7: the fund-of-funds oracle — a component ETF is never
 *      reported as a single name, whether it sinks the whole fund
 *      (material share) or is individually routed away (a small slice).
 *   5. Decision 8: look-through flags fire at the SAME thresholds as the
 *      wrapper basis, scoped to equity/crypto-eligible names only.
 *   6. §9 edges: a short position anywhere refuses the whole axis; a
 *      non-attributable ("n/a") constituent line still counts against
 *      coverage; an unpriced/cash position never enters the axis.
 */
import { describe, expect, it } from "vitest";
import {
  computeLookThroughExposure,
  CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON,
  FUND_OF_FUNDS_THRESHOLD_PCT,
  LOOK_THROUGH_COVERAGE_FLOOR_PCT,
  type FundProfileInput,
  type LookThroughPositionInput,
  type NormalizedFundProfile,
} from "@/domain/portfolio/math/etf-look-through";
import {
  SECTOR_WARN_PCT,
  SINGLE_NAME_ALERT_PCT,
  SINGLE_NAME_WARN_PCT,
  UNCLASSIFIED_BUCKET,
} from "@/domain/portfolio/math/concentration-thresholds";

function direct(
  ticker: string,
  marketValue: number | null,
  overrides: Partial<LookThroughPositionInput> = {},
): LookThroughPositionInput {
  return {
    ticker,
    assetType: "equity",
    assetClass: "equity",
    marketValue,
    sectorBucket: "Technology",
    ...overrides,
  };
}

function fund(
  ticker: string,
  marketValue: number | null,
  overrides: Partial<LookThroughPositionInput> = {},
): LookThroughPositionInput {
  return {
    ticker,
    assetType: "etf",
    assetClass: "equity",
    marketValue,
    sectorBucket: "Funds (no look-through)",
    ...overrides,
  };
}

function profile(overrides: Partial<NormalizedFundProfile> = {}): FundProfileInput {
  return {
    payload: {
      leveraged: false,
      constituents: [],
      nameCoverage: 1,
      sectors: [],
      sectorCoverage: 1,
      ...overrides,
    },
    refusalReason: null,
  };
}

function refusal(reason: string): FundProfileInput {
  return { payload: null, refusalReason: reason };
}

describe("computeLookThroughExposure — goal check (§1 worked example)", () => {
  it("reports MORE exposure to a name held both directly and through a fund, with coverage < 100% and a residual that closes the total", () => {
    const positions = [direct("AAPL", 10_000), fund("SPY", 60_000)];
    const investedNav = 70_000;
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "SPY",
        profile({
          nameCoverage: 0.995,
          constituents: [
            { ticker: "AAPL", weight: 0.07 },
            { ticker: "MSFT", weight: 0.925 },
          ],
        }),
      ],
    ]);

    const out = computeLookThroughExposure(positions, investedNav, fundProfiles)!;
    expect(out).not.toBeNull();

    const aapl = out.positions.find((p) => p.ticker === "AAPL")!;
    const directWeight = (10_000 / investedNav) * 100;
    expect(aapl.weightPct).toBeGreaterThan(directWeight);
    expect(aapl.marketValue).toBeCloseTo(10_000 + 0.07 * 60_000); // 14,200
    expect(aapl.sources).toEqual(
      expect.arrayContaining([
        { from: "direct", marketValue: 10_000 },
        { from: "SPY", marketValue: 4_200 },
      ]),
    );

    expect(out.coveragePct).toBeLessThan(100);
    expect(out.coveragePct).toBeGreaterThan(99); // only the unreported 0.5% residual

    // The residual CLOSES the total — never renormalized (Decision 3): every
    // dollar of investedNav is accounted for, either as an effective
    // position or as the explicit residual.
    const totalPositions = out.positions.reduce((s, p) => s + p.marketValue, 0);
    expect(totalPositions + out.residual.marketValue).toBeCloseTo(investedNav);
  });

  it("reproduces today's wrapper-basis-equivalent output when there are no funds at all (BP-030 guarantee)", () => {
    const positions = [direct("AAPL", 10_000), direct("MSFT", 5_000)];
    const out = computeLookThroughExposure(positions, 15_000, new Map())!;
    expect(out.coveragePct).toBeCloseTo(100);
    expect(out.sectorCoveragePct).toBeCloseTo(100);
    expect(out.residual.marketValue).toBeCloseTo(0);
    expect(out.positions.map((p) => p.ticker).sort()).toEqual(["AAPL", "MSFT"]);
    expect(out.opaqueFunds).toEqual([]);
  });
});

describe("computeLookThroughExposure — Decision 4: per-axis coverage gate", () => {
  it("gates a thin (below-floor) fund's NAME axis out — whole mass to residual, named opaque", () => {
    // The measured international-fund failure mode: 15 of 137 holdings, 26%
    // coverage (FIX-801 §1/§9).
    const positions = [fund("INTL", 50_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "INTL",
        profile({
          nameCoverage: 0.26,
          constituents: [{ ticker: "NESN", weight: 0.1 }],
          sectorCoverage: 0.26,
          sectors: [{ sector: "Consumer Defensive", weight: 0.26 }],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 50_000, fundProfiles)!;
    expect(out.positions).toEqual([]); // NOT half-attributed
    expect(out.residual.marketValue).toBeCloseTo(50_000);
    // Both axes independently fail their own floor — reported as two
    // distinct entries (each with its own reason text), not collapsed to one
    // (Decision 4: per-axis, not a single verdict).
    expect(out.opaqueFunds).toContainEqual(
      expect.objectContaining({ ticker: "INTL", axis: "names" }),
    );
    expect(out.opaqueFunds).toContainEqual(
      expect.objectContaining({ ticker: "INTL", axis: "sectors" }),
    );
  });

  it("the asymmetric case: a fund can pass NAMES and fail SECTORS, or the reverse (never both-or-nothing)", () => {
    const positions = [fund("MIXED", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "MIXED",
        profile({
          nameCoverage: 0.9, // passes (≥ 85%)
          constituents: [{ ticker: "AAPL", weight: 0.9 }],
          sectorCoverage: 0.25, // fails (< 85%)
          sectors: [{ sector: "Technology", weight: 0.25 }],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    // Attributed on the NAME axis...
    expect(out.positions.find((p) => p.ticker === "AAPL")?.marketValue).toBeCloseTo(90_000);
    // ...but opaque on the SECTOR axis only.
    expect(out.opaqueFunds).toEqual([
      expect.objectContaining({ ticker: "MIXED", axis: "sectors" }),
    ]);
    expect(out.sectorExposure).toEqual([]);
    expect(out.sectorResidual.marketValue).toBeCloseTo(100_000);
  });

  it("does not gate right at the floor (>= is a pass, not just >)", () => {
    const positions = [fund("EDGE", 10_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "EDGE",
        profile({
          nameCoverage: LOOK_THROUGH_COVERAGE_FLOOR_PCT / 100,
          constituents: [{ ticker: "XYZ", weight: LOOK_THROUGH_COVERAGE_FLOOR_PCT / 100 }],
          // Sector axis also needs to genuinely pass (both the floor AND
          // reconciliation) for `opaqueFunds` to be empty — the bare
          // `profile()` default (100% coverage, zero rows) no longer
          // reconciles under the coverage-vs-rows check below.
          sectorCoverage: LOOK_THROUGH_COVERAGE_FLOOR_PCT / 100,
          sectors: [{ sector: "Technology", weight: LOOK_THROUGH_COVERAGE_FLOOR_PCT / 100 }],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 10_000, fundProfiles)!;
    expect(out.opaqueFunds).toEqual([]);
    expect(out.positions.find((p) => p.ticker === "XYZ")).toBeDefined();
  });

  it("hasAttribution stays FALSE when the coverage floor clears but every constituent is non-attributable or itself a fund (Codex review round 3)", () => {
    // ALLBOND's only constituent is BND — a known bond ETF (layer 2), so it
    // resolves as a FUND, not a name, and its whole weight routes to
    // residual. nameCoverage still clears the 85% floor (it's a coverage
    // NUMBER, not an attribution count), so before the fix `hasAttribution`
    // was wrongly set true even though nothing was actually attributed. The
    // sector axis also fails here, so the correct overall read is "nothing
    // was attributed" — hasAttribution must be false, not just the per-axis
    // opaqueness.
    const positions = [fund("ALLBOND", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "ALLBOND",
        profile({
          nameCoverage: 1,
          constituents: [{ ticker: "BND", weight: 1 }],
          sectorCoverage: 0.2, // fails the floor
          sectors: [{ sector: "Fixed income", weight: 0.2 }],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.positions).toEqual([]); // BND's slice went to residual, not attributed
    expect(out.residual.marketValue).toBeCloseTo(100_000);
    expect(out.hasAttribution).toBe(false);
  });

  it("a ZERO-weight attributable constituent doesn't create a phantom position or flip hasAttribution (Codex review round 6)", () => {
    // THIN's coverage clears via a null-ticker row (100% non-attributable),
    // plus one otherwise-attributable constituent whose weight happens to be
    // 0. Before this fix, that zero-weight row still went through
    // `pushSource` (a phantom $0 position that could surface as
    // `maxPosition`) and unconditionally flipped `hasAttribution` — even
    // though 100% of the fund's mass is genuinely residual. The sector axis
    // also fails here, so the correct overall read is "nothing was
    // attributed".
    const positions = [fund("THIN", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "THIN",
        profile({
          nameCoverage: 1,
          constituents: [
            { ticker: null, weight: 1 },
            { ticker: "ZEROCO", weight: 0 },
          ],
          sectorCoverage: 0.2, // fails the floor
          sectors: [],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.positions).toEqual([]); // no phantom $0 ZEROCO position
    expect(out.residual.marketValue).toBeCloseTo(100_000);
    expect(out.hasAttribution).toBe(false);
  });

  it("a non-finite (Infinity/NaN) constituent weight is treated as zero, never leaked into the name axis's accumulated mass (Codex review round 7)", () => {
    // Mirrors the round-6 zero-weight fixture — the null-ticker row alone
    // accounts for the full $100k, so these rows' weight VALUES don't change
    // the correct result, only whether they're handled safely. Before this
    // fix, `slice = c.weight * mv` was computed straight off the stored
    // profile's weight with no validation: Infinity would flow through
    // `slice > 0` (true) into `pushSource`, producing a phantom position
    // with an Infinite marketValue and wrongly flipping `hasAttribution`;
    // NaN would NaN-poison whichever accumulator it touched. `safeWeight`
    // now clamps any non-finite (or out-of-[0,1]-range) weight to 0 before
    // it enters ANY accumulation.
    const positions = [fund("THIN", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "THIN",
        profile({
          nameCoverage: 1,
          constituents: [
            { ticker: null, weight: 1 },
            { ticker: "INFCO", weight: Number.POSITIVE_INFINITY },
            { ticker: "NANCO", weight: Number.NaN },
          ],
          sectorCoverage: 0.2, // fails — keep this test focused on names
          sectors: [],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.positions).toEqual([]); // no phantom Infinity/NaN position
    expect(out.residual.marketValue).toBeCloseTo(100_000);
    expect(Number.isFinite(out.residual.marketValue)).toBe(true);
    expect(out.hasAttribution).toBe(false);
  });

  it("a non-finite sector weight never produces an Infinite/NaN sectorExposure entry (Codex review round 7)", () => {
    // The sector axis's `add(sectorMass, s.sector, slice)` was previously
    // UNCONDITIONAL — unlike the name axis's pushSource, nothing gated it
    // even after the round-6 zero-weight fix, so an Infinity/NaN sector
    // weight flowed straight into the accumulated sectorMass.
    //
    // A second, valid "Technology" row is included alongside the corrupted
    // "Bogus" row so `sectorCoverage` (0.9) reconciles against the actual
    // safe-weighted row sum (0.9 + 0 = 0.9) — see the coverage-reconciliation
    // check added below; a coverage figure that doesn't match its own rows'
    // sum is now rejected as malformed rather than passed through, which
    // would otherwise short-circuit this test before it reaches the
    // Infinity-row leak this test exists to catch.
    const positions = [fund("BADSECTOR", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "BADSECTOR",
        profile({
          nameCoverage: 0.2, // fails — keep this test focused on sectors
          constituents: [],
          sectorCoverage: 0.9,
          sectors: [
            { sector: "Technology", weight: 0.9 },
            { sector: "Bogus", weight: Number.POSITIVE_INFINITY },
          ],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    const bogus = out.sectorExposure.find((s) => s.bucket === "Bogus");
    expect(bogus?.marketValue).toBeCloseTo(0);
    expect(bogus?.pct).not.toBeNull();
    expect(Number.isFinite(bogus?.pct as number)).toBe(true);
    const tech = out.sectorExposure.find((s) => s.bucket === "Technology");
    expect(tech?.marketValue).toBeCloseTo(90_000);
    expect(out.hasAttribution).toBe(true);
  });

  it("a non-finite nameCoverage/sectorCoverage never poisons the residual mass and reads as opaque, not a passing profile (Codex review round 7)", () => {
    // nameCoverage/sectorCoverage are themselves stored profile fields with
    // the same [0,1]-fraction contract as a row weight. An Infinity coverage
    // would have PASSED the `* 100 >= floor` gate (Infinity >= 85 is true)
    // and then poisoned `nameResidualMass`/`sectorResidualMass` via
    // `(1 - Infinity) * mv` (`-Infinity`) — the opposite failure mode from a
    // corrupted row weight (which silently loses mass), but the same
    // "never leak non-finite output" contract violation.
    const positions = [fund("CORRUPTCOVERAGE", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "CORRUPTCOVERAGE",
        profile({
          nameCoverage: Number.POSITIVE_INFINITY,
          constituents: [],
          sectorCoverage: Number.POSITIVE_INFINITY,
          sectors: [],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    // An invalid coverage reads as opaque (0%, below the floor) — never a
    // passing/complete profile — so the whole $100k routes to residual.
    expect(out.positions).toEqual([]);
    expect(out.residual.marketValue).toBeCloseTo(100_000);
    expect(Number.isFinite(out.residual.marketValue)).toBe(true);
    expect(out.sectorResidual.marketValue).toBeCloseTo(100_000);
    expect(Number.isFinite(out.sectorResidual.marketValue)).toBe(true);
    expect(out.opaqueFunds).toContainEqual(
      expect.objectContaining({ ticker: "CORRUPTCOVERAGE", axis: "names" }),
    );
    expect(out.opaqueFunds).toContainEqual(
      expect.objectContaining({ ticker: "CORRUPTCOVERAGE", axis: "sectors" }),
    );
    expect(out.hasAttribution).toBe(false);
  });

  it("a name axis whose declared coverage doesn't match its rows' summed weight is rejected as malformed, not decomposed into a false concentration (Codex review, coverage reconciliation)", () => {
    // A duplicated constituent row — two 0.9-weight lines for the same
    // ticker — sums to 1.8 while `nameCoverage` still says ~0.9. Before this
    // fix the coverage floor check alone would have passed (0.9 >= 85%
    // reads as 90%, well over the floor) and the loop below would have
    // pushed AAPL via TWO `pushSource` calls, producing an ~180%-of-fund
    // AAPL position — exactly the false single-name concentration alert
    // this reconciliation exists to prevent. There's no way to tell from
    // this data alone which row (if either) is real, so the whole NAME axis
    // is rejected as malformed instead of guessing.
    const positions = [fund("DUPROWS", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "DUPROWS",
        profile({
          nameCoverage: 0.9,
          constituents: [
            { ticker: "AAPL", weight: 0.9 },
            { ticker: "AAPL", weight: 0.9 },
          ],
          sectorCoverage: 0.2, // fails — keep this test focused on names
          sectors: [],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.positions).toEqual([]); // no false ~180%-of-fund AAPL position
    expect(out.residual.marketValue).toBeCloseTo(100_000);
    expect(out.hasAttribution).toBe(false);
    expect(out.opaqueFunds).toContainEqual(
      expect.objectContaining({ ticker: "DUPROWS", axis: "names" }),
    );
  });

  it("a sector axis whose declared coverage doesn't match its rows' summed weight is rejected as malformed (Codex review, coverage reconciliation)", () => {
    // Same failure mode as the name-axis case above, on the sector axis: a
    // duplicated "Technology" row sums to double the declared coverage.
    const positions = [fund("DUPSECTORS", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "DUPSECTORS",
        profile({
          nameCoverage: 0.2, // fails — keep this test focused on sectors
          constituents: [],
          sectorCoverage: 0.9,
          sectors: [
            { sector: "Technology", weight: 0.9 },
            { sector: "Technology", weight: 0.9 },
          ],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.sectorExposure).toEqual([]); // no false ~180%-weighted Technology bucket
    expect(out.sectorResidual.marketValue).toBeCloseTo(100_000);
    expect(out.hasAttribution).toBe(false);
    expect(out.opaqueFunds).toContainEqual(
      expect.objectContaining({ ticker: "DUPSECTORS", axis: "sectors" }),
    );
  });

  it("the inverse mismatch — declared coverage HIGHER than the rows' actual summed weight — is also rejected as malformed, not silently under-attributed (Codex review, coverage reconciliation)", () => {
    // `nameCoverage` claims 90% but the only row sums to 10% — a missing or
    // truncated row, not a "thin but honest" profile. Trusting the declared
    // figure here would size the residual off a number the rows don't back
    // up; reconciliation catches this direction of the mismatch too.
    const positions = [fund("UNDERSUM", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "UNDERSUM",
        profile({
          nameCoverage: 0.9,
          constituents: [{ ticker: "AAPL", weight: 0.1 }],
          sectorCoverage: 0.2, // fails — keep this test focused on names
          sectors: [],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.positions).toEqual([]);
    expect(out.residual.marketValue).toBeCloseTo(100_000);
    expect(out.hasAttribution).toBe(false);
    expect(out.opaqueFunds).toContainEqual(
      expect.objectContaining({ ticker: "UNDERSUM", axis: "names" }),
    );
  });

  it("a coverage figure within tolerance of the rows' summed weight still passes (floating-point rounding, not a real mismatch), and the residual closes off the ACTUAL row sum, not the declared coverage", () => {
    // `nameCoverage: 0.995` matching a summed weight of 0.995 exactly is
    // already covered elsewhere; this case checks a SMALL, sub-tolerance gap
    // (declared 0.90 vs. summed 0.895) still passes reconciliation instead
    // of being over-strict about ordinary floating-point-ish variance
    // between a provider's rounded coverage figure and its per-row weights.
    //
    // The residual assertion below pins a real closure bug: attribution is
    // sized from the ACTUAL row weight (AAPL's slice = 0.895 × mv), but
    // before this fix the residual was still derived from the DECLARED
    // coverage (`1 - 0.9`), so attribution ($89,500) + residual ($10,000)
    // only summed to $99,500 — silently losing $500 of the fund's $100k from
    // the total. Deriving the residual from the actual row sum instead
    // (`1 - 0.895`) makes it close exactly: $89,500 + $10,500 = $100,000.
    const positions = [fund("ROUNDING", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "ROUNDING",
        profile({
          nameCoverage: 0.9,
          constituents: [{ ticker: "AAPL", weight: 0.895 }],
          sectorCoverage: 0.2, // fails — keep this test focused on names
          sectors: [],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.positions).toEqual([{ ticker: "AAPL", marketValue: 89_500, weightPct: 89.5, sources: [{ from: "ROUNDING", marketValue: 89_500 }] }]);
    expect(out.hasAttribution).toBe(true);
    expect(out.opaqueFunds).not.toContainEqual(
      expect.objectContaining({ ticker: "ROUNDING", axis: "names" }),
    );
    expect(out.residual.marketValue).toBeCloseTo(10_500); // NOT 10,000 (the declared-coverage figure)
    const totalPositions = out.positions.reduce((s, p) => s + p.marketValue, 0);
    expect(totalPositions + out.residual.marketValue).toBeCloseTo(100_000); // always closes
  });

  it("the same within-tolerance closure fix applies to the SECTOR axis", () => {
    // Mirrors the name-axis case above: declared `sectorCoverage: 0.9` vs.
    // rows summing to 0.895 (within tolerance, accepted) — the sector
    // residual must derive from the actual row sum, not the declared figure,
    // or $500 of the fund's $100k silently vanishes from the total.
    const positions = [fund("SECTROUNDING", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "SECTROUNDING",
        profile({
          nameCoverage: 0.2, // fails — keep this test focused on sectors
          constituents: [],
          sectorCoverage: 0.9,
          sectors: [{ sector: "Technology", weight: 0.895 }],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    const tech = out.sectorExposure.find((s) => s.bucket === "Technology");
    expect(tech?.marketValue).toBeCloseTo(89_500);
    expect(out.sectorResidual.marketValue).toBeCloseTo(10_500); // NOT 10,000
    const totalSectors = out.sectorExposure.reduce((s, b) => s + b.marketValue, 0);
    expect(totalSectors + out.sectorResidual.marketValue).toBeCloseTo(100_000); // always closes
  });

  it("an OVER-sum within tolerance scales attribution down AND clamps the NAME residual, so the total closes exactly", () => {
    // Declared `nameCoverage: 1` (100%) vs. two individually-valid rows
    // (0.6 + 0.405 = 1.005, 100.5%) — within the 0.01 tolerance, so
    // accepted, not rejected. The residual clamp alone (a prior round) only
    // prevented a NEGATIVE residual / coveragePct > 100% — it did nothing
    // about the SLICES themselves, which are computed from the raw row
    // weights: unscaled, AAPL ($60,000) + MSFT ($40,500) already total
    // $100,500 of the $100,000 fund, so residual clamping to $0 papered
    // over an already-inflated attribution rather than fixing it (the total
    // was still $100,500, not $100,000). Scaling each slice by
    // `1 / actualNameSum` makes the slices themselves sum to exactly the
    // fund's value, so attribution + residual closes exactly — the same
    // invariant the under-sum fix (prior round) pinned, now proven for the
    // over-sum direction too.
    const positions = [fund("OVERSUM", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "OVERSUM",
        profile({
          nameCoverage: 1,
          constituents: [
            { ticker: "AAPL", weight: 0.6 },
            { ticker: "MSFT", weight: 0.405 },
          ],
          sectorCoverage: 0.2, // fails — keep this test focused on names
          sectors: [],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    // Scaled proportionally: AAPL 0.6 / 1.005 ≈ 0.597015, MSFT likewise.
    const aapl = out.positions.find((p) => p.ticker === "AAPL");
    const msft = out.positions.find((p) => p.ticker === "MSFT");
    expect(aapl?.marketValue).toBeCloseTo((0.6 / 1.005) * 100_000);
    expect(msft?.marketValue).toBeCloseTo((0.405 / 1.005) * 100_000);
    expect(out.residual.marketValue).toBeCloseTo(0);
    expect(out.residual.marketValue).toBeGreaterThanOrEqual(0);
    const totalPositions = out.positions.reduce((s, p) => s + p.marketValue, 0);
    expect(totalPositions + out.residual.marketValue).toBeCloseTo(100_000); // closes EXACTLY, not $100,500
    expect(out.coveragePct).not.toBeNull();
    expect(out.coveragePct as number).toBeLessThanOrEqual(100);
    expect(out.effectivePositions).not.toBeNull();
    expect(out.effectivePositions!.low).toBeLessThanOrEqual(out.effectivePositions!.high);
  });

  it("an OVER-sum within tolerance scales attribution down AND clamps the SECTOR residual, so the total closes exactly", () => {
    // Sector-axis mirror of the name-axis case above.
    const positions = [fund("SECTOVERSUM", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "SECTOVERSUM",
        profile({
          nameCoverage: 0.2, // fails — keep this test focused on sectors
          constituents: [],
          sectorCoverage: 1,
          sectors: [
            { sector: "Technology", weight: 0.6 },
            { sector: "Healthcare", weight: 0.405 },
          ],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    const tech = out.sectorExposure.find((s) => s.bucket === "Technology");
    const health = out.sectorExposure.find((s) => s.bucket === "Healthcare");
    expect(tech?.marketValue).toBeCloseTo((0.6 / 1.005) * 100_000);
    expect(health?.marketValue).toBeCloseTo((0.405 / 1.005) * 100_000);
    expect(out.sectorResidual.marketValue).toBeCloseTo(0);
    expect(out.sectorResidual.marketValue).toBeGreaterThanOrEqual(0);
    const totalSectors = out.sectorExposure.reduce((s, b) => s + b.marketValue, 0);
    expect(totalSectors + out.sectorResidual.marketValue).toBeCloseTo(100_000); // closes EXACTLY
    expect(out.sectorCoveragePct).not.toBeNull();
    expect(out.sectorCoveragePct as number).toBeLessThanOrEqual(100);
  });

  it("the fund-of-funds check fires on sub-floor-but-honest coverage — nameReconciles alone gates it, not the presentation floor too", () => {
    // A fund honestly attributes only 80% of names (below the 85% floor, so
    // `namesPass` is false) but the rows reconcile perfectly (no corruption),
    // and 60% of that 80% resolves to other known funds — well over the
    // fund-of-funds threshold. Before this fix, gating fund-of-funds on
    // `namesPass && nameReconciles` skipped the check entirely (namesPass is
    // false), so this fund's independently-valid 100% sector allocation got
    // attributed on its own — even though the module's own ≥50%-fund-share
    // invariant says the WHOLE wrapper should be opaque. `nameReconciles`
    // alone (the rows are trustworthy) is the correct gate.
    const positions = [fund("SUBFLOORFOF", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "SUBFLOORFOF",
        profile({
          nameCoverage: 0.8, // honest, reconciling, but below the 85% floor
          constituents: [
            { ticker: "BND", weight: 0.6 }, // 60% of the WHOLE fund — crosses the 50% threshold
            { ticker: "AAPL", weight: 0.2 },
          ],
          sectorCoverage: 1,
          sectors: [{ sector: "Technology", weight: 1 }],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.positions).toEqual([]); // not decomposed into AAPL
    expect(out.sectorExposure).toEqual([]); // sector axis correctly wiped too
    expect(out.residual.marketValue).toBeCloseTo(100_000);
    expect(out.sectorResidual.marketValue).toBeCloseTo(100_000);
    expect(out.opaqueFunds).toEqual([
      expect.objectContaining({ ticker: "SUBFLOORFOF", axis: "both", reason: expect.stringContaining("fund-of-funds") }),
    ]);
  });
});

describe("computeLookThroughExposure — name-axis diagnostic completeness (Codex review, FIX-801 sub-PR c round 14, connecting to round 8's per-axis taxonomy work in lib/providers/etf-profile.ts)", () => {
  it("flags a fully-covered-but-nothing-nameable fund (GLD-style) as opaque on the name axis, even though it passes the coverage floor and reconciles", () => {
    // The fetcher's own `hasResolvableConstituent` signal is false when
    // every NAME-axis row is AV's "n/a" sentinel (foreign lines, futures,
    // cash) — real weight, no ticker to attribute to. The MASS accounting
    // was already correct without this fix (every row routes to the name
    // residual via its null ticker below), but `namesPass` and
    // `nameReconciles` are BOTH true (coverage is genuinely high, the rows
    // aren't corrupted), so neither existing branch ever added an
    // `opaqueFunds` entry — this fund was invisible in the diagnostic list
    // despite being 100% opaque on names by mass.
    const positions = [fund("GLD", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "GLD",
        profile({
          nameCoverage: 1,
          constituents: [
            { ticker: null, weight: 0.98 },
            { ticker: null, weight: 0.02 },
          ],
          hasResolvableConstituent: false,
          sectorCoverage: 0,
          sectors: [],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    // Mass accounting was already correct: fully residual, no fabricated name.
    expect(out.positions).toEqual([]);
    expect(out.residual.marketValue).toBeCloseTo(100_000);
    // The new diagnostic: GLD now shows up in opaqueFunds on the name axis.
    expect(out.opaqueFunds).toContainEqual(expect.objectContaining({ ticker: "GLD", axis: "names" }));
  });

  it("does NOT flag a normal fund that has at least one resolvable constituent", () => {
    const positions = [fund("SPY", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "SPY",
        profile({
          nameCoverage: 1,
          constituents: [{ ticker: "AAPL", weight: 1 }],
          hasResolvableConstituent: true,
          sectorCoverage: 1,
          sectors: [{ sector: "Technology", weight: 1 }],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.opaqueFunds.some((f) => f.ticker === "SPY" && f.axis !== "sectors")).toBe(false);
  });

  it("treats a MISSING hasResolvableConstituent (a profile stored before this field existed) as 'unknown, don't flag' rather than newly (and wrongly) opaque — BP-030", () => {
    const positions = [fund("LEGACY", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "LEGACY",
        profile({
          nameCoverage: 1,
          constituents: [{ ticker: null, weight: 1 }],
          // `hasResolvableConstituent` intentionally omitted — simulates a
          // stored row from before this field existed.
          sectorCoverage: 1,
          sectors: [{ sector: "Technology", weight: 1 }],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(
      out.opaqueFunds.some((f) => f.ticker === "LEGACY" && (f.axis === "names" || f.axis === "both")),
    ).toBe(false);
  });
});

describe("computeLookThroughExposure — Decision 4: effective-position interval", () => {
  it("matches the §1 worked overlap example: four 20% names + a 20% residual overlapping the largest gives 3.57 at the low end", () => {
    const positions = [
      direct("A", 20),
      direct("B", 20),
      direct("C", 20),
      direct("D", 20),
      fund("OPAQUE", 20), // wholly opaque — no profile at all
    ];
    const out = computeLookThroughExposure(positions, 100, new Map())!;
    expect(out.residual.sharePct).toBeCloseTo(20);
    expect(out.effectivePositions).not.toBeNull();
    expect(out.effectivePositions!.low).toBeCloseTo(3.571, 2);
    expect(out.effectivePositions!.high).toBeCloseTo(6.25, 2);
    // The width is real — not "a few percent either way".
    expect(out.effectivePositions!.high - out.effectivePositions!.low).toBeGreaterThan(2);
  });

  it("is a point estimate (low === high) at full coverage — the interval narrows as coverage rises", () => {
    const positions = [direct("A", 50), direct("B", 50)];
    const out = computeLookThroughExposure(positions, 100, new Map())!;
    expect(out.effectivePositions!.low).toBeCloseTo(out.effectivePositions!.high, 5);
    expect(out.effectivePositions!.low).toBeCloseTo(2); // 1/(0.5²+0.5²)
  });

  it("is null when there is no attributed mass at all (fully opaque book)", () => {
    const out = computeLookThroughExposure([fund("OPAQUE", 100)], 100, new Map())!;
    expect(out.effectivePositions).toBeNull();
  });
});

describe("computeLookThroughExposure — Decision 7: the fund-of-funds oracle", () => {
  it("regression case: an all-ETF allocation fund never reports a component ETF as a single name, and fires no concentration flag for it", () => {
    // AOA holds VTI + BND. VTI is resolved as a fund via a stored profile
    // (layer 1 — a successful profile proves it's a fund, even though the
    // household doesn't hold VTI itself); BND via the curated bond-ETF list
    // (layer 2).
    const positions = [fund("AOA", 50_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "AOA",
        profile({
          nameCoverage: 1,
          constituents: [
            { ticker: "VTI", weight: 0.6 },
            { ticker: "BND", weight: 0.4 },
          ],
        }),
      ],
      ["VTI", profile({ nameCoverage: 1, constituents: [{ ticker: "AAPL", weight: 1 }] })],
    ]);
    const out = computeLookThroughExposure(positions, 50_000, fundProfiles)!;
    // AOA is ineligible (fund-of-funds) — its whole mass is residual, not
    // decomposed into VTI/BND "name" entries.
    expect(out.opaqueFunds).toContainEqual(
      expect.objectContaining({ ticker: "AOA", axis: "both", reason: expect.stringContaining("fund-of-funds") }),
    );
    expect(out.residual.marketValue).toBeCloseTo(50_000);
    expect(out.positions.find((p) => p.ticker === "VTI")).toBeUndefined();
    expect(out.positions.find((p) => p.ticker === "BND")).toBeUndefined();
    expect(out.flags.some((f) => f.kind === "single_name" && f.ticker === "VTI")).toBe(false);
    expect(out.flags.some((f) => f.kind === "single_name" && f.ticker === "BND")).toBe(false);
  });

  it("individually routes away a SMALL fund-of-funds slice without sinking the whole fund", () => {
    // A mostly-normal fund with a sleeve in another fund, sized to HALF the
    // configured fund-of-funds threshold — well under it by construction, so
    // this stays "well under" (and the fund itself stays eligible/attributed)
    // even if FUND_OF_FUNDS_THRESHOLD_PCT is retuned later, rather than
    // silently drifting out of the intent a fixed 5% would encode.
    const sleeveWeight = FUND_OF_FUNDS_THRESHOLD_PCT / 100 / 2;
    const positions = [fund("DIVERSIFIED", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "DIVERSIFIED",
        profile({
          nameCoverage: 1,
          constituents: [
            { ticker: "AAPL", weight: 1 - sleeveWeight },
            { ticker: "SLEEVE", weight: sleeveWeight },
          ],
          // Sector axis given genuinely reconciling data too, so the
          // "stayed eligible" assertion below (no opaqueFunds entry at all
          // for DIVERSIFIED) isn't accidentally riding on the bare
          // `profile()` default's now-inconsistent 100%-coverage/zero-rows
          // placeholder.
          sectorCoverage: 1,
          sectors: [{ sector: "Technology", weight: 1 }],
        }),
      ],
      ["SLEEVE", profile({ nameCoverage: 1, constituents: [{ ticker: "XYZ", weight: 1 }] })],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.opaqueFunds.some((f) => f.ticker === "DIVERSIFIED")).toBe(false); // stayed eligible
    const aapl = out.positions.find((p) => p.ticker === "AAPL")!;
    expect(aapl.marketValue).toBeCloseTo((1 - sleeveWeight) * 100_000);
    // The SLEEVE slice is routed to residual, not attributed — SLEEVE itself
    // gets no extra weight from DIVERSIFIED's holding of it.
    const sleeve = out.positions.find((p) => p.ticker === "SLEEVE");
    expect(sleeve?.marketValue).toBeUndefined();
    expect(out.residual.marketValue).toBeCloseTo(sleeveWeight * 100_000);
  });

  it("a stored fund profile outweighs a stale/misclassified DIRECT holding classification, for BOTH the constituent-detection oracle and the direct-position routing decision (Codex review rounds 2 and 3)", () => {
    // VTI is held directly, but its imported assetType is still "equity"
    // (misclassified/stale) — a real scenario, not a contrived one. VTI ALSO
    // has a successful stored ETF profile (fetched because AOA's holdings
    // include VTI). Two DISTINCT bugs shared this one evidence-ordering root
    // cause, fixed in two rounds: round 2 fixed how AOA's VTI CONSTITUENT
    // slice gets judged (`resolveTickerIsFund`); round 3 fixed how VTI's own
    // DIRECT position gets routed (the main loop's `isFund` check) — both
    // used to trust the stale "equity" classification over the stronger
    // stored-profile evidence. Round 4 then consolidated the direct-holding
    // check into a call to `resolveTickerIsFund` itself, so this scenario now
    // exercises ONE shared function rather than two independently-maintained
    // ones. With both fixed, VTI is recognized
    // as a fund EVERYWHERE it appears — as AOA's constituent AND as its own
    // direct holding — so it decomposes via its OWN profile into AAPL
    // instead of ever reading as a name itself.
    const positions = [direct("VTI", 40_000, { assetType: "equity" }), fund("AOA", 60_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      ["AOA", profile({ nameCoverage: 1, constituents: [{ ticker: "VTI", weight: 1 }] })],
      // VTI's OWN successful stored profile — positive fund evidence that
      // must outweigh its stale "equity" direct-holding classification,
      // both as a constituent of AOA and as VTI's own direct position.
      ["VTI", profile({ nameCoverage: 1, constituents: [{ ticker: "AAPL", weight: 1 }] })],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    // AOA is entirely VTI (a fund) — 100% fund share, well over the
    // fund-of-funds threshold, so AOA's whole mass is residual, not
    // attributed to VTI as a name.
    expect(out.opaqueFunds).toContainEqual(
      expect.objectContaining({ ticker: "AOA", axis: "both", reason: expect.stringContaining("fund-of-funds") }),
    );
    // VTI itself never appears as a name — its own $40k direct position is
    // decomposed via ITS OWN profile, same as if it had been a fund
    // constituent, not attributed to "VTI" whole.
    expect(out.positions.find((p) => p.ticker === "VTI")).toBeUndefined();
    const aapl = out.positions.find((p) => p.ticker === "AAPL")!;
    expect(aapl.marketValue).toBeCloseTo(40_000);
    expect(aapl.sources).toEqual([{ from: "VTI", marketValue: 40_000 }]);
  });

  it("a direct holding alone (no other fund involved) is decomposed via its OWN stored profile when its classification is stale, instead of being attributed to itself (Codex review round 3)", () => {
    // Isolates the round-3 fix from the AOA fund-of-funds complication above:
    // VTI is the ONLY position, held directly as "equity" (stale), with a
    // successful stored profile. Before the fix, the main loop's `if
    // (!isFundAssetType(pos.assetType))` branch attributed VTI's whole value
    // to itself unconditionally — never checking the stored profile — which
    // could make a misclassified fund become `maxPosition` and fire a false
    // single-name alert once ANOTHER fund's attribution also surfaces (so
    // the overall result isn't nulled).
    const positions = [direct("VTI", 100_000, { assetType: "equity" })];
    const fundProfiles = new Map<string, FundProfileInput>([
      ["VTI", profile({ nameCoverage: 1, constituents: [{ ticker: "AAPL", weight: 1 }] })],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.positions.find((p) => p.ticker === "VTI")).toBeUndefined();
    const aapl = out.positions.find((p) => p.ticker === "AAPL")!;
    expect(aapl.marketValue).toBeCloseTo(100_000);
    expect(aapl.sources).toEqual([{ from: "VTI", marketValue: 100_000 }]);
  });

  it("a fund-proving REFUSAL (not a success) also outweighs a stale direct-holding classification (Codex review round 4)", () => {
    // The round-3 fix only checked for a SUCCESSFUL stored profile
    // (`profile.payload !== null`), missing the fund-proving REFUSAL reasons
    // (`"ineligible"` / `"malformed"`) `resolveTickerIsFund` already
    // recognizes as positive fund evidence for the constituent case. TQQQ is
    // held directly, stale-classified as "equity", with a stored profile
    // that's a REFUSAL (leveraged/inverse — "ineligible"), not a success.
    // Before this fix, the direct-holding branch said "not a fund" and
    // emitted TQQQ's full value as a single name; now it's recognized as a
    // fund (just one with no usable payload) and stays opaque instead.
    const positions = [direct("TQQQ", 100_000, { assetType: "equity" })];
    const fundProfiles = new Map<string, FundProfileInput>([["TQQQ", refusal("ineligible")]]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.positions).toEqual([]); // never attributed as a direct name
    expect(out.residual.marketValue).toBeCloseTo(100_000);
    expect(out.opaqueFunds).toContainEqual(
      expect.objectContaining({ ticker: "TQQQ", axis: "both", reason: "ineligible" }),
    );
    expect(out.flags.some((f) => f.kind === "single_name" && f.ticker === "TQQQ")).toBe(false);
  });

  it("the constituent-evidence-unavailable withdrawal reason also outweighs a stale direct-holding classification (Codex review, FIX-801 sub-PR c round 14 — a real gap in round 13's own fix)", () => {
    // `guards.ts` withdraws a wrapper fund's profile when its fund-of-funds
    // constituent-broadening read fails, by REPLACING the map entry with a
    // refusal carrying this reason — not by deleting the key (round 13
    // originally deleted; round 14 fixed it). AOA is held directly,
    // stale-classified as "equity" (the exact mistyped-equity recovery case
    // `allHeldTickers`'s own docblock describes), with no OTHER fund
    // evidence available: deleting the key would have left NOTHING proving
    // AOA is a fund, so `resolveTickerIsFund` would fall all the way through
    // to AOA's own stale "equity" tag and emit its full value as a
    // fabricated single-name position. The withdrawal reason must be
    // recognized as fund evidence, same as "ineligible"/"malformed", so AOA
    // stays opaque instead.
    const positions = [direct("AOA", 100_000, { assetType: "equity" })];
    const fundProfiles = new Map<string, FundProfileInput>([
      ["AOA", refusal(CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON)],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.positions).toEqual([]); // never attributed as a direct name
    expect(out.residual.marketValue).toBeCloseTo(100_000);
    expect(out.opaqueFunds).toContainEqual(
      expect.objectContaining({ ticker: "AOA", axis: "both", reason: CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON }),
    );
    expect(out.flags.some((f) => f.kind === "single_name" && f.ticker === "AOA")).toBe(false);
  });

  it("the curated bond-ETF list also outweighs a stale direct-holding classification (Codex review round 5)", () => {
    // A 4th instance of the same evidence-ordering gap, this time for the
    // curated bond-ETF list: BND is held directly, stale-classified as
    // "equity", and — because BND is a curated bond ETF — it's pre-filtered
    // from the ETF_PROFILE fill entirely (Decision 5), so it can NEVER reach
    // the stored-profile check (layer 1b). Before this fix, the curated list
    // (layer 2) was only ever consulted for a ticker NOT held directly, so a
    // held-but-misclassified BND fell through to its own stale classification
    // and emitted its full value as a single name. Fixed by checking the
    // curated list BEFORE the held-ticker fallback, same as layer 1b.
    const positions = [direct("BND", 100_000, { assetType: "equity" })];
    const out = computeLookThroughExposure(positions, 100_000, new Map())!;
    expect(out.positions).toEqual([]); // never attributed as a direct name
    expect(out.residual.marketValue).toBeCloseTo(100_000);
    expect(out.opaqueFunds).toContainEqual(
      expect.objectContaining({ ticker: "BND", axis: "both" }),
    );
    expect(out.flags.some((f) => f.kind === "single_name" && f.ticker === "BND")).toBe(false);
    expect(out.maxPosition?.ticker).not.toBe("BND");
  });

  it("a stored `not_an_etf` refusal outweighs a held ticker's own fund-type classification tag — the 5th evidence-ordering case, in the opposite direction (Codex review, coverage reconciliation round)", () => {
    // The prior four evidence-ordering fixes were all about POSITIVE
    // evidence (a stored profile, or the curated bond-ETF list) beating a
    // stale NON-fund classification tag. This is the inverse: NEGATIVE
    // evidence — a stored `not_an_etf` refusal, Alpha Vantage's own
    // determination that the ticker isn't actually an ETP — must beat a
    // stale FUND-type classification tag. Before this fix, layer 1a
    // returned true immediately on `assetType: "etf"` without ever
    // consulting the profile, so a position like this routed to residual as
    // an opaque fund instead of being treated as a direct name with its own
    // effective exposure.
    const positions = [direct("MISTAG", 100_000, { assetType: "etf" })];
    const fundProfiles = new Map<string, FundProfileInput>([["MISTAG", refusal("not_an_etf")]]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.positions).toEqual([
      { ticker: "MISTAG", marketValue: 100_000, weightPct: 100, sources: [{ from: "direct", marketValue: 100_000 }] },
    ]);
    expect(out.residual.marketValue).toBeCloseTo(0);
    expect(out.opaqueFunds).toEqual([]);
  });

  it("a disproven fund's mass falls back to UNCLASSIFIED_BUCKET on the sector axis, not the wrapper's stale fund-labeled bucket (Codex review, disproven-fund propagation round)", () => {
    // MISTAG is tagged `etf`, so the WRAPPER basis's own sector bucketing
    // (which this leaf normally reuses as-is for a direct position — see the
    // LookThroughPositionInput docblock) would have labeled it "Funds (no
    // look-through)" before this leaf ever sees it. But the stored profile
    // disproves it (`not_an_etf`). The fix to `resolveTickerIsFund` alone
    // (the prior round) only corrected the ROUTING decision — this pins that
    // the sector bucket is ALSO corrected: reusing the stale fund-labeled
    // bucket would mislabel the position and could fire a nonsensical
    // sector-concentration warning for a bucket that isn't a real sector.
    const positions = [
      direct("MISTAG", 100_000, { assetType: "etf", sectorBucket: "Funds (no look-through)" }),
    ];
    const fundProfiles = new Map<string, FundProfileInput>([["MISTAG", refusal("not_an_etf")]]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.sectorExposure).toEqual([{ bucket: UNCLASSIFIED_BUCKET, marketValue: 100_000, pct: 100 }]);
    expect(out.flags.some((f) => f.kind === "sector")).toBe(false);
  });

  it("a disproven fund is eligible for its own single-name concentration flag, not suppressed by its stale fund-type tag (Codex review, disproven-fund propagation round)", () => {
    // Same MISTAG setup: the routing fix alone (prior round) correctly
    // attributes it as a direct name, but the concentration-eligibility
    // check independently re-checked the raw `assetType` tag and got it
    // wrong — a 100%-weight effective name was suppressed from ever being
    // flagged, hiding a legitimate concentration signal. This pins that
    // eligibility now follows the same disproven verdict.
    const positions = [direct("MISTAG", 100_000, { assetType: "etf" })];
    const fundProfiles = new Map<string, FundProfileInput>([["MISTAG", refusal("not_an_etf")]]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.maxPosition).toEqual({ ticker: "MISTAG", weightPct: 100 });
    expect(out.flags).toContainEqual(
      expect.objectContaining({ kind: "single_name", level: "alert", ticker: "MISTAG" }),
    );
  });

  it("a fund-of-funds share computed from unreconciled constituent rows must not gate the SECTOR axis too (Codex review, disproven-fund propagation round)", () => {
    // Two duplicated 0.9-weight BND rows (BND is a known bond ETF — curated
    // list, so it resolves as a fund) with `nameCoverage: 0.9` sum to 1.8 —
    // a name-axis reconciliation mismatch that clears the 85% floor on the
    // DECLARED figure alone. Before this fix, the fund-of-funds check ran
    // BEFORE reconciliation, using the UNRECONCILED 180% fundShare (well
    // over the 50% threshold) to mark the WHOLE fund opaque on BOTH axes —
    // wiping out an independently valid, fully-reconciled 100% sector
    // allocation on the same profile. The correct read: the name axis is
    // malformed (not "fund-of-funds" — that verdict can't be trusted from
    // corrupted rows), and the sector axis, built from a wholly separate
    // declared field, stays intact.
    const positions = [fund("DUPBOND", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "DUPBOND",
        profile({
          nameCoverage: 0.9,
          constituents: [
            { ticker: "BND", weight: 0.9 },
            { ticker: "BND", weight: 0.9 },
          ],
          sectorCoverage: 1,
          sectors: [{ sector: "Fixed income", weight: 1 }],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.opaqueFunds).toEqual([expect.objectContaining({ ticker: "DUPBOND", axis: "names" })]);
    expect(out.opaqueFunds.some((f) => f.reason.includes("fund-of-funds"))).toBe(false);
    expect(out.sectorExposure).toEqual([{ bucket: "Fixed income", marketValue: 100_000, pct: 100 }]);
    expect(out.sectorResidual.marketValue).toBeCloseTo(0);
    expect(out.hasAttribution).toBe(true);
  });
});

describe("computeLookThroughExposure — Decision 8: flags at the same thresholds, tagged separately", () => {
  it("fires single-name warn/alert at the SAME thresholds as the wrapper basis, only for equity/crypto-eligible names", () => {
    const positions = [direct("AAPL", SINGLE_NAME_ALERT_PCT + 1), direct("REST", 100 - SINGLE_NAME_ALERT_PCT - 1)];
    const out = computeLookThroughExposure(positions, 100, new Map())!;
    expect(out.flags).toContainEqual(
      expect.objectContaining({ kind: "single_name", level: "alert", ticker: "AAPL" }),
    );
  });

  it("warns at SECTOR_WARN_PCT and never flags a directly-held bond as a single name", () => {
    const positions = [
      direct("AAPL", 40, { sectorBucket: "Technology" }),
      direct("MSFT", 40, { sectorBucket: "Technology" }),
      direct("912810TW8", 20, { assetType: "bond", assetClass: "fixed_income", sectorBucket: "Fixed income" }),
    ];
    const out = computeLookThroughExposure(positions, 100, new Map())!;
    expect(out.flags).toContainEqual(
      expect.objectContaining({ kind: "sector", level: "warn", sector: "Technology", weightPct: 80 }),
    );
    // The bond appears in `positions` (it's unambiguously itself)...
    expect(out.positions.find((p) => p.ticker === "912810TW8")?.marketValue).toBeCloseTo(20);
    // ...but never fires a single-name flag or becomes maxPosition.
    expect(out.flags.some((f) => f.kind === "single_name" && f.ticker === "912810TW8")).toBe(false);
    expect(out.maxPosition?.ticker).not.toBe("912810TW8");
  });

  it("never flags a fund-attributed constituent that resolves to a CUSIP-shaped (bond) ticker, even though it's not held directly (Codex review — defense-in-depth beyond the upstream bond-ETF pre-filter)", () => {
    // Simulates a fixed-income ETF that slipped past the curated
    // KNOWN_BOND_ETFS pre-filter (Decision 5) — its constituents resolve to
    // Treasury/CUSIP-shaped tickers. Unlike the sibling test above, this bond
    // is NEVER held directly, so there's no `positionsByTicker` entry to
    // authoritatively classify it — the leaf must independently check the
    // ticker's own shape rather than assuming every fund-attributed source is
    // a flag-eligible name.
    const positions = [fund("SLIPPED_BOND_FUND", 100)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "SLIPPED_BOND_FUND",
        profile({
          nameCoverage: 1,
          constituents: [{ ticker: "912810TW8", weight: 1 }], // a real CUSIP shape, well past both thresholds
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100, fundProfiles)!;
    // The CUSIP constituent IS attributed on the name axis (it's a real
    // effective position)...
    const bond = out.positions.find((p) => p.ticker === "912810TW8");
    expect(bond?.marketValue).toBeCloseTo(100);
    // ...but never fires a single-name flag or becomes maxPosition, exactly
    // like a DIRECTLY-held bond never does.
    expect(out.flags.some((f) => f.kind === "single_name" && f.ticker === "912810TW8")).toBe(false);
    expect(out.maxPosition?.ticker).not.toBe("912810TW8");
  });

  it("SECTOR_WARN_PCT is exported and matches the wrapper basis's own constant (Decision 8)", () => {
    expect(SECTOR_WARN_PCT).toBe(30);
    expect(SINGLE_NAME_WARN_PCT).toBe(10);
    expect(SINGLE_NAME_ALERT_PCT).toBe(25);
  });
});

describe("computeLookThroughExposure — §9 edge cases", () => {
  it("refuses the WHOLE axis (returns null) when any priced non-cash position is short (negative market value)", () => {
    const positions = [direct("AAPL", 1_000), fund("SHORT_ETF", -500)];
    expect(computeLookThroughExposure(positions, 500, new Map())).toBeNull();
  });

  it("refuses the WHOLE axis (returns null) when any priced non-cash position carries a non-finite market value (Codex review round 5)", () => {
    // Guarded division, never NaN/Infinity output — the leaf's own stated
    // contract. The eligibility guard previously only rejected negative
    // values; an Infinity/NaN market value on a direct equity would otherwise
    // silently produce infinite position/sector weights and a NaN
    // effectivePositions bound.
    const infinitePositions = [direct("AAPL", 1_000), direct("BROKEN", Number.POSITIVE_INFINITY)];
    expect(computeLookThroughExposure(infinitePositions, 500, new Map())).toBeNull();
    const nanPositions = [direct("AAPL", 1_000), direct("BROKEN", Number.NaN)];
    expect(computeLookThroughExposure(nanPositions, 500, new Map())).toBeNull();
  });

  it("returns null for a zero or negative invested NAV", () => {
    expect(computeLookThroughExposure([direct("AAPL", 100)], 0, new Map())).toBeNull();
    expect(computeLookThroughExposure([direct("AAPL", 100)], -100, new Map())).toBeNull();
    expect(computeLookThroughExposure([direct("AAPL", 100)], null, new Map())).toBeNull();
  });

  it("a non-attributable ('n/a') constituent line still counts against coverage rather than being dropped", () => {
    const positions = [fund("FUND", 100_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "FUND",
        profile({
          nameCoverage: 0.9,
          constituents: [
            { ticker: "AAPL", weight: 0.8 },
            { ticker: null, weight: 0.1 }, // "n/a" row — futures/cash/foreign
          ],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    expect(out.positions.find((p) => p.ticker === "AAPL")?.marketValue).toBeCloseTo(80_000);
    // The n/a row's $10,000 is NOT attributed to anyone — it lands in the
    // residual alongside the unreported 10%.
    expect(out.residual.marketValue).toBeCloseTo(20_000);
  });

  it("excludes an unpriced position (marketValue null) and a cash/money-market position entirely", () => {
    const positions = [
      direct("AAPL", 10_000),
      direct("UNPRICED", null),
      direct("SWEEP", 5_000, { assetType: "money_market", assetClass: "cash" }),
    ];
    const out = computeLookThroughExposure(positions, 10_000, new Map())!;
    expect(out.positions.map((p) => p.ticker)).toEqual(["AAPL"]);
  });

  it("a fund with no stored profile row at all (never fetched) is opaque on both axes", () => {
    const out = computeLookThroughExposure([fund("NEW", 10_000)], 10_000, new Map())!;
    expect(out.opaqueFunds).toEqual([
      expect.objectContaining({ ticker: "NEW", axis: "both", reason: "no stored profile" }),
    ]);
  });

  it("a stored REFUSAL row (leveraged, not_an_etf, etc.) sends the whole fund to residual, named opaque with the refusal reason", () => {
    const positions = [fund("TQQQ", 10_000)];
    const fundProfiles = new Map<string, FundProfileInput>([["TQQQ", refusal("leveraged/inverse fund")]]);
    const out = computeLookThroughExposure(positions, 10_000, fundProfiles)!;
    expect(out.residual.marketValue).toBeCloseTo(10_000);
    expect(out.opaqueFunds).toEqual([
      expect.objectContaining({ ticker: "TQQQ", axis: "both", reason: "leveraged/inverse fund" }),
    ]);
  });

  it("a stored SUCCESS payload with leveraged: true is refused, not decomposed as an ordinary long fund (Codex review, coverage reconciliation round)", () => {
    // Distinct from the sibling REFUSAL test above: this fund's fetch
    // resolved a full, well-formed payload (leveraged funds can have
    // legitimate constituent/coverage data) — before this fix, nothing
    // inspected `fp.leveraged`, so it decomposed exactly like an ordinary
    // long fund. A 2x/3x leveraged (or inverse) fund's constituent weights
    // don't represent honest household exposure, so it must be refused
    // (both axes to residual, opaque) regardless of how complete its
    // payload otherwise looks.
    const positions = [fund("SPXL", 10_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "SPXL",
        profile({
          leveraged: true,
          nameCoverage: 1,
          constituents: [{ ticker: "AAPL", weight: 1 }],
          sectorCoverage: 1,
          sectors: [{ sector: "Technology", weight: 1 }],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 10_000, fundProfiles)!;
    expect(out.positions).toEqual([]); // not decomposed into AAPL
    expect(out.sectorExposure).toEqual([]);
    expect(out.residual.marketValue).toBeCloseTo(10_000);
    expect(out.sectorResidual.marketValue).toBeCloseTo(10_000);
    expect(out.opaqueFunds).toEqual([
      expect.objectContaining({ ticker: "SPXL", axis: "both", reason: "leveraged/inverse fund" }),
    ]);
    expect(out.hasAttribution).toBe(false);
  });
});

describe("computeLookThroughExposure — Decision 6: no top-N truncation", () => {
  it("consumes every constituent the profile carries, not just the top few", () => {
    const constituents = Array.from({ length: 500 }, (_, i) => ({
      ticker: `T${i}`,
      weight: 0.002, // 500 * 0.002 = 1.0
    }));
    const positions = [fund("BROAD", 500_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      ["BROAD", profile({ nameCoverage: 1, constituents })],
    ]);
    const out = computeLookThroughExposure(positions, 500_000, fundProfiles)!;
    expect(out.positions).toHaveLength(500); // every one attributed, not just the top 10
    expect(out.positions.find((p) => p.ticker === "T499")).toBeDefined();
    const total = out.positions.reduce((s, p) => s + p.marketValue, 0);
    expect(total).toBeCloseTo(500_000);
  });
});

describe("computeLookThroughExposure — Decision 7: sector axis from the fund's own reported allocation", () => {
  it("attributes fund sector mass by the fund's OWN sector rows, independent of the name axis", () => {
    const positions = [direct("JPM", 20_000, { sectorBucket: "Financial Services" }), fund("SPY", 80_000)];
    const fundProfiles = new Map<string, FundProfileInput>([
      [
        "SPY",
        profile({
          nameCoverage: 1,
          constituents: [{ ticker: "AAPL", weight: 1 }],
          sectorCoverage: 1,
          // A third row brings the declared 100% sectorCoverage back in line
          // with what the rows actually sum to (0.3 + 0.13 + 0.57 = 1) —
          // the fixture previously declared 100% coverage while its two rows
          // summed to only 43%, which the coverage-reconciliation check
          // below now (correctly) rejects as malformed. The extra row
          // doesn't touch the Technology/Financial Services assertions.
          sectors: [
            { sector: "Technology", weight: 0.3 },
            { sector: "Financial Services", weight: 0.13 },
            { sector: "Healthcare", weight: 0.57 },
          ],
        }),
      ],
    ]);
    const out = computeLookThroughExposure(positions, 100_000, fundProfiles)!;
    const financials = out.sectorExposure.find((s) => s.bucket === "Financial Services")!;
    // JPM's direct $20,000 + SPY's 13% financials slice ($10,400).
    expect(financials.marketValue).toBeCloseTo(20_000 + 0.13 * 80_000);
    const tech = out.sectorExposure.find((s) => s.bucket === "Technology")!;
    expect(tech.marketValue).toBeCloseTo(0.3 * 80_000);
  });
});
