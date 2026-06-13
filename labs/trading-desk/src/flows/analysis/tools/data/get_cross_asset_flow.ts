/**
 * Cross-asset-flow handler: the macro-flow read the desk lacked. Fetches
 * trailing ~3-month returns for a fixed basket of risk-on / risk-off ETF pairs
 * (Yahoo, keyless) plus the name and SPY, and the Chicago Fed NFCI
 * financial-conditions series (FRED, key-gated), then turns them into a
 * directional reading via the pure `cross-asset-math` functions.
 *
 * Two independent providers, two independent failure modes:
 *  - The ETF basket is the keyless backbone; `source` is "yahoo" when any leg
 *    priced, "fred" if only NFCI resolved, "unavailable" when neither did.
 *  - The NFCI `liquidity` sub-block is null when FRED is absent — the
 *    cross-asset read above still stands.
 *
 * Per-leg failures degrade to a null return / null spread (BP-020): an unpriced
 * pair never becomes a fabricated 0 lean. The Yahoo fetches reuse the shared
 * `get_price_history` cache key, so a warm bar series is not re-fetched.
 */
import { handler } from "@flow-state-dev/core";
import type { CachedFetchAccessor } from "@flow-state-dev/patterns";
import { analysisCache } from "../../../shared/cache-capability";
import { mapLimit } from "../../lib/concurrency";
import { loadFixture } from "../runtime/fixtures";
import { fetchFredSeries, hasFredKey } from "../providers/fred";
import { fetchYahooChart } from "../providers/yahoo";
import {
  classifyLeaning,
  riskAppetite,
  trend3,
} from "./cross-asset-math";
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
/** Trailing window for the cross-asset returns. "3mo" → ~63 trading-day bars. */
const WINDOW_RANGE = "3mo";
const WINDOW_DAYS = 63;
/** Max simultaneous Yahoo chart fetches — keep low so a ~9-ticker basket
 *  doesn't trip Yahoo's unauthenticated rate limiter. */
const BASKET_CONCURRENCY = 4;
/** A risk-on minus risk-off return spread inside ±0.5% is noise, not a lean. */
const LEANING_DEADBAND = 0.005;

/** The risk-on / risk-off ETF pairs. Each spread is the risk-on leg's trailing
 *  return minus the risk-off leg's; positive = money leaning risk-on. */
const RATIO_PAIRS = [
  { label: "stocks vs bonds (SPY/TLT)", riskOn: "SPY", riskOff: "TLT" },
  { label: "credit appetite (HYG/LQD)", riskOn: "HYG", riskOff: "LQD" },
  { label: "cyclicals vs defensives (XLY/XLP)", riskOn: "XLY", riskOff: "XLP" },
  { label: "high-beta vs low-vol (SPHB/SPLV)", riskOn: "SPHB", riskOff: "SPLV" },
] as const;

/** Chicago Fed National Financial Conditions Index — weekly. NFCI > 0 is
 *  tighter-than-average conditions; a rising NFCI is tightening liquidity. */
const NFCI_SERIES = "NFCI";
/** ~13 weeks of observations so we can read the trend (latest vs ~3mo ago). */
const NFCI_OBS = 14;
/** An NFCI move under 0.02 index points is flat. */
const NFCI_DEADBAND = 0.02;

/** Trailing-window return for one ticker, reusing the shared price-history
 *  cache. Returns null on any failure (the leg simply doesn't price). */
async function fetchReturn(
  cache: CachedFetchAccessor,
  ticker: string,
  date: string,
): Promise<number | null> {
  try {
    const chart = await cache.getOrFetch(
      "get_price_history",
      { ticker, date, range: WINDOW_RANGE },
      () => fetchYahooChart({ ticker, date, range: WINDOW_RANGE }),
    );
    return trailingReturn(chart.bars);
  } catch {
    return null;
  }
}

/** NFCI level + trend from FRED. Null when no key or the series can't be read —
 *  the cross-asset backbone stands without it. */
async function fetchLiquidity(
  cache: CachedFetchAccessor,
): Promise<ToolOutput<"get_cross_asset_flow">["liquidity"]> {
  if (!hasFredKey()) return null;
  const key = process.env.FRED_API_KEY!.trim();
  try {
    const obs = await cache.getOrFetch("get_cross_asset_flow:nfci", { series: NFCI_SERIES }, () =>
      fetchFredSeries(NFCI_SERIES, NFCI_OBS, key),
    );
    if (obs.length === 0) return null;
    const latest = obs[0] ?? null;
    // obs is newest-first; index ~13 is ~3 months back for a weekly series.
    const prior = obs[Math.min(obs.length - 1, 13)] ?? null;
    const direction = trend3(latest, prior, NFCI_DEADBAND);
    const nfciTrend =
      direction === "rising"
        ? "tightening"
        : direction === "falling"
          ? "easing"
          : direction === "flat"
            ? "stable"
            : null;
    return { nfci: latest, nfciTrend };
  } catch {
    return null;
  }
}

async function fetchLive(
  cache: CachedFetchAccessor,
  input: ToolInput<"get_cross_asset_flow">,
): Promise<ToolOutput<"get_cross_asset_flow">> {
  // One fetch per unique ticker (name + SPY + every basket leg), bounded.
  const tickers = Array.from(
    new Set([
      input.ticker,
      BROAD_MARKET_TICKER,
      ...RATIO_PAIRS.flatMap((p) => [p.riskOn, p.riskOff]),
    ]),
  );
  const returns = await mapLimit(tickers, BASKET_CONCURRENCY, (t) =>
    fetchReturn(cache, t, input.date),
  );
  const returnByTicker = new Map(tickers.map((t, i) => [t, returns[i]]));

  const ratios = RATIO_PAIRS.map((p) => {
    const riskOnReturn = returnByTicker.get(p.riskOn) ?? null;
    const riskOffReturn = returnByTicker.get(p.riskOff) ?? null;
    const spread =
      riskOnReturn !== null && riskOffReturn !== null ? riskOnReturn - riskOffReturn : null;
    return {
      label: p.label,
      riskOnTicker: p.riskOn,
      riskOffTicker: p.riskOff,
      riskOnReturn,
      riskOffReturn,
      spread,
      leaning: classifyLeaning(spread, LEANING_DEADBAND),
    };
  });

  const appetite = riskAppetite(ratios.map((r) => r.spread), LEANING_DEADBAND);
  const nameReturn = returnByTicker.get(input.ticker) ?? null;
  const broadMarketReturn = returnByTicker.get(BROAD_MARKET_TICKER) ?? null;
  const nameVsBroadMarket =
    nameReturn !== null && broadMarketReturn !== null ? nameReturn - broadMarketReturn : null;

  const liquidity = await fetchLiquidity(cache);

  const anyReturnResolved = returns.some((r) => r !== null);
  const source = anyReturnResolved ? "yahoo" : liquidity ? "fred" : "unavailable";

  return {
    source,
    ticker: input.ticker,
    asOf: input.date,
    windowDays: WINDOW_DAYS,
    ratios,
    riskAppetite: appetite?.appetite ?? null,
    riskAppetiteScore: appetite?.score ?? null,
    nameReturn,
    broadMarketReturn,
    nameVsBroadMarket,
    liquidity,
  };
}

export const get_cross_asset_flow = handler({
  name: "get_cross_asset_flow",
  description:
    "Cross-asset flow & liquidity directionality: trailing risk-on/risk-off " +
    "ETF spreads with a composite risk-appetite read, the name's return vs " +
    "the broad tape, and the Chicago Fed NFCI financial-conditions trend.",
  inputSchema: toolInputSchemas.get_cross_asset_flow,
  outputSchema: toolOutputSchemas.get_cross_asset_flow,
  uses: [analysisCache],
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_cross_asset_flow", input);
    return ctx.cap.cache.getOrFetch("get_cross_asset_flow", input, async () => {
      try {
        return await fetchLive(ctx.cap.cache, input);
      } catch {
        return emptyPayload("get_cross_asset_flow", input);
      }
    });
  },
});
