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
 *
 * A SERIES THAT FAILED READS `null`, NOT `0` (FIX-1063). This is the partial-
 * answer path, and it is the most dangerous of the four the issue fixed: the
 * payload keeps its `source: "fred"` tag, so nothing else marks the miss. Six
 * of nine series answering used to publish 0% inflation, 0% unemployment and a
 * 0% policy rate as live FRED measurements. The source tag is deliberately
 * unchanged — whether a partial payload should report partial *provenance* is a
 * separate change to the tag vocabulary across every tool.
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
        /** Latest observation of a series, or `null` when the series failed. */
        const latest = (s: number[]): number | null => s[0] ?? null;
        /** As `latest`, converted from FRED's percentage to a fraction. */
        const latestPct = (s: number[]): number | null => {
          const v = latest(s);
          return v == null ? null : v / 100;
        };
        // YoY needs BOTH prints. A year-ago observation we don't have is not a
        // 0% change — it is no reading at all.
        //
        // Strictly `cpi[12]`, the 13th monthly observation: the series is
        // requested with `limit: 13` precisely so this index IS the year-ago
        // print. Falling back to the oldest available observation (FIX-1063)
        // fabricated under a live `source: "fred"` tag on a SUCCESSFUL but
        // short response — one usable observation made `yearAgoCpi === latestCpi`
        // and published a 0% YoY, and 2–12 published a shorter-window change
        // mislabeled as year-over-year. A short series is a gap, so it nulls.
        const latestCpi = latest(cpi);
        const yearAgoCpi = cpi[12] ?? null;
        const cpiYoy =
          latestCpi != null && yearAgoCpi != null && yearAgoCpi > 0
            ? (latestCpi - yearAgoCpi) / yearAgoCpi
            : null;
        return {
          source: "fred",
          asOf: input.date,
          cpiYoy,
          unemployment: latestPct(unrate),
          fedFundsRate: latestPct(fedFunds),
          tenYearYield: latestPct(tenYear),
          oilWtiUsd: latest(wti),
          yieldCurve2s10s: latestPct(curve),
          hyCreditSpread: latestPct(hySpr),
          dollarIndex: latest(dollar),
          industrialProduction: latest(indProd),
        };
      } catch {
        return emptyPayload("get_macro_indicators", input);
      }
    });
  },
});
