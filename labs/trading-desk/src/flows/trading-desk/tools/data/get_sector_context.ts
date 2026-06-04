/**
 * Sector context handler: resolves the name's sector, maps it to a sector
 * ETF, and fetches trailing ~1-month returns for the name, its sector ETF,
 * and SPY (broad-market baseline). The broad-market return is purely a
 * relative anchor — not a macro-regime indicator (that's FIX-704's lane).
 *
 * Sector resolution is done in-tool via a soft Yahoo profile fetch (the same
 * pattern `get_prediction_markets` uses), cache-deduped by `getOrFetch`.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../runtime/cache";
import { loadFixture } from "../runtime/fixtures";
import { GICS_TO_ETF } from "../../lib/sector-resolution";
import { fetchYahooChart, fetchYahooCompanyProfile } from "../providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import { trailingReturn } from "../indicators-math";
import {
  pickMode,
  toolInputSchemas,
  toolOutputSchemas,
  type ToolInput,
  type ToolOutput,
} from "../schemas";

const BROAD_MARKET_TICKER = "SPY";

/** Fetch trailing ~1-month return for a single ticker. Returns null on failure. */
async function fetchReturn1m(
  ticker: string,
  date: string,
): Promise<number | null> {
  try {
    const chart = await fetchYahooChart({ ticker, date, range: "1mo" });
    return trailingReturn(chart.bars);
  } catch {
    return null;
  }
}

async function fetchLive(
  input: ToolInput<"get_sector_context">,
): Promise<ToolOutput<"get_sector_context">> {
  let sector: string | null = null;
  let industry: string | null = null;
  try {
    const profile = await getOrFetch(
      "yahoo-profile-sector",
      { ticker: input.ticker },
      () => fetchYahooCompanyProfile(input),
    );
    sector = profile.sector;
    industry = profile.industry;
  } catch {
    // Sector unresolvable — proceed with nulls.
  }

  const sectorEtf = sector !== null ? (GICS_TO_ETF[sector] ?? null) : null;

  const [nameReturn1m, sectorEtfReturn1m, broadMarketReturn1m] =
    await Promise.all([
      fetchReturn1m(input.ticker, input.date),
      sectorEtf !== null ? fetchReturn1m(sectorEtf, input.date) : Promise.resolve(null),
      fetchReturn1m(BROAD_MARKET_TICKER, input.date),
    ]);

  const relativeStrength1m =
    nameReturn1m !== null && sectorEtfReturn1m !== null
      ? nameReturn1m - sectorEtfReturn1m
      : null;
  const sectorVsMarket1m =
    sectorEtfReturn1m !== null && broadMarketReturn1m !== null
      ? sectorEtfReturn1m - broadMarketReturn1m
      : null;

  const source = sector !== null ? "yahoo" : "unavailable";

  return {
    source,
    ticker: input.ticker,
    asOf: input.date,
    sector,
    industry,
    sectorEtf,
    nameReturn1m,
    sectorEtfReturn1m,
    broadMarketReturn1m,
    relativeStrength1m,
    sectorVsMarket1m,
  };
}

export const get_sector_context = handler({
  name: "get_sector_context",
  description:
    "Sector positioning data: trailing ~1-month returns for the name, " +
    "its mapped sector ETF, and a broad-market baseline (SPY), plus " +
    "computed relative-strength and sector-vs-market deltas.",
  inputSchema: toolInputSchemas.get_sector_context,
  outputSchema: toolOutputSchemas.get_sector_context,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_sector_context", input);
    return getOrFetch("get_sector_context", input, async () => {
      try {
        return await fetchLive(input);
      } catch {
        return emptyPayload("get_sector_context", input);
      }
    });
  },
});
