/**
 * Trailing cash-flow statement. Live: Yahoo `cashflowStatementHistory`
 * module (FCF = operating + capex, with capex reported as a negative).
 * Fixture: curated NVDA JSON.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../lib/cache";
import { loadFixture } from "../../lib/fixtures";
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
      try {
        return await fetchYahooCashflow(input);
      } catch {
        return emptyPayload("get_cashflow", input);
      }
    });
  },
});
