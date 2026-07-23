/**
 * Tests for the `get_analyst_estimates` handler — the Alpha Vantage enrichment
 * of the Finnhub baseline (FIX-798) and the PRIMARY-WINS provenance rule:
 * `source` stays `"finnhub"` whenever the Finnhub baseline answered, and is
 * `"alphavantage"` only when Finnhub is absent and AV filled something.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get_analyst_estimates } from "../flows/analysis/tools/data/get_analyst_estimates";
import { _resetCache } from "../lib/cache";
import { _resetBudget } from "../lib/providers/alpha-vantage";

const originalCwd = process.cwd();
beforeEach(() => {
  process.chdir(path.resolve(__dirname, ".."));
  _resetCache();
  _resetBudget();
});
afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  delete process.env.FINNHUB_API_KEY;
  delete process.env.ALPHAVANTAGE_API_KEY;
  _resetBudget();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctx(dataSource: "fixture" | "live"): any {
  return { session: { state: { dataSource } } };
}

const execute = get_analyst_estimates.config.execute!;

const FINNHUB_RECS = [
  { period: "2026-05-01", strongBuy: 20, buy: 10, hold: 3, sell: 1, strongSell: 0 },
];
const AV_OVERVIEW = { AnalystTargetPrice: "175.50" };
const AV_ESTIMATES = {
  estimates: [
    {
      horizon: "current fiscal year",
      eps_estimate_average: "4.20",
      revenue_estimate_average: "130000000000",
      eps_estimate_number_of_analysts: "40",
    },
  ],
};

/** Route by host: finnhub.io vs alphavantage.co; `finnhubOk` toggles the baseline. */
function mockProviders(opts: { finnhubOk: boolean; avOk: boolean }) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: unknown) => {
    const url = new URL((input as URL).toString());
    if (url.hostname.includes("finnhub")) {
      if (!opts.finnhubOk) return Promise.resolve(new Response("down", { status: 429 }));
      const path = url.pathname;
      if (path.includes("recommendation")) {
        return Promise.resolve(new Response(JSON.stringify(FINNHUB_RECS), { status: 200 }));
      }
      // earnings surprises
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }
    // Alpha Vantage
    if (!opts.avOk) return Promise.resolve(new Response("down", { status: 500 }));
    const fn = url.searchParams.get("function");
    const payload = fn === "OVERVIEW" ? AV_OVERVIEW : AV_ESTIMATES;
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
  });
}

describe("get_analyst_estimates", () => {
  it("enriches the Finnhub baseline with AV fields but keeps source finnhub (primary-wins)", async () => {
    process.env.FINNHUB_API_KEY = "fh";
    process.env.ALPHAVANTAGE_API_KEY = "av";
    mockProviders({ finnhubOk: true, avOk: true });
    const out = await execute({ ticker: "NVDA", date: "2026-05-06" }, ctx("live"));
    expect(out.source).toBe("finnhub");
    expect(out.ratingsDistribution).not.toBeNull();
    expect(out.priceTargets?.consensus).toBe(175.5);
    expect(out.consensusEstimates?.fyEpsAvg).toBe(4.2);
  });

  it("tags alphavantage when Finnhub is absent and AV filled something", async () => {
    process.env.FINNHUB_API_KEY = "fh";
    process.env.ALPHAVANTAGE_API_KEY = "av";
    mockProviders({ finnhubOk: false, avOk: true });
    const out = await execute({ ticker: "NVDA", date: "2026-05-06" }, ctx("live"));
    expect(out.source).toBe("alphavantage");
    expect(out.ratingsDistribution).toBeNull();
    expect(out.priceTargets?.consensus).toBe(175.5);
  });

  it("degrades to unavailable when both Finnhub and AV are absent", async () => {
    process.env.FINNHUB_API_KEY = "fh";
    process.env.ALPHAVANTAGE_API_KEY = "av";
    mockProviders({ finnhubOk: false, avOk: false });
    const out = await execute({ ticker: "NVDA", date: "2026-05-06" }, ctx("live"));
    expect(out.source).toBe("unavailable");
    expect(out.consensusEstimates).toBeNull();
    expect(out.priceTargets).toBeNull();
  });
});
