/**
 * Latest balance sheet (totals only). Live: SEC EDGAR companyfacts
 * (authoritative US filings) preferred, Yahoo `fundamentals-timeseries`
 * fallback. Fixture: curated per-ticker JSON.
 */
import { handler } from "@flow-state-dev/core";
import { loadFixture } from "../runtime/fixtures";
import { fetchEdgarBalanceSheet } from "../providers/edgar";
import { fetchYahooBalanceSheet } from "../providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";
import { financialsDataResource } from "../../financials-data-resource";

export const get_balance_sheet = handler({
  name: "get_balance_sheet",
  description: "Latest balance sheet for a ticker (totals only).",
  inputSchema: toolInputSchemas.get_balance_sheet,
  outputSchema: toolOutputSchemas.get_balance_sheet,
  resources: { financialsData: financialsDataResource },
  // Write-through to the session financials spine (see get_fundamentals).
  execute: async (input, ctx) => {
    const mode = pickMode(ctx);
    const loadBalanceSheet = async () => {
      if (mode === "fixture") return loadFixture("get_balance_sheet", input);
      // EDGAR first (authoritative, no key); Yahoo backstops non-US filers and
      // EDGAR outages; empty payload only when both fail.
      try {
        return await fetchEdgarBalanceSheet(input);
      } catch {}
      try {
        return await fetchYahooBalanceSheet(input);
      } catch {}
      return emptyPayload("get_balance_sheet", input);
    };
    // Subject-only spine guard (see get_fundamentals).
    if (input.ticker !== (ctx.session.state as { ticker?: string }).ticker) {
      return loadBalanceSheet();
    }
    return (await ctx.resources.financialsData.getOrPatchState("balanceSheet", loadBalanceSheet))!;
  },
});
