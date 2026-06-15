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
    const loadFundamentals = async () => {
      if (mode === "fixture") return loadFixture("get_fundamentals", input);
      if (hasFinnhubKey()) {
        try { return await fetchFinnhubFundamentals(input); } catch {}
      }
      try { return await fetchYahooFundamentals(input); } catch {}
      return emptyPayload("get_fundamentals", input);
    };
    // The spine holds the session SUBJECT's data, addressed by field name (one
    // session = one ticker). Tools run with the subject's tickerDate, so
    // input.ticker is the subject — but guard on it so the tool always honors its
    // input: a call for any other ticker fetches directly and never returns the
    // subject's payload mislabeled (real-money gate: no silent wrong data).
    if (input.ticker !== (ctx.session.state as { ticker?: string }).ticker) {
      return loadFundamentals();
    }
    // getOrPatchState is typed `Payload | undefined` (the field is optional on
    // the resource — absent until first fetched); our loader always resolves to a
    // payload, so the non-null assertion is sound.
    return (await ctx.resources.financialsData.getOrPatchState("fundamentals", loadFundamentals))!;
  },
});
