/**
 * Analyst estimates / ratings / targets data tool. Baseline: Finnhub free
 * recommendation-trends + earnings-surprises. FMP enrichment (consensus
 * estimates, price targets, rating actions) wired in PR2.
 */
import { handler } from "@flow-state-dev/core";
import { resolveToolPayload } from "../runtime/resolve";
import {
  fetchFinnhubRecommendations,
  fetchFinnhubEarningsSurprises,
} from "../providers/finnhub";
import { emptyPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_analyst_estimates = handler({
  name: "get_analyst_estimates",
  description:
    "Fetch analyst ratings distribution, earnings beat/miss history, " +
    "and (when FMP key is set) forward consensus estimates, price targets, " +
    "and recent rating actions for a ticker.",
  inputSchema: toolInputSchemas.get_analyst_estimates,
  outputSchema: toolOutputSchemas.get_analyst_estimates,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_analyst_estimates", input, ctx, async () => {
      try {
        const [ratingsDistribution, earningsSurprises] = await Promise.all([
          fetchFinnhubRecommendations(input.ticker).catch(() => null),
          fetchFinnhubEarningsSurprises(input.ticker).catch(() => []),
        ]);
        if (!ratingsDistribution && earningsSurprises.length === 0) {
          return emptyPayload("get_analyst_estimates", input);
        }
        return {
          source: "finnhub" as const,
          ticker: input.ticker,
          asOf: input.date,
          ratingsDistribution,
          earningsSurprises,
          consensusEstimates: null,
          priceTargets: null,
          recentRatingActions: [],
        };
      } catch {
        return emptyPayload("get_analyst_estimates", input);
      }
    });
  },
});
