/**
 * Trailing income statement. Live: Yahoo `incomeStatementHistory` module
 * (YoY revenue growth computed locally from the two latest periods).
 * Fixture: curated NVDA JSON.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../services/cache";
import { loadFixture } from "../../services/fixtures";
import { fetchYahooIncomeStatement } from "../../services/yahoo";
import { emptyPayload } from "./empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "./schemas";

export const get_income_statement = handler({
  name: "get_income_statement",
  description: "Trailing income statement for a ticker.",
  inputSchema: toolInputSchemas.get_income_statement,
  outputSchema: toolOutputSchemas.get_income_statement,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_income_statement", input);
    return getOrFetch("get_income_statement", input, async () => {
      try {
        return await fetchYahooIncomeStatement(input);
      } catch {
        return emptyPayload("get_income_statement", input);
      }
    });
  },
});
