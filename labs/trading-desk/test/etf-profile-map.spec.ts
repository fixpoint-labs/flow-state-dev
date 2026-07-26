/**
 * Tests for `domain/portfolio/math/etf-profile-map.ts`'s pure helpers — the
 * shared row→map conversion (`toFundProfileMap`), the broad cache-read ticker
 * set (`allHeldTickers`), the strict fetch-eligibility predicate
 * (`isEtfProfileFetchCandidate`), and the fixed-income attribution suppressor
 * (`excludeFixedIncomeFromProfileMap`, FIX-801 sub-PR c round 7).
 */
import { describe, expect, it } from "vitest";
import {
  allHeldTickers,
  excludeFixedIncomeFromProfileMap,
  isEtfProfileFetchCandidate,
  toFundProfileMap,
} from "../domain/portfolio/math/etf-profile-map";
import type { FundProfileInput } from "../domain/portfolio/math/etf-look-through";
import type { Holding } from "../domain/portfolio/schema/portfolio-schema";

function holding(over: Partial<Holding> = {}): Holding {
  return {
    ticker: "SPY",
    quantity: 1,
    costBasis: null,
    acquiredDate: null,
    assetClass: "equity",
    assetType: "etf",
    attributes: { kind: "none" },
    dataQuality: null,
    ...over,
  };
}

function profile(): FundProfileInput {
  return {
    payload: {
      leveraged: false,
      constituents: [{ ticker: "AAPL", weight: 0.9 }],
      nameCoverage: 0.9,
      sectors: [{ sector: "Technology", weight: 0.9 }],
      sectorCoverage: 0.9,
    },
    refusalReason: null,
  };
}

describe("excludeFixedIncomeFromProfileMap (Codex review, FIX-801 sub-PR c round 7)", () => {
  it("removes a ticker from the map when its CURRENT holding assetClass is fixed_income, even though a normal profile is cached", () => {
    const profiles = new Map<string, FundProfileInput>([["SPY", profile()]]);
    const holdings = [holding({ ticker: "SPY", assetClass: "fixed_income" })];

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings);

    expect(out.has("SPY")).toBe(false);
  });

  it("leaves a non-fixed-income ticker's cached profile untouched", () => {
    const profiles = new Map<string, FundProfileInput>([["SPY", profile()]]);
    const holdings = [holding({ ticker: "SPY", assetClass: "equity" })];

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings);

    expect(out.get("SPY")).toEqual(profile());
  });

  it("excludes a curated bond ETF (BND) even with a manually-overridden STALE assetClass: 'equity' — trusts isKnownBondEtf directly, not just the mutable field (Codex review, FIX-801 sub-PR c round 10)", () => {
    // Same lesson as `isEtfProfileFetchCandidate`'s own bond-ETF check:
    // `assetClass` is user-editable (`setHoldingAssetClass`), so a curated
    // bond ETF whose row was manually reclassified away from `fixed_income`
    // must still be excluded — otherwise a cached profile decomposes a fund
    // the methodology declares opaque.
    const profiles = new Map<string, FundProfileInput>([["BND", profile()]]);
    const holdings = [holding({ ticker: "BND", assetClass: "equity", assetType: "equity" })];

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings);

    expect(out.has("BND")).toBe(false);
  });

  it("does NOT reintroduce the mistyped-equity read bug — a holding still tagged equity locally keeps its stored profile even if it's actually a fund", () => {
    // The exact scenario `allHeldTickers`'s broad read exists to recover: a
    // holding whose LOCAL assetType is stale (`equity`) but whose stored
    // profile is a real fund. Only `assetClass === "fixed_income"` suppresses
    // — a stale `assetType` alone must not.
    const profiles = new Map<string, FundProfileInput>([["SPY", profile()]]);
    const holdings = [holding({ ticker: "SPY", assetClass: "equity", assetType: "equity" })];

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings);

    expect(out.has("SPY")).toBe(true);
  });

  it("only removes the fixed-income ticker, leaving other funds' profiles intact", () => {
    const profiles = new Map<string, FundProfileInput>([
      ["SPY", profile()],
      ["BND", profile()],
    ]);
    const holdings = [
      holding({ ticker: "SPY", assetClass: "equity" }),
      holding({ ticker: "BND", assetClass: "fixed_income" }),
    ];

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings);

    expect(out.has("SPY")).toBe(true);
    expect(out.has("BND")).toBe(false);
  });

  it("is a no-op (and returns the same map instance) when nothing held is fixed_income", () => {
    const profiles = new Map<string, FundProfileInput>([["SPY", profile()]]);
    const holdings = [holding({ ticker: "SPY", assetClass: "equity" })];

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings);

    expect(out).toBe(profiles);
  });

  it("does not mutate the input map when it does suppress a ticker", () => {
    const profiles = new Map<string, FundProfileInput>([["SPY", profile()]]);
    const holdings = [holding({ ticker: "SPY", assetClass: "fixed_income" })];

    excludeFixedIncomeFromProfileMap(profiles, holdings);

    expect(profiles.has("SPY")).toBe(true);
  });

  it("upper-cases tickers before comparing, matching every other predicate in this file", () => {
    const profiles = new Map<string, FundProfileInput>([["SPY", profile()]]);
    const holdings = [holding({ ticker: "spy", assetClass: "fixed_income" })];

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings);

    expect(out.has("SPY")).toBe(false);
  });
});

// Smoke coverage for the file's pre-existing exports — not previously pinned
// by a dedicated spec file (only indirectly via use-etf-profiles.spec.ts /
// seed-portfolio-snapshot.spec.ts / etf-profiles-route.spec.ts).
describe("toFundProfileMap / allHeldTickers / isEtfProfileFetchCandidate", () => {
  it("toFundProfileMap skips a row with neither a payload nor a refusal reason", () => {
    const out = toFundProfileMap([
      { ticker: "SPY", payload: profile().payload, refusalReason: null },
      { ticker: "QQQ", payload: null, refusalReason: null },
    ]);
    expect(out.has("SPY")).toBe(true);
    expect(out.has("QQQ")).toBe(false);
  });

  it("allHeldTickers dedupes and upper-cases", () => {
    expect(allHeldTickers([holding({ ticker: "spy" }), holding({ ticker: "SPY" })])).toEqual(["SPY"]);
  });

  it("isEtfProfileFetchCandidate rejects a fixed_income holding regardless of assetType", () => {
    expect(isEtfProfileFetchCandidate(holding({ assetType: "etf", assetClass: "fixed_income" }))).toBe(false);
  });
});
