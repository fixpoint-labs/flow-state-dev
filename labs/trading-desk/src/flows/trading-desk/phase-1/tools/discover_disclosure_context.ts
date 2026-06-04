/**
 * Discovery handler for the Disclosure Analyst. Surfaces up to 5 web pages
 * about SEC filings, earnings guidance, analyst coverage, and disclosure
 * events relevant to the given ticker. Gated by costPreset like the other
 * discovery tools.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../lib/cache";
import { discoverWeb, DISCLOSURE_QUERY } from "../../lib/discover";
import { loadFixture } from "../../lib/fixtures";
import { emptyPayload, skippedDiscoveryPayload } from "./empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "./schemas";

export const discover_disclosure_context = handler({
  name: "discover_disclosure_context",
  description:
    "Surface up to 5 recent web pages with SEC filing highlights, " +
    "earnings guidance, analyst coverage, and disclosure events " +
    "relevant to the given ticker.",
  inputSchema: toolInputSchemas.discover_disclosure_context,
  outputSchema: toolOutputSchemas.discover_disclosure_context,
  execute: async (input, ctx) => {
    if (ctx.session.state.costPreset !== "full") {
      return skippedDiscoveryPayload("discover_disclosure_context", input);
    }
    if (pickMode(ctx) === "fixture") {
      return loadFixture("discover_disclosure_context", input);
    }
    return getOrFetch("discover_disclosure_context", input, async () => {
      try {
        return await discoverWeb({
          ticker: input.ticker,
          date: input.date,
          queryTemplate: DISCLOSURE_QUERY,
        });
      } catch {
        return emptyPayload("discover_disclosure_context", input);
      }
    });
  },
});
