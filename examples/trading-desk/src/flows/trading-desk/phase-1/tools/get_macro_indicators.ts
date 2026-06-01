/**
 * US macroeconomic indicators (CPI YoY, unemployment, fed funds, 10y, WTI,
 * yield-curve slope, HY credit spread, broad dollar index, industrial production).
 *
 * FRED is the only live provider for this tool — used by no other tool — so
 * the FRED HTTP plumbing lives inline rather than as a service. FRED returns
 * rates as percentages; the schema is fractions, so we divide by 100.
 * Index-level series (dollar, industrial production) are stored raw.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../lib/cache";
import { loadFixture } from "../../lib/fixtures";
import { emptyPayload } from "./empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "./schemas";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

type FredResponse = {
  observations?: Array<{ date: string; value: string }>;
};

async function fredSeries(seriesId: string, limit: number, key: string): Promise<number[]> {
  const url = new URL(FRED_BASE);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`FRED ${seriesId}: HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  const data = (await res.json()) as FredResponse;
  // FRED uses "." for missing observations.
  return (data.observations ?? [])
    .map((o) => o.value)
    .filter((v) => v !== "." && v !== "")
    .map(Number)
    .filter(Number.isFinite);
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
        const [cpi, unrate, fedFunds, tenYear, wti, curve, hySpr, dollar, indProd] =
          await Promise.all([
            fredSeries("CPIAUCSL", 13, key),  // 13 obs to compute YoY locally
            fredSeries("UNRATE", 1, key),
            fredSeries("DFF", 5, key),
            fredSeries("DGS10", 5, key),
            fredSeries("DCOILWTICO", 5, key),
            fredSeries("T10Y2Y", 5, key),
            fredSeries("BAMLH0A0HYM2", 5, key),
            fredSeries("DTWEXBGS", 5, key),
            fredSeries("INDPRO", 1, key),
          ]);
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
