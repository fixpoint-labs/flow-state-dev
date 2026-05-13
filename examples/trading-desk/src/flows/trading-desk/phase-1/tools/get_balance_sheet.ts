/**
 * Latest balance sheet (totals only). Live: Yahoo `balanceSheetHistory`
 * module. Fixture: curated NVDA JSON.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../services/cache";
import { loadFixture } from "../../services/fixtures";
import { fetchYahooBalanceSheet } from "../../services/yahoo";
import { emptyPayload } from "./empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "./schemas";

export const get_balance_sheet = handler({
  name: "get_balance_sheet",
  description: "Latest balance sheet for a ticker (totals only).",
  inputSchema: toolInputSchemas.get_balance_sheet,
  outputSchema: toolOutputSchemas.get_balance_sheet,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_balance_sheet", input);
    return getOrFetch("get_balance_sheet", input, async () => {
      try {
        return await fetchYahooBalanceSheet(input);
      } catch {
        return emptyPayload("get_balance_sheet", input);
      }
    });
  },
});
