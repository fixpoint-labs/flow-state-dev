/**
 * Cross-sectional factor ranking handler: resolves the peer set, fetches
 * multi-month prices and fundamentals for each peer, computes factor
 * exposures, and returns the target's percentile rank within the cross-section.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../runtime/cache";
import { loadFixture } from "../runtime/fixtures";
import { fetchFinnhubPeers } from "../providers/finnhub";
import { fetchYahooChart, fetchYahooFundamentals } from "../providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import {
  momentum12m1,
  logMarketCap,
  crossSectionalPercentile,
  crossSectionalRank,
  gatedZScore,
} from "./factor-math";
import { logReturns, realizedVolAnnualized } from "./regime-math";
import {
  pickMode,
  toolInputSchemas,
  toolOutputSchemas,
  type ToolInput,
  type ToolOutput,
} from "../schemas";
import { quantDataResource } from "../../quant-data-resource";

const MAX_PEERS = 6;

type NameData = {
  ticker: string;
  momentum: number | null;
  value: number | null;
  quality: number | null;
  size: number | null;
  lowVol: number | null;
};

async function fetchNameData(ticker: string, date: string): Promise<NameData> {
  let momentum: number | null = null;
  let value: number | null = null;
  let quality: number | null = null;
  let size: number | null = null;
  let lowVol: number | null = null;

  try {
    const chart = await getOrFetch("get_price_history", { ticker, date, range: "1y" }, () =>
      fetchYahooChart({ ticker, date, range: "1y" }),
    );
    const closes = chart.bars.map((b) => b.close);
    momentum = momentum12m1(closes);
    const returns = logReturns(closes);
    const vol = realizedVolAnnualized(returns);
    // lowVol factor: invert so lower vol = higher lowVol exposure
    lowVol = vol != null ? -vol : null;
  } catch {}

  try {
    const fundamentals = await getOrFetch("get_fundamentals", { ticker, date }, () =>
      fetchYahooFundamentals({ ticker, date }),
    );
    value = fundamentals.operatingMargin !== 0 ? fundamentals.operatingMargin : null;
    quality = fundamentals.returnOnEquity !== 0 ? fundamentals.returnOnEquity : null;
    size = logMarketCap(fundamentals.marketCap);
  } catch {}

  return { ticker, momentum, value, quality, size, lowVol };
}

function rankFactor(
  name: NameData,
  allNames: NameData[],
  factor: keyof Omit<NameData, "ticker">,
): {
  value: number | null;
  percentile: number | null;
  rank: number | null;
  outOf: number | null;
  zScore: number | null;
} {
  const nameValue = name[factor];
  if (nameValue == null) {
    return { value: null, percentile: null, rank: null, outOf: null, zScore: null };
  }
  const allValues = allNames
    .map((n) => n[factor])
    .filter((v): v is number => v != null);
  if (allValues.length < 2) {
    return {
      value: nameValue,
      percentile: null,
      rank: null,
      outOf: allValues.length,
      zScore: null,
    };
  }
  // Ordinal rank + percentile carry the read at any sample size. The z-score
  // is reported only when the cross-section is large enough to support it
  // (gatedZScore) — omitted, not caveated, for the ~7-name Finnhub peer set.
  const { rank, outOf } = crossSectionalRank(nameValue, allValues);
  const rawZ = gatedZScore(nameValue, allValues);
  return {
    value: Math.round(nameValue * 10000) / 10000,
    percentile: crossSectionalPercentile(nameValue, allValues),
    rank,
    outOf,
    zScore: rawZ != null ? Math.round(rawZ * 100) / 100 : null,
  };
}

async function fetchLive(
  input: ToolInput<"get_factor_ranks">,
): Promise<ToolOutput<"get_factor_ranks">> {
  let peerTickers: string[];
  try {
    peerTickers = await fetchFinnhubPeers(input.ticker, "subIndustry");
  } catch {
    return emptyPayload("get_factor_ranks", input);
  }

  const capped = peerTickers.slice(0, MAX_PEERS);
  const allTickers = [input.ticker, ...capped];

  const nameDataResults = await Promise.allSettled(
    allTickers.map((t) => fetchNameData(t, input.date)),
  );

  const allNames = nameDataResults
    .filter((r): r is PromiseFulfilledResult<NameData> => r.status === "fulfilled")
    .map((r) => r.value);

  const target = allNames.find((n) => n.ticker === input.ticker);
  if (!target) return emptyPayload("get_factor_ranks", input);

  const factors: ToolOutput<"get_factor_ranks">["factors"] = [
    { factor: "momentum" as const, ...rankFactor(target, allNames, "momentum") },
    { factor: "value" as const, ...rankFactor(target, allNames, "value") },
    { factor: "quality" as const, ...rankFactor(target, allNames, "quality") },
    { factor: "size" as const, ...rankFactor(target, allNames, "size") },
    { factor: "lowVol" as const, ...rankFactor(target, allNames, "lowVol") },
  ];

  const availablePercentiles = factors
    .map((f) => f.percentile)
    .filter((p): p is number => p != null);
  const compositeFactorPercentile =
    availablePercentiles.length > 0
      ? Math.round(availablePercentiles.reduce((a, b) => a + b, 0) / availablePercentiles.length)
      : null;

  return {
    source: allNames.length > 1 ? "yahoo" : "unavailable",
    ticker: input.ticker,
    asOf: input.date,
    peerCount: allNames.length,
    factors,
    compositeFactorPercentile,
  };
}

export const get_factor_ranks = handler({
  name: "get_factor_ranks",
  description:
    "Cross-sectional factor ranks: momentum, value, quality, size, and " +
    "low-vol percentiles of the name within its peer set.",
  inputSchema: toolInputSchemas.get_factor_ranks,
  outputSchema: toolOutputSchemas.get_factor_ranks,
  resources: { quantData: quantDataResource },
  // Write-through the subject's factor ranks to the quant spine (see
  // get_fundamentals). The internal PEER price/fundamentals fetches are
  // multi-ticker and stay on the args-keyed process cache.
  execute: async (input, ctx) => {
    const loadFactorRanks = async () => {
      if (pickMode(ctx) === "fixture") return loadFixture("get_factor_ranks", input);
      try {
        return await fetchLive(input);
      } catch {
        return emptyPayload("get_factor_ranks", input);
      }
    };
    // Subject-only spine guard (see get_fundamentals).
    if (input.ticker !== (ctx.session.state as { ticker?: string }).ticker) {
      return loadFactorRanks();
    }
    const payload = await ctx.resources.quantData.getOrPatchState("factorRanks", loadFactorRanks);
    return payload!;
  },
});
