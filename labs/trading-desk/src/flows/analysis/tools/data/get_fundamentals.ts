/**
 * Valuation + margins snapshot. Live: Finnhub `/stock/metric` preferred,
 * Yahoo `quoteSummary` fallback. Fixture: curated NVDA JSON.
 */
import { handler } from "@flow-state-dev/core";
import { fetchFinnhubFundamentals, hasFinnhubKey } from "../providers/finnhub";
import { resolveToolPayload } from "../runtime/resolve";
import { fetchYahooFundamentals } from "../providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_fundamentals = handler({
  name: "get_fundamentals",
  description: "Snapshot of valuation, growth, margins for a ticker.",
  inputSchema: toolInputSchemas.get_fundamentals,
  outputSchema: toolOutputSchemas.get_fundamentals,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_fundamentals", input, ctx, async () => {
      if (hasFinnhubKey()) {
        try { return await fetchFinnhubFundamentals(input); } catch {}
      }
      try { return await fetchYahooFundamentals(input); } catch {}
      return emptyPayload("get_fundamentals", input);
    });
  },
});
