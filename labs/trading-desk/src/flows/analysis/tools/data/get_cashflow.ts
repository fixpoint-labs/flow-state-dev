/**
 * Trailing cash-flow statement. Live: SEC EDGAR companyfacts (authoritative
 * US filings) preferred, Yahoo `fundamentals-timeseries` fallback. FCF =
 * operating − capex (EDGAR reports capex as a positive outflow; the Yahoo
 * mapper handles its own sign convention). Fixture: curated per-ticker JSON.
 */
import { handler } from "@flow-state-dev/core";
import { loadFixture } from "../runtime/fixtures";
import { fetchEdgarCashflow } from "../providers/edgar";
import { fetchYahooCashflow } from "../providers/yahoo";
import { emptyPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";
import { financialsDataResource } from "../../financials-data-resource";

export const get_cashflow = handler({
  name: "get_cashflow",
  description: "Trailing cash-flow statement for a ticker.",
  inputSchema: toolInputSchemas.get_cashflow,
  outputSchema: toolOutputSchemas.get_cashflow,
  resources: { financialsData: financialsDataResource },
  // Write-through to the session financials spine (see get_fundamentals).
  execute: async (input, ctx) => {
    const mode = pickMode(ctx);
    const loadCashflow = async () => {
      if (mode === "fixture") return loadFixture("get_cashflow", input);
      // EDGAR first (authoritative, no key); Yahoo backstops non-US filers and
      // EDGAR outages; empty payload only when both fail.
      try {
        return await fetchEdgarCashflow(input);
      } catch {}
      try {
        return await fetchYahooCashflow(input);
      } catch {}
      return emptyPayload("get_cashflow", input);
    };
    // Subject-only spine guard (see get_fundamentals).
    if (input.ticker !== (ctx.session.state as { ticker?: string }).ticker) {
      return loadCashflow();
    }
    const payload = await ctx.resources.financialsData.getOrPatchState("cashflow", loadCashflow);
    return payload!;
  },
});
