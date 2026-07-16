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
import { mapLimit } from "@/lib/concurrency";
import { resolveToolPayload } from "../runtime/resolve";
import { fetchFredSeries } from "@/lib/providers/fred";
import { emptyPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

/** Max simultaneous FRED requests. FRED throttles concurrent bursts, so keep
 *  this low; drop to 1 (fully sequential) if throttling still bites. */
const FRED_CONCURRENCY = 3;

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

export const get_macro_indicators = handler({
  name: "get_macro_indicators",
  description: "CPI, unemployment, fed-funds, 10y yield, oil — date-keyed snapshot.",
  inputSchema: toolInputSchemas.get_macro_indicators,
  outputSchema: toolOutputSchemas.get_macro_indicators,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_macro_indicators", input, ctx, async () => {
      const key = process.env.FRED_API_KEY?.trim();
      if (!key) return emptyPayload("get_macro_indicators", input);
      try {
        // Bounded concurrency + per-series retry (see module header). Each
        // series degrades to [] on final failure rather than throwing.
        const series = await mapLimit(FRED_SERIES, FRED_CONCURRENCY, ({ id, limit }) =>
          fetchFredSeries(id, limit, key).catch(() => [] as number[]),
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
