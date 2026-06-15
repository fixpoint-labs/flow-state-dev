/**
 * Trailing income statement. Live: SEC EDGAR companyfacts (authoritative US
 * filings) preferred, Yahoo `fundamentals-timeseries` fallback (Yahoo also
 * supplies YoY revenue growth from its two latest annual periods; EDGAR
 * leaves YoY null). Fixture: curated per-ticker JSON.
 */
import { handler } from "@flow-state-dev/core";
import { loadFixture } from "../runtime/fixtures";
import { fetchEdgarIncomeStatement } from "../providers/edgar";
import { fetchYahooIncomeStatement } from "../providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";
import { financialsDataResource } from "../../financials-data-resource";

export const get_income_statement = handler({
  name: "get_income_statement",
  description: "Trailing income statement for a ticker.",
  inputSchema: toolInputSchemas.get_income_statement,
  outputSchema: toolOutputSchemas.get_income_statement,
  resources: { financialsData: financialsDataResource },
  // Write-through to the session financials spine (see get_fundamentals).
  execute: async (input, ctx) => {
    const mode = pickMode(ctx);
    const payload = await ctx.resources.financialsData.getOrPatchState("incomeStatement", async () => {
      if (mode === "fixture") return loadFixture("get_income_statement", input);
      // EDGAR first (authoritative, no key); Yahoo backstops non-US filers and
      // EDGAR outages; empty payload only when both fail.
      try {
        return await fetchEdgarIncomeStatement(input);
      } catch {}
      try {
        return await fetchYahooIncomeStatement(input);
      } catch {}
      return emptyPayload("get_income_statement", input);
    });
    return payload!;
  },
});
