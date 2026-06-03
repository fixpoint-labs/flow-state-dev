/**
 * US macroeconomic indicators (CPI YoY, unemployment, fed funds, 10y, WTI,
 * yield-curve slope, HY credit spread, broad dollar index, industrial production).
 *
 * FRED is the only live provider for this tool — used by no other tool — so
 * the FRED HTTP plumbing lives inline rather than as a service. FRED returns
 * rates as percentages; the schema is fractions, so we divide by 100.
 * Index-level series (dollar, industrial production) are stored raw.
 *
 * The nine series are fetched with BOUNDED CONCURRENCY and PER-SERIES RETRY,
 * not a nine-way parallel burst. FRED throttles concurrent bursts (429s) even
 * below its per-minute quota, which previously left most series empty (the
 * payload came back tagged `fred` but with 7-of-9 fields zeroed). Each series
 * also degrades to [] on final failure, so one bad series never blanks the
 * payload; `unavailable` is reported only when every series fails.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../lib/cache";
import { mapLimit, sleep } from "../../lib/concurrency";
import { loadFixture } from "../../lib/fixtures";
import { emptyPayload } from "./empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "./schemas";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

/** Max simultaneous FRED requests. FRED throttles concurrent bursts, so keep
 *  this low; drop to 1 (fully sequential) if throttling still bites. */
const FRED_CONCURRENCY = 3;
/** Retry attempts for transient FRED failures (429 / 5xx / network). */
const FRED_RETRIES = 2;

/**
 * The nine series and how many recent observations to request. Daily series
 * pull a 10-obs window so trailing weekend / holiday / not-yet-published "."
 * rows don't empty the result; monthly series pull a few obs so one
 * unpublished month can't blank them. CPI needs 13 to compute YoY locally.
 */
const FRED_SERIES = [
  { id: "CPIAUCSL", limit: 13 }, // monthly; 13 obs to compute YoY
  { id: "UNRATE", limit: 3 }, // monthly
  { id: "DFF", limit: 10 }, // daily
  { id: "DGS10", limit: 10 }, // daily
  { id: "DCOILWTICO", limit: 10 }, // daily
  { id: "T10Y2Y", limit: 10 }, // daily
  { id: "BAMLH0A0HYM2", limit: 10 }, // daily
  { id: "DTWEXBGS", limit: 10 }, // daily
  { id: "INDPRO", limit: 3 }, // monthly
] as const;

type FredResponse = {
  observations?: Array<{ date: string; value: string }>;
};

/**
 * Fetch one FRED series (most recent `limit` observations, newest-first),
 * retrying transient throttling / server errors with linear backoff. Returns
 * the finite values newest-first; throws after the final attempt so the
 * caller can degrade just that series to [].
 */
async function fredSeries(seriesId: string, limit: number, key: string): Promise<number[]> {
  const url = new URL(FRED_BASE);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(limit));

  let lastErr: unknown;
  for (let attempt = 0; attempt <= FRED_RETRIES; attempt++) {
    if (attempt > 0) await sleep(150 * attempt); // 150ms, then 300ms
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(`FRED ${seriesId}: HTTP ${res.status} ${body.slice(0, 120)}`);
        // Retry transient throttling / server errors; give up on client errors.
        if (res.status === 429 || res.status >= 500) {
          lastErr = err;
          continue;
        }
        throw err;
      }
      const data = (await res.json()) as FredResponse;
      // FRED uses "." for missing observations; keep finite values newest-first.
      return (data.observations ?? [])
        .map((o) => o.value)
        .filter((v) => v !== "." && v !== "")
        .map(Number)
        .filter(Number.isFinite);
    } catch (err) {
      lastErr = err; // network error — retry
    }
  }
  throw lastErr;
}

export const get_macro_indicators = handler({
  name: "get_macro_indicators",
  description: "CPI, unemployment, fed-funds, 10y yield, oil — date-keyed snapshot.",
  inputSchema: toolInputSchemas.get_macro_indicators,
  outputSchema: toolOutputSchemas.get_macro_indicators,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_macro_indicators", input);
    return getOrFetch("get_macro_indicators", input, async () => {
      const key = process.env.FRED_API_KEY?.trim();
      if (!key) return emptyPayload("get_macro_indicators", input);
      try {
        // Bounded concurrency + per-series retry (see module header). Each
        // series degrades to [] on final failure rather than throwing.
        const series = await mapLimit(FRED_SERIES, FRED_CONCURRENCY, ({ id, limit }) =>
          fredSeries(id, limit, key).catch(() => [] as number[]),
        );
        const [cpi, unrate, fedFunds, tenYear, wti, curve, hySpr, dollar, indProd] = series;
        if (series.every((s) => s.length === 0)) {
          return emptyPayload("get_macro_indicators", input);
        }
        const latestCpi = cpi[0] ?? 0;
        const yearAgoCpi = cpi[12] ?? cpi[cpi.length - 1] ?? latestCpi;
        const cpiYoy = yearAgoCpi > 0 ? (latestCpi - yearAgoCpi) / yearAgoCpi : 0;
        return {
          source: "fred",
          asOf: input.date,
          cpiYoy,
          unemployment: (unrate[0] ?? 0) / 100,
          fedFundsRate: (fedFunds[0] ?? 0) / 100,
          tenYearYield: (tenYear[0] ?? 0) / 100,
          oilWtiUsd: wti[0] ?? 0,
          yieldCurve2s10s: (curve[0] ?? 0) / 100,
          hyCreditSpread: (hySpr[0] ?? 0) / 100,
          dollarIndex: dollar[0] ?? 0,
          industrialProduction: indProd[0] ?? 0,
        };
      } catch {
        return emptyPayload("get_macro_indicators", input);
      }
    });
  },
});
