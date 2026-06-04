/**
 * Recent insider Form 4 transactions for a ticker. Live: Finnhub
 * `/stock/insider-transactions` (90-day window). Fixture: curated JSON.
 *
 * Single-provider tool — on Finnhub failure (rate-limit, no key, network)
 * returns an empty payload tagged `source: "unavailable"`, consistent with
 * `search_news` and `get_macro_indicators`. The news analyst prompt treats
 * `unavailable` as missing signal, not bearish.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../runtime/cache";
import { fetchFinnhubInsiderTransactions, hasFinnhubKey } from "../providers/finnhub";
import { loadFixture } from "../runtime/fixtures";
import { emptyPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_insider_transactions = handler({
  name: "get_insider_transactions",
  description: "Recent insider Form 4 transactions for a ticker (90-day window).",
  inputSchema: toolInputSchemas.get_insider_transactions,
  outputSchema: toolOutputSchemas.get_insider_transactions,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_insider_transactions", input);
    return getOrFetch("get_insider_transactions", input, async () => {
      if (hasFinnhubKey()) {
        try { return await fetchFinnhubInsiderTransactions(input); } catch {}
      }
      return emptyPayload("get_insider_transactions", input);
    });
  },
});
