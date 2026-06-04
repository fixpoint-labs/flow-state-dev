/**
 * Unit tests for the pure Yahoo `defaultKeyStatistics` short-interest mapper.
 *
 * Short interest was single-sourced on Finnhub's `/stock/short-interest`
 * endpoint, which is commonly premium-gated and sparse for ADRs (TSM returned
 * `unavailable`). Yahoo's `defaultKeyStatistics` module — already fetched by
 * `fetchYahooFundamentals` — carries `sharesShort`, `shortRatio`
 * (days-to-cover, pre-computed), and `shortPercentOfFloat`, free and with ADR
 * coverage. These pin the field selection and unit conversion (Yahoo reports
 * percent-of-float as a fraction; the schema/memo use a percentage).
 */
import { describe, expect, it } from "vitest";
import { mapYahooShortInterest } from "../src/flows/trading-desk/providers/yahoo-keystats";

describe("mapYahooShortInterest", () => {
  it("maps short interest from defaultKeyStatistics (plain numbers + {raw} wrappers)", () => {
    const stats = {
      sharesShort: { raw: 120_000_000 },
      shortRatio: { raw: 1.8 },
      shortPercentOfFloat: { raw: 0.062 }, // 6.2% as a fraction
      dateShortInterest: { raw: 1_746_057_600 }, // 2025-05-01 (epoch seconds)
    };
    const out = mapYahooShortInterest(stats, "AAPL", "2026-05-06");
    expect(out.source).toBe("yahoo");
    expect(out.shortInterest).toBe(120_000_000);
    // days-to-cover comes straight from Yahoo's shortRatio
    expect(out.daysToCover).toBeCloseTo(1.8, 1);
    // fraction → percentage
    expect(out.shortInterestPctFloat).toBeCloseTo(6.2, 1);
    expect(out.settlementDate).toBe("2025-05-01");
  });

  it("maps plain (unwrapped) numeric fields too", () => {
    const out = mapYahooShortInterest(
      { sharesShort: 50_000_000, shortRatio: 2.5, shortPercentOfFloat: 0.013 },
      "NVDA",
      "2026-05-06",
    );
    expect(out.shortInterest).toBe(50_000_000);
    expect(out.daysToCover).toBeCloseTo(2.5, 1);
    expect(out.shortInterestPctFloat).toBeCloseTo(1.3, 1);
  });

  it("returns null fields (not 0) when stats lack short-interest data — the ADR case", () => {
    const out = mapYahooShortInterest({ forwardPE: { raw: 18 } }, "TSM", "2026-05-06");
    expect(out.shortInterest).toBeNull();
    expect(out.daysToCover).toBeNull();
    expect(out.shortInterestPctFloat).toBeNull();
    expect(out.settlementDate).toBeNull();
  });
});
