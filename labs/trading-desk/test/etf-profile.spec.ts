/**
 * Tests for the Alpha Vantage `ETF_PROFILE` fetcher (FIX-801 §8 step 1).
 * Normalization, coverage totals, sector-vocabulary mapping, eligibility
 * refusals, and that every AV transport/body error propagates unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlphaVantageBudgetError,
  AlphaVantageError,
  AlphaVantageRateLimitError,
  AlphaVantageRequestError,
  _resetBudget,
  _resetMinutePacing,
} from "../lib/providers/alpha-vantage";
import { fetchEtfProfile, mapSectorLabel } from "../lib/providers/etf-profile";

function mockFetchOnce(payload: unknown, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(payload), { status })));
}

beforeEach(() => {
  process.env.ALPHAVANTAGE_API_KEY = "test-key";
  process.env.ALPHAVANTAGE_MINUTE_LIMIT = "0"; // isolate from pacing — not under test here
  delete process.env.ALPHAVANTAGE_DAILY_LIMIT;
  _resetBudget();
  _resetMinutePacing();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ALPHAVANTAGE_API_KEY;
  delete process.env.ALPHAVANTAGE_MINUTE_LIMIT;
  delete process.env.ALPHAVANTAGE_DAILY_LIMIT;
});

// A well-covered fund, modeled on AV's own documented SPY-shaped example:
// weights as plain fractions, one "n/a" non-attributable row, an unmapped
// sector label, and both a resolvable and unresolvable holding.
const WELL_COVERED = {
  net_assets: "429000000000",
  net_expense_ratio: "0.0945",
  portfolio_turnover: "2",
  dividend_yield: "1.32",
  inception_date: "1993-01-22",
  leveraged: "NO",
  sectors: [
    { sector: "INFORMATION TECHNOLOGY", weight: "0.30" },
    { sector: "HEALTH CARE", weight: "0.12" },
    { sector: "EXOTIC BUCKET", weight: "0.05" }, // unmapped
  ],
  holdings: [
    { symbol: "AAPL", description: "APPLE INC", weight: "0.0728" },
    { symbol: "MSFT", description: "MICROSOFT CORP", weight: "5.5%" }, // percent form
    { symbol: "n/a", description: "FUTURES CONTRACT", weight: "0.01" }, // non-attributable
  ],
};

describe("fetchEtfProfile — normalization", () => {
  it("parses plain-fraction and percent weight forms, and the n/a sentinel", async () => {
    mockFetchOnce(WELL_COVERED);
    const out = await fetchEtfProfile("SPY");
    if (out.kind !== "profile") throw new Error("expected a profile");
    const byTicker = new Map(out.profile.constituents.map((c) => [c.ticker, c.weight]));
    expect(byTicker.get("AAPL")).toBeCloseTo(0.0728);
    expect(byTicker.get("MSFT")).toBeCloseTo(0.055); // "5.5%" → 0.055
    expect(byTicker.get(null)).toBeCloseTo(0.01); // the n/a row, kept not dropped
    expect(out.profile.constituents).toHaveLength(3);
  });

  it("sends the ticker as the ETF_PROFILE symbol param", async () => {
    const spy = mockFetchOnce(WELL_COVERED);
    await fetchEtfProfile("SPY");
    const url = new URL((spy.mock.calls[0]![0] as URL).toString());
    expect(url.searchParams.get("function")).toBe("ETF_PROFILE");
    expect(url.searchParams.get("symbol")).toBe("SPY");
  });

  it("computes nameCoverage as the sum of ALL holding weights, including the non-attributable n/a rows", async () => {
    mockFetchOnce(WELL_COVERED);
    const out = await fetchEtfProfile("SPY");
    if (out.kind !== "profile") throw new Error("expected a profile");
    expect(out.profile.nameCoverage).toBeCloseTo(0.0728 + 0.055 + 0.01);
  });

  it("maps AV's upper-case GICS sector labels onto the app vocabulary, and gives an unmapped label its own bucket", async () => {
    mockFetchOnce(WELL_COVERED);
    const out = await fetchEtfProfile("SPY");
    if (out.kind !== "profile") throw new Error("expected a profile");
    const byBucket = new Map(out.profile.sectors.map((s) => [s.sector, s.weight]));
    expect(byBucket.get("Technology")).toBeCloseTo(0.3);
    expect(byBucket.get("Healthcare")).toBeCloseTo(0.12);
    // Unmapped label is NOT dropped and NOT folded into an existing bucket.
    expect([...byBucket.keys()]).toContain("Other: Exotic Bucket");
    expect(out.profile.sectorCoverage).toBeCloseTo(0.3 + 0.12 + 0.05);
  });

  it("mapSectorLabel is idempotent on already-mapped app-vocabulary input", () => {
    expect(mapSectorLabel("Financial Services")).toBe("Financial Services");
    expect(mapSectorLabel("real estate")).toBe("Real Estate");
  });

  it("parses net_expense_ratio and inception_date, null for absent fields", async () => {
    mockFetchOnce(WELL_COVERED);
    const out = await fetchEtfProfile("SPY");
    if (out.kind !== "profile") throw new Error("expected a profile");
    expect(out.profile.netExpenseRatio).toBeCloseTo(0.0945);
    expect(out.profile.inceptionDate).toBe("1993-01-22");

    mockFetchOnce({ ...WELL_COVERED, net_expense_ratio: "n/a", inception_date: "n/a" });
    const out2 = await fetchEtfProfile("SPY");
    if (out2.kind !== "profile") throw new Error("expected a profile");
    expect(out2.profile.netExpenseRatio).toBeNull();
    expect(out2.profile.inceptionDate).toBeNull();
  });
});

describe("fetchEtfProfile — eligibility refusals", () => {
  it("refuses a leveraged/inverse fund by reading the payload's own flag", async () => {
    mockFetchOnce({ ...WELL_COVERED, leveraged: "YES" });
    const out = await fetchEtfProfile("TQQQ");
    expect(out).toMatchObject({ kind: "refused", reason: "ineligible" });
  });

  it("refuses a fund with no resolvable constituents (commodity/bond — all n/a rows)", async () => {
    mockFetchOnce({
      ...WELL_COVERED,
      sectors: [],
      holdings: [
        { symbol: "n/a", description: "GOLD BULLION", weight: "0.98" },
        { symbol: "n/a", description: "CASH", weight: "0.02" },
      ],
    });
    const out = await fetchEtfProfile("GLD");
    expect(out).toMatchObject({ kind: "refused", reason: "ineligible" });
  });

  it("treats a completely empty profile response as not_an_etf", async () => {
    mockFetchOnce({});
    const out = await fetchEtfProfile("NOTANETF");
    expect(out).toMatchObject({ kind: "refused", reason: "not_an_etf" });
  });

  it("refuses (malformed) when constituent weights sum past 100%", async () => {
    mockFetchOnce({
      ...WELL_COVERED,
      sectors: [],
      holdings: [
        { symbol: "AAPL", weight: "0.7" },
        { symbol: "MSFT", weight: "0.6" },
      ],
    });
    const out = await fetchEtfProfile("BROKEN");
    expect(out).toMatchObject({ kind: "refused", reason: "malformed" });
  });

  it("does not refuse on rounding noise just over 100% (epsilon slack)", async () => {
    mockFetchOnce({
      ...WELL_COVERED,
      sectors: [],
      holdings: [
        { symbol: "AAPL", weight: "0.5" },
        { symbol: "MSFT", weight: "0.5005" },
      ],
    });
    const out = await fetchEtfProfile("ROUNDING");
    expect(out.kind).toBe("profile");
  });

  it("rejects an individual weight outside [0, 1] rather than letting it corrupt the aggregate sum (Codex review)", async () => {
    // A negative weight offsets an oversized positive one so the AGGREGATE
    // sum still lands near 100% — the malformed-sum check alone would miss
    // this. Each row must be range-checked on its own.
    mockFetchOnce({
      ...WELL_COVERED,
      sectors: [],
      holdings: [
        { symbol: "AAPL", weight: "1.3" }, // corrupted — out of [0,1]
        { symbol: "MSFT", weight: "-0.3" }, // corrupted — negative, offsets AAPL's overage
        { symbol: "NVDA", weight: "0.2" }, // genuinely valid
      ],
    });
    const out = await fetchEtfProfile("CORRUPT");
    if (out.kind !== "profile") throw new Error("expected a profile");
    const byTicker = new Map(out.profile.constituents.map((c) => [c.ticker, c.weight]));
    // The two corrupted rows contribute nothing at all — not clamped, not
    // partially counted — only the genuinely valid row survives.
    expect(byTicker.has("AAPL")).toBe(false);
    expect(byTicker.has("MSFT")).toBe(false);
    expect(byTicker.get("NVDA")).toBeCloseTo(0.2);
    expect(out.profile.nameCoverage).toBeCloseTo(0.2);
  });
});

describe("fetchEtfProfile — AV transport/body errors propagate unchanged", () => {
  it("propagates AlphaVantageError when no key is set", async () => {
    delete process.env.ALPHAVANTAGE_API_KEY;
    mockFetchOnce(WELL_COVERED);
    await expect(fetchEtfProfile("SPY")).rejects.toBeInstanceOf(AlphaVantageError);
  });

  it("propagates AlphaVantageBudgetError when the daily budget is spent", async () => {
    process.env.ALPHAVANTAGE_DAILY_LIMIT = "1"; // consume then exhaust
    mockFetchOnce(WELL_COVERED);
    await fetchEtfProfile("SPY");
    await expect(fetchEtfProfile("SPY")).rejects.toBeInstanceOf(AlphaVantageBudgetError);
  });

  it("propagates AlphaVantageRateLimitError on a Note/Information HTTP-200 body", async () => {
    mockFetchOnce({ Note: "frequency" });
    await expect(fetchEtfProfile("SPY")).rejects.toBeInstanceOf(AlphaVantageRateLimitError);
  });

  it("propagates the distinct AlphaVantageRequestError on an Error Message body", async () => {
    mockFetchOnce({ "Error Message": "invalid symbol" });
    await expect(fetchEtfProfile("SPY")).rejects.toBeInstanceOf(AlphaVantageRequestError);
  });
});
