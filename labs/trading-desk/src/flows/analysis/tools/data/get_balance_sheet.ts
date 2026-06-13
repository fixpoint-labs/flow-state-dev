/**
 * Latest balance sheet (totals only). Live: SEC EDGAR companyfacts
 * (authoritative US filings) preferred, Yahoo `fundamentals-timeseries`
 * fallback. Fixture: curated per-ticker JSON.
 */
import { handler } from "@flow-state-dev/core";
import { resolveToolPayload } from "../runtime/resolve";
import { fetchEdgarBalanceSheet } from "../providers/edgar";
import { fetchYahooBalanceSheet } from "../providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_balance_sheet = handler({
  name: "get_balance_sheet",
  description: "Latest balance sheet for a ticker (totals only).",
  inputSchema: toolInputSchemas.get_balance_sheet,
  outputSchema: toolOutputSchemas.get_balance_sheet,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_balance_sheet", input, ctx, async () => {
      // EDGAR first (authoritative, no key); Yahoo backstops non-US filers and
      // EDGAR outages; empty payload only when both fail.
      try {
        return await fetchEdgarBalanceSheet(input);
      } catch {}
      try {
        return await fetchYahooBalanceSheet(input);
      } catch {}
      return emptyPayload("get_balance_sheet", input);
    });
  },
});
