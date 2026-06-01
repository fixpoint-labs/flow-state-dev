/**
 * Trailing cash-flow statement. Live: SEC EDGAR companyfacts (authoritative
 * US filings) preferred, Yahoo `fundamentals-timeseries` fallback. FCF =
 * operating − capex (EDGAR reports capex as a positive outflow; the Yahoo
 * mapper handles its own sign convention). Fixture: curated per-ticker JSON.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../lib/cache";
import { loadFixture } from "../../lib/fixtures";
import { fetchEdgarCashflow } from "../../providers/edgar";
import { fetchYahooCashflow } from "../../providers/yahoo";
import { emptyPayload } from "./empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "./schemas";

export const get_cashflow = handler({
  name: "get_cashflow",
  description: "Trailing cash-flow statement for a ticker.",
  inputSchema: toolInputSchemas.get_cashflow,
  outputSchema: toolOutputSchemas.get_cashflow,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_cashflow", input);
    return getOrFetch("get_cashflow", input, async () => {
      // EDGAR first (authoritative, no key); Yahoo backstops non-US filers and
      // EDGAR outages; empty payload only when both fail.
      try {
        return await fetchEdgarCashflow(input);
      } catch {}
      try {
        return await fetchYahooCashflow(input);
      } catch {}
      return emptyPayload("get_cashflow", input);
    });
  },
});
