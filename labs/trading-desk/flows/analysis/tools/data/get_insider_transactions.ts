/**
 * Recent insider Form 4 transactions for a ticker. Live: Finnhub
 * `/stock/insider-transactions` (90-day window), then Alpha Vantage
 * `INSIDER_TRANSACTIONS` as a terminal fallback (FIX-798). Fixture: curated JSON.
 *
 * On all providers failing (rate-limit, no key, network) returns an empty
 * payload tagged `source: "unavailable"`, consistent with `search_news` and
 * `get_macro_indicators`. The news analyst prompt treats `unavailable` as
 * missing signal, not bearish. The AV fallback is coarser than the Finnhub
 * primary — its rows carry a blank `transactionCode` (AV has only an A/D
 * direction flag, carried in the sign of `shares`), so it is reached only when
 * Finnhub (full SEC-code fidelity) is unavailable.
 */
import { handler } from "@flow-state-dev/core";
import { fetchFinnhubInsiderTransactions, hasFinnhubKey } from "@/lib/providers/finnhub";
import {
  fetchAlphaVantageInsiderTransactions,
  hasAlphaVantageKey,
} from "@/lib/providers/alpha-vantage";
import { resolveToolPayload } from "../runtime/resolve";
import { emptyPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_insider_transactions = handler({
  name: "get_insider_transactions",
  description: "Recent insider Form 4 transactions for a ticker (90-day window).",
  inputSchema: toolInputSchemas.get_insider_transactions,
  outputSchema: toolOutputSchemas.get_insider_transactions,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_insider_transactions", input, ctx, async () => {
      if (hasFinnhubKey()) {
        try { return await fetchFinnhubInsiderTransactions(input); } catch {}
      }
      if (hasAlphaVantageKey()) {
        try { return await fetchAlphaVantageInsiderTransactions(input); } catch {}
      }
      return emptyPayload("get_insider_transactions", input);
    });
  },
});
