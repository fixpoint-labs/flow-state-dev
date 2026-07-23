/**
 * Analyst estimates / ratings / targets data tool. Baseline: Finnhub free
 * recommendation-trends + earnings-surprises. Alpha Vantage enrichment
 * (OVERVIEW price-target consensus + EARNINGS_ESTIMATES forward consensus)
 * layers on top when ALPHAVANTAGE_API_KEY is set (FIX-798). Provenance is
 * PRIMARY-WINS: `source` stays `"finnhub"` whenever the Finnhub baseline
 * answered, and is `"alphavantage"` only when Finnhub is absent and AV filled
 * something.
 */
import { handler } from "@flow-state-dev/core";
import {
  fetchFinnhubRecommendations,
  fetchFinnhubEarningsSurprises,
} from "@/lib/providers/finnhub";
import {
  fetchAlphaVantageAnalystEnrichment,
  hasAlphaVantageKey,
} from "@/lib/providers/alpha-vantage";
import { resolveToolPayload } from "../runtime/resolve";
import { emptyPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_analyst_estimates = handler({
  name: "get_analyst_estimates",
  description:
    "Fetch analyst ratings distribution, earnings beat/miss history, " +
    "and (when an Alpha Vantage key is set) forward consensus estimates and " +
    "price targets for a ticker.",
  inputSchema: toolInputSchemas.get_analyst_estimates,
  outputSchema: toolOutputSchemas.get_analyst_estimates,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_analyst_estimates", input, ctx, async () => {
      try {
        const [ratingsDistribution, earningsSurprises] = await Promise.all([
          fetchFinnhubRecommendations(input.ticker).catch(() => null),
          fetchFinnhubEarningsSurprises(input.ticker).catch(() => []),
        ]);

        // AV enrichment — costs 2 AV budget units when keyed (OVERVIEW +
        // EARNINGS_ESTIMATES via Promise.allSettled). This is unconditional by
        // design: consensusEstimates + priceTargets are fields the Finnhub
        // baseline structurally never fills, so the enrichment is always
        // additive and gating it on "Finnhub missing those fields" would never
        // skip (they are always missing). The tradeoff is quota: on the 25/day
        // free tier ~12 distinct tickers exhaust the cap from this tool alone —
        // sized into ALPHAVANTAGE_DAILY_LIMIT (spec §4 budget accounting). The
        // fetcher returns null (not an all-null object) when AV has no real
        // data, so `avAnswered` stays false and the tool degrades honestly.
        const enr = hasAlphaVantageKey()
          ? await fetchAlphaVantageAnalystEnrichment(input.ticker).catch(() => null)
          : null;
        const consensusEstimates = enr?.consensusEstimates ?? null;
        const priceTargets = enr?.priceTargets ?? null;

        const finnhubAnswered =
          ratingsDistribution !== null || earningsSurprises.length > 0;
        const avAnswered = consensusEstimates !== null || priceTargets !== null;

        if (!finnhubAnswered && !avAnswered) {
          return emptyPayload("get_analyst_estimates", input);
        }

        return {
          // PRIMARY-WINS: Finnhub tag whenever its baseline answered; AV only
          // when Finnhub is absent and AV contributed a field.
          source: finnhubAnswered ? ("finnhub" as const) : ("alphavantage" as const),
          ticker: input.ticker,
          asOf: input.date,
          ratingsDistribution,
          earningsSurprises,
          consensusEstimates,
          priceTargets,
          recentRatingActions: [],
        };
      } catch {
        return emptyPayload("get_analyst_estimates", input);
      }
    });
  },
});
