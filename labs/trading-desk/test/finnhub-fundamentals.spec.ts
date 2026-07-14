/**
 * Unit tests for `fetchFinnhubFundamentals` — pins the field-name mapping so
 * the FIX-692 regression can't reappear: `forwardPE` must come from Finnhub's
 * real `metric.forwardPE`, never from `peNormalizedAnnual` / `peAnnual` /
 * `peTTM`, and `trailingPE` must come from `metric.peTTM`. Missing/non-finite
 * P/E values map to `null`, not a backward-looking substitute.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFinnhubFundamentals } from "../src/providers/finnhub";

/** `fetchFinnhubFundamentals` calls /stock/profile2 and /stock/metric. A single
 *  payload carrying both `marketCapitalization` (read by the profile call) and
 *  `metric` (read by the metric call) satisfies both reads. */
function mockFetch(payload: unknown, status = 200) {
  // A fresh Response per call: the body can only be read once, and
  // fetchFinnhubFundamentals makes two calls (/stock/profile2 + /stock/metric).
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(JSON.stringify(payload), { status }),
  );
}

beforeAll(() => {
  process.env.FINNHUB_API_KEY = "test-key";
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchFinnhubFundamentals P/E mapping", () => {
  it("maps metric.forwardPE → forwardPE and metric.peTTM → trailingPE", async () => {
    mockFetch({
      marketCapitalization: 1000,
      metric: {
        forwardPE: 19.5,
        peTTM: 47.2,
        peNormalizedAnnual: 47.8, // the OLD bug returned this as forwardPE
        peAnnual: 47.8,
        psTTM: 7.5,
        roeTTM: 12.3,
        operatingMarginTTM: 45.4,
        grossMarginTTM: 50.0,
      },
    });
    const out = await fetchFinnhubFundamentals({ ticker: "BX", date: "2026-05-06" });
    expect(out.source).toBe("finnhub");
    expect(out.forwardPE).toBe(19.5);
    expect(out.trailingPE).toBe(47.2);
    // Guard against the regression: neither P/E field picks up the annual values.
    expect(out.forwardPE).not.toBe(47.8);
    expect(out.trailingPE).not.toBe(47.8);
  });

  it("returns null forwardPE when metric.forwardPE is absent", async () => {
    mockFetch({
      marketCapitalization: 1000,
      metric: { peTTM: 47.2 /* no forwardPE */ },
    });
    const out = await fetchFinnhubFundamentals({ ticker: "BX", date: "2026-05-06" });
    expect(out.forwardPE).toBeNull();
    expect(out.trailingPE).toBe(47.2);
  });

  it("returns null trailingPE when metric.peTTM is absent", async () => {
    mockFetch({
      marketCapitalization: 1000,
      metric: { forwardPE: 19.5 /* no peTTM */ },
    });
    const out = await fetchFinnhubFundamentals({ ticker: "BX", date: "2026-05-06" });
    expect(out.forwardPE).toBe(19.5);
    expect(out.trailingPE).toBeNull();
  });

  it("maps a zero P/E to null, consistent with the Yahoo adapter", async () => {
    mockFetch({
      marketCapitalization: 1000,
      metric: { forwardPE: 0, peTTM: 0 },
    });
    const out = await fetchFinnhubFundamentals({ ticker: "BX", date: "2026-05-06" });
    expect(out.forwardPE).toBeNull();
    expect(out.trailingPE).toBeNull();
  });
});

describe("fetchFinnhubFundamentals dividend yield mapping", () => {
  it("maps dividendYieldIndicatedAnnual percent to fraction", async () => {
    mockFetch({
      marketCapitalization: 1000,
      metric: { dividendYieldIndicatedAnnual: 2.5 },
    });
    const out = await fetchFinnhubFundamentals({ ticker: "JPM", date: "2026-05-06" });
    expect(out.dividendYield).toBeCloseTo(0.025, 4);
  });

  it("returns null dividendYield when absent", async () => {
    mockFetch({
      marketCapitalization: 1000,
      metric: {},
    });
    const out = await fetchFinnhubFundamentals({ ticker: "NVDA", date: "2026-05-06" });
    expect(out.dividendYield).toBeNull();
  });

  it("returns null dividendYield when zero (non-payer)", async () => {
    mockFetch({
      marketCapitalization: 1000,
      metric: { dividendYieldIndicatedAnnual: 0 },
    });
    const out = await fetchFinnhubFundamentals({ ticker: "NVDA", date: "2026-05-06" });
    expect(out.dividendYield).toBeNull();
  });
});

describe("fetchFinnhubFundamentals marketCap normalization", () => {
  it("normalizes marketCapitalization from $M to $B", async () => {
    mockFetch({
      marketCapitalization: 2950000, // $2.95T in $M
      metric: {},
    });
    const out = await fetchFinnhubFundamentals({ ticker: "NVDA", date: "2026-05-06" });
    expect(out.marketCap).toBeCloseTo(2950, 1);
  });
});
