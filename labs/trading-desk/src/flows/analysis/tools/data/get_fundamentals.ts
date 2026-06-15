/**
 * Valuation + margins snapshot. Live: Finnhub `/stock/metric` preferred,
 * Yahoo `quoteSummary` fallback. Fixture: curated NVDA JSON.
 */
import { handler } from "@flow-state-dev/core";
import { fetchFinnhubFundamentals, hasFinnhubKey } from "../providers/finnhub";
import { loadFixture } from "../runtime/fixtures";
import { fetchYahooFundamentals } from "../providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";
import { financialsDataResource } from "../../financials-data-resource";

export const get_fundamentals = handler({
  name: "get_fundamentals",
  description: "Snapshot of valuation, growth, margins for a ticker.",
  inputSchema: toolInputSchemas.get_fundamentals,
  outputSchema: toolOutputSchemas.get_fundamentals,
  resources: { financialsData: financialsDataResource },
  // Write-through to the session financials spine: the subject's fundamentals
  // are fetched once and stored, so the valuation tap and any other reader get
  // the same copy without re-fetching. `getOrPatchState` runs the fetch only on
  // a miss, replacing the process TTL cache for this subject-scoped payload.
  execute: async (input, ctx) => {
    const mode = pickMode(ctx);
    const payload = await ctx.resources.financialsData.getOrPatchState("fundamentals", async () => {
      if (mode === "fixture") return loadFixture("get_fundamentals", input);
      if (hasFinnhubKey()) {
        try { return await fetchFinnhubFundamentals(input); } catch {}
      }
      try { return await fetchYahooFundamentals(input); } catch {}
      return emptyPayload("get_fundamentals", input);
    });
    return payload!;
  },
});
