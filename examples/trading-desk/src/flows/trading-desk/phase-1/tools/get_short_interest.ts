/**
 * Short interest handler: fetches Finnhub short-interest data and computes
 * days-to-cover from average daily volume.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../lib/cache";
import { loadFixture } from "../../lib/fixtures";
import { fetchFinnhubShortInterest, hasFinnhubKey } from "../../providers/finnhub";
import { fetchYahooChart, fetchYahooFundamentals } from "../../providers/yahoo";
import { emptyPayload } from "./empty-payloads";
import {
  pickMode,
  toolInputSchemas,
  toolOutputSchemas,
  type ToolInput,
  type ToolOutput,
} from "./schemas";

async function fetchLive(
  input: ToolInput<"get_short_interest">,
): Promise<ToolOutput<"get_short_interest">> {
  if (!hasFinnhubKey()) return emptyPayload("get_short_interest", input);

  let shortInterest: number;
  let settlementDate: string;
  try {
    const si = await getOrFetch("finnhub-short-interest", { ticker: input.ticker }, () =>
      fetchFinnhubShortInterest(input.ticker),
    );
    shortInterest = si.shortInterest;
    settlementDate = si.settlementDate;
  } catch {
    return emptyPayload("get_short_interest", input);
  }

  // Compute days-to-cover from average daily volume (last 1 month)
  let avgDailyVolume: number | null = null;
  try {
    const chart = await getOrFetch("get_price_history", { ticker: input.ticker, date: input.date, range: "1mo" }, () =>
      fetchYahooChart({ ticker: input.ticker, date: input.date, range: "1mo" }),
    );
    const volumes = chart.bars.map((b) => b.volume).filter((v) => v > 0);
    avgDailyVolume = volumes.length > 0
      ? volumes.reduce((a, b) => a + b, 0) / volumes.length
      : null;
  } catch {}

  // Get market cap for % of float approximation
  let marketCap: number | null = null;
  try {
    const fundamentals = await getOrFetch("get_fundamentals", { ticker: input.ticker, date: input.date }, () =>
      fetchYahooFundamentals({ ticker: input.ticker, date: input.date }),
    );
    marketCap = fundamentals.marketCap;
  } catch {}

  const daysToCover = avgDailyVolume != null && avgDailyVolume > 0
    ? Math.round((shortInterest / avgDailyVolume) * 10) / 10
    : null;

  // Approximate short interest % of float (SI / approx shares outstanding)
  // This is a rough approximation since we don't have exact float data
  let shortInterestPctFloat: number | null = null;
  if (marketCap != null && marketCap > 0) {
    // Very rough: assume ~$50 avg price per share for large-cap
    // Better: get the actual share price from recent close
    try {
      const chart = await getOrFetch("get_price_history", { ticker: input.ticker, date: input.date, range: "1mo" }, () =>
        fetchYahooChart({ ticker: input.ticker, date: input.date, range: "1mo" }),
      );
      const lastClose = chart.bars[chart.bars.length - 1]?.close;
      if (lastClose && lastClose > 0) {
        const approxShares = marketCap / lastClose;
        shortInterestPctFloat = approxShares > 0
          ? Math.round((shortInterest / approxShares) * 10000) / 100
          : null;
      }
    } catch {}
  }

  return {
    source: "finnhub",
    ticker: input.ticker,
    asOf: input.date,
    shortInterest,
    shortInterestPctFloat,
    daysToCover,
    settlementDate,
  };
}

export const get_short_interest = handler({
  name: "get_short_interest",
  description:
    "Short interest data from Finnhub: shares short, approximate % of " +
    "float, days-to-cover, and settlement date.",
  inputSchema: toolInputSchemas.get_short_interest,
  outputSchema: toolOutputSchemas.get_short_interest,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_short_interest", input);
    return getOrFetch("get_short_interest", input, async () => {
      try {
        return await fetchLive(input);
      } catch {
        return emptyPayload("get_short_interest", input);
      }
    });
  },
});
