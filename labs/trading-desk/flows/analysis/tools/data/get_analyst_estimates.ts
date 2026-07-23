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

        // AV enrichment — each field independent; never throws (allSettled inside).
        let consensusEstimates = null;
        let priceTargets = null;
        if (hasAlphaVantageKey()) {
          try {
            const enr = await fetchAlphaVantageAnalystEnrichment(input.ticker);
            consensusEstimates = enr.consensusEstimates;
            priceTargets = enr.priceTargets;
          } catch {}
        }

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
