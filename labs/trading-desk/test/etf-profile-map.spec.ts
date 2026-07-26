/**
 * Tests for `domain/portfolio/math/etf-profile-map.ts`'s pure helpers — the
 * shared row→map conversion (`toFundProfileMap`), the broad cache-read ticker
 * set (`allHeldTickers`), the strict fetch-eligibility predicate
 * (`isEtfProfileFetchCandidate`), the fixed-income attribution suppressor
 * (`excludeFixedIncomeFromProfileMap`, FIX-801 sub-PR c round 7 — judged by
 * the DOMINANT lot since round 14), the fund-of-funds constituent-broadening
 * helper (`missingConstituentTickers`, FIX-801 sub-PR c round 12), and the
 * broadening-failure withdrawal helper (`fundsReferencingTickers`, FIX-801
 * sub-PR c round 13).
 */
import { describe, expect, it } from "vitest";
import {
  allHeldTickers,
  excludeFixedIncomeFromProfileMap,
  fundsReferencingTickers,
  isEtfProfileFetchCandidate,
  missingConstituentTickers,
  toFundProfileMap,
} from "../domain/portfolio/math/etf-profile-map";
import {
  FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON,
  type FundProfileInput,
} from "../domain/portfolio/math/etf-look-through";
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

function profile(constituentTickers: Array<string | null> = ["AAPL"]): FundProfileInput {
  return {
    payload: {
      leveraged: false,
      constituents: constituentTickers.map((ticker) => ({ ticker, weight: 0.9 / constituentTickers.length })),
      nameCoverage: 0.9,
      sectors: [{ sector: "Technology", weight: 0.9 }],
      sectorCoverage: 0.9,
    },
    refusalReason: null,
  };
}

function refusal(): FundProfileInput {
  return { payload: null, refusalReason: "not_an_etf" };
}

describe("excludeFixedIncomeFromProfileMap (Codex review, FIX-801 sub-PR c round 7)", () => {
  it("suppresses a ticker's attribution when its CURRENT holding assetClass is fixed_income, even though a normal profile is cached — REPLACES the entry with an opaque-but-fund-evidence refusal, does not delete it (Codex review, FIX-801 sub-PR c round 17)", () => {
    const profiles = new Map<string, FundProfileInput>([["SPY", profile()]]);
    const holdings = [holding({ ticker: "SPY", assetClass: "fixed_income" })];

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings, new Map());

    // Not deleted — replaced with a refusal that still proves fund-ness
    // (`resolveTickerIsFund`'s layer 1b), so a stale-equity-tagged holding
    // isn't misreported as a direct stock once its profile is suppressed.
    expect(out.get("SPY")).toEqual({ payload: null, refusalReason: FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON });
  });

  it("leaves a non-fixed-income ticker's cached profile untouched", () => {
    const profiles = new Map<string, FundProfileInput>([["SPY", profile()]]);
    const holdings = [holding({ ticker: "SPY", assetClass: "equity" })];

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings, new Map());

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

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings, new Map());

    expect(out.get("BND")).toEqual({ payload: null, refusalReason: FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON });
  });

  it("does NOT reintroduce the mistyped-equity read bug — a holding still tagged equity locally keeps its stored profile even if it's actually a fund", () => {
    // The exact scenario `allHeldTickers`'s broad read exists to recover: a
    // holding whose LOCAL assetType is stale (`equity`) but whose stored
    // profile is a real fund. Only `assetClass === "fixed_income"` suppresses
    // — a stale `assetType` alone must not.
    const profiles = new Map<string, FundProfileInput>([["SPY", profile()]]);
    const holdings = [holding({ ticker: "SPY", assetClass: "equity", assetType: "equity" })];

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings, new Map());

    expect(out.has("SPY")).toBe(true);
  });

  it("only suppresses the fixed-income ticker, leaving other funds' profiles intact", () => {
    const profiles = new Map<string, FundProfileInput>([
      ["SPY", profile()],
      ["BND", profile()],
    ]);
    const holdings = [
      holding({ ticker: "SPY", assetClass: "equity" }),
      holding({ ticker: "BND", assetClass: "fixed_income" }),
    ];

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings, new Map());

    expect(out.get("SPY")).toEqual(profile());
    expect(out.get("BND")).toEqual({ payload: null, refusalReason: FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON });
  });

  it("is a no-op (and returns the same map instance) when nothing held is fixed_income", () => {
    const profiles = new Map<string, FundProfileInput>([["SPY", profile()]]);
    const holdings = [holding({ ticker: "SPY", assetClass: "equity" })];

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings, new Map());

    expect(out).toBe(profiles);
  });

  it("does not mutate the input map when it does suppress a ticker", () => {
    const profiles = new Map<string, FundProfileInput>([["SPY", profile()]]);
    const holdings = [holding({ ticker: "SPY", assetClass: "fixed_income" })];

    excludeFixedIncomeFromProfileMap(profiles, holdings, new Map());

    expect(profiles.has("SPY")).toBe(true);
  });

  it("upper-cases tickers before comparing, matching every other predicate in this file", () => {
    const profiles = new Map<string, FundProfileInput>([["SPY", profile()]]);
    const holdings = [holding({ ticker: "spy", assetClass: "fixed_income" })];

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings, new Map());

    expect(out.get("SPY")).toEqual({ payload: null, refusalReason: FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON });
  });

  it("a tiny fixed-income lot no longer suppresses a much larger equity-classified position in the same ticker — judged by the DOMINANT lot, not ANY row (Codex review, FIX-801 sub-PR c round 14: a real inconsistency, `summarizePortfolioHealth` already classifies a ticker by its dominant lot, this used to disagree with an 'any row' test)", () => {
    const profiles = new Map<string, FundProfileInput>([["SPY", profile()]]);
    const holdings = [
      holding({ ticker: "SPY", assetClass: "fixed_income", quantity: 1 }), // 1 share @ $100 = $100
      holding({ ticker: "SPY", assetClass: "equity", quantity: 1_000 }), // 1,000 shares @ $100 = $100,000 — dominant
    ];
    const quotes = new Map([["SPY", { price: 100 }]]);

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings, quotes);

    expect(out.has("SPY")).toBe(true);
  });

  it("still excludes when the DOMINANT lot is fixed_income, even with a smaller equity-classified lot of the same ticker present", () => {
    const profiles = new Map<string, FundProfileInput>([["SPY", profile()]]);
    const holdings = [
      holding({ ticker: "SPY", assetClass: "equity", quantity: 1 }), // 1 share @ $100 = $100
      holding({ ticker: "SPY", assetClass: "fixed_income", quantity: 1_000 }), // 1,000 shares @ $100 = $100,000 — dominant
    ];
    const quotes = new Map([["SPY", { price: 100 }]]);

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings, quotes);

    expect(out.get("SPY")).toEqual({ payload: null, refusalReason: FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON });
  });

  it("the curated bond-ETF list check runs over EVERY held ticker regardless of the dominant classification result", () => {
    // BND's dominant lot happens to be equity-classified (a manual override
    // on the larger lot), but the curated list still wins — same "trust the
    // list directly" rule as round 10's fix, now applied on top of the
    // dominant-lot comparison rather than instead of it.
    const profiles = new Map<string, FundProfileInput>([["BND", profile()]]);
    const holdings = [
      holding({ ticker: "BND", assetClass: "fixed_income", quantity: 1 }),
      holding({ ticker: "BND", assetClass: "equity", quantity: 1_000 }), // dominant, but BND is still curated
    ];
    const quotes = new Map([["BND", { price: 100 }]]);

    const out = excludeFixedIncomeFromProfileMap(profiles, holdings, quotes);

    expect(out.get("BND")).toEqual({ payload: null, refusalReason: FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON });
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

describe("missingConstituentTickers (Codex review, FIX-801 sub-PR c round 12, P1 — fund-of-funds constituent broadening)", () => {
  it("returns a held fund's constituent ticker when it is not itself a key in the map (AOA holds VTI, VTI not separately held/loaded)", () => {
    const profiles = new Map<string, FundProfileInput>([["AOA", profile(["VTI", "NVDA"])]]);

    expect(missingConstituentTickers(profiles)).toEqual(["VTI", "NVDA"]);
  });

  it("does not return a ticker that is already a key in the map", () => {
    const profiles = new Map<string, FundProfileInput>([
      ["AOA", profile(["VTI"])],
      ["VTI", profile(["AAPL"])], // VTI's own profile already present
    ]);

    // VTI itself is no longer missing (it's a key) — only VTI's OWN
    // constituent (AAPL) is surfaced, because this function has no memory of
    // which entries came from the ORIGINAL held-tickers read versus an
    // already-merged constituent; it just scans every entry currently in the
    // map. This is exactly why the docblock says call it ONCE, never loop it
    // — a caller who merged VTI in and called this AGAIN would incorrectly
    // go a level deeper (chasing VTI's own AAPL holding), which the oracle
    // never needs (it only asks whether VTI itself is a fund).
    expect(missingConstituentTickers(profiles)).toEqual(["AAPL"]);
  });

  it("skips a fund with no payload (a refusal) — nothing to extract constituents from", () => {
    const profiles = new Map<string, FundProfileInput>([["NOTETF", refusal()]]);

    expect(missingConstituentTickers(profiles)).toEqual([]);
  });

  it("skips a null-ticker constituent row (AV's n/a sentinel — nothing to look up)", () => {
    const profiles = new Map<string, FundProfileInput>([["AOA", profile([null, "VTI"])]]);

    expect(missingConstituentTickers(profiles)).toEqual(["VTI"]);
  });

  it("dedupes a constituent shared by two different held funds", () => {
    const profiles = new Map<string, FundProfileInput>([
      ["AOA", profile(["VTI"])],
      ["ITOT", profile(["VTI"])], // a second allocation fund holding the same VTI
    ]);

    expect(missingConstituentTickers(profiles)).toEqual(["VTI"]);
  });

  it("upper-cases the returned ticker and treats an already-present lower-case-equivalent key as satisfied", () => {
    const profiles = new Map<string, FundProfileInput>([["AOA", profile(["vti"])]]);
    expect(missingConstituentTickers(profiles)).toEqual(["VTI"]);

    // Once "VTI" (upper-case) is a key, it's no longer missing — regardless
    // of the lower-case form the constituent row itself carried.
    const alreadyLoaded = new Map<string, FundProfileInput>([
      ["AOA", profile(["vti"])],
      ["VTI", profile([])], // no further constituents to avoid a second-level result here
    ]);
    expect(missingConstituentTickers(alreadyLoaded)).toEqual([]);
  });

  it("returns [] for an empty map", () => {
    expect(missingConstituentTickers(new Map())).toEqual([]);
  });

  it("works over a raw EtfProfileRow-shaped map too, not just FundProfileInput — the route's own map shape, structurally compatible without conversion", () => {
    // `db/repository.ts`'s `EtfProfileRow` mirrors `NormalizedFundProfile`
    // field-for-field by design (this file's own module docblock) — the
    // route (`app/api/portfolio/etf-profiles/route.ts`) calls this function
    // directly on its `Map<string, EtfProfileRow>` without converting to
    // `FundProfileInput` first.
    const rawRowShaped = new Map([
      [
        "AOA",
        {
          ticker: "AOA",
          payload: {
            leveraged: false,
            constituents: [{ ticker: "VTI", weight: 0.9 }],
            nameCoverage: 0.9,
            sectors: [],
            sectorCoverage: 0,
            netExpenseRatio: null,
            inceptionDate: null,
          },
          refusalReason: null,
          refusalDetail: null,
          retryAt: null,
          transientAttempts: 0,
          fetchedAt: "2026-05-06T00:00:00.000Z",
        },
      ],
    ]);

    expect(missingConstituentTickers(rawRowShaped)).toEqual(["VTI"]);
  });
});

describe("fundsReferencingTickers (Codex review, FIX-801 sub-PR c round 13 — the broadening-failure withdrawal helper)", () => {
  it("returns the wrapper whose constituent list includes a given ticker", () => {
    const profiles = new Map<string, FundProfileInput>([
      ["AOA", profile(["VTI", "NVDA"])],
      ["SPY", profile(["AAPL", "MSFT"])],
    ]);

    expect(fundsReferencingTickers(profiles, ["VTI"])).toEqual(["AOA"]);
  });

  it("returns every wrapper referencing ANY of the given tickers, not just the first match", () => {
    const profiles = new Map<string, FundProfileInput>([
      ["AOA", profile(["VTI"])],
      ["ITOT", profile(["VTI"])], // a second wrapper referencing the same failed ticker
      ["SPY", profile(["AAPL"])], // unaffected — doesn't reference VTI at all
    ]);

    expect(fundsReferencingTickers(profiles, ["VTI"]).sort()).toEqual(["AOA", "ITOT"]);
  });

  it("excludes a wrapper whose own constituents were all already resolved (does not reference any failed ticker)", () => {
    const profiles = new Map<string, FundProfileInput>([["SPY", profile(["AAPL", "MSFT"])]]);

    expect(fundsReferencingTickers(profiles, ["VTI"])).toEqual([]);
  });

  it("skips a fund with no payload (a refusal) — nothing to check its constituents against", () => {
    const profiles = new Map<string, FundProfileInput>([["NOTETF", refusal()]]);

    expect(fundsReferencingTickers(profiles, ["VTI"])).toEqual([]);
  });

  it("upper-cases both sides of the comparison", () => {
    const profiles = new Map<string, FundProfileInput>([["AOA", profile(["vti"])]]);

    expect(fundsReferencingTickers(profiles, ["vti"])).toEqual(["AOA"]);
  });

  it("returns [] for an empty map or an empty tickers list", () => {
    expect(fundsReferencingTickers(new Map(), ["VTI"])).toEqual([]);
    expect(fundsReferencingTickers(new Map([["AOA", profile(["VTI"])]]), [])).toEqual([]);
  });
});
