/**
 * SEC filings data tool — latest periodic filing highlights, recent filing
 * list, and red-flag probes via EDGAR EFTS full-text search. Keyless
 * (EDGAR is free and requires only a User-Agent).
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../runtime/cache";
import { loadFixture } from "../runtime/fixtures";
import { fetchEdgarFilings } from "../providers/edgar-filings";
import { emptyPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_sec_filings = handler({
  name: "get_sec_filings",
  description:
    "Fetch the latest SEC filings (10-K, 10-Q, 8-K) for a ticker: " +
    "recent filing list, extracted risk factors and MD&A from the latest " +
    "periodic filing, and red-flag probes (going concern, material weakness, " +
    "restatement, covenant, litigation, dilution).",
  inputSchema: toolInputSchemas.get_sec_filings,
  outputSchema: toolOutputSchemas.get_sec_filings,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") {
      return loadFixture("get_sec_filings", input);
    }
    return getOrFetch("get_sec_filings", input, async () => {
      try {
        return await fetchEdgarFilings(input.ticker, input.date);
      } catch {
        return emptyPayload("get_sec_filings", input);
      }
    });
  },
});
