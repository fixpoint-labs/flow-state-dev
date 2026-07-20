/**
 * SEC filings data tool — latest periodic filing highlights, recent filing
 * list, and red-flag probes via EDGAR EFTS full-text search. Keyless
 * (EDGAR is free and requires only a User-Agent).
 */
import { handler } from "@flow-state-dev/core";
import { resolveToolPayload } from "../runtime/resolve";
import { fetchEdgarFilings } from "@/lib/providers/edgar-filings";
import { emptyPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_sec_filings = handler({
  name: "get_sec_filings",
  description:
    "Fetch the latest SEC filings for a ticker: recent periodic filing list " +
    "(10-K, 10-Q, 8-K), registration/prospectus primaries (S-1, 424B*, F-1) " +
    "which carry a newly listed issuer's audited financials, extracted risk " +
    "factors and MD&A from the latest periodic filing, and red-flag probes " +
    "(going concern, material weakness, restatement, covenant, litigation, dilution).",
  inputSchema: toolInputSchemas.get_sec_filings,
  outputSchema: toolOutputSchemas.get_sec_filings,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_sec_filings", input, ctx, async () => {
      try {
        return await fetchEdgarFilings(input.ticker, input.date);
      } catch {
        return emptyPayload("get_sec_filings", input);
      }
    });
  },
});
