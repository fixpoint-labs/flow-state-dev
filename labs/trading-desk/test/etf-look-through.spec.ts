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
          sectors: [
            { sector: "Technology", weight: 0.3 },
            { sector: "Financial Services", weight: 0.13 },
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
