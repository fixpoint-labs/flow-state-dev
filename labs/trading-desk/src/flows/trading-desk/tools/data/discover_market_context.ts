/**
 * Discovery handler for the Market Analyst. Surfaces up to 5 web pages
 * about the name's sector outlook, peer activity, theme rotation, and
 * sector-specific regulatory / supply-chain context. Gated by costPreset
 * like the other discovery tools.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../runtime/cache";
import { discoverWeb, MARKET_QUERY } from "../runtime/discover";
import { loadFixture } from "../runtime/fixtures";
import { emptyPayload, skippedDiscoveryPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_market_context = handler({
  name: "discover_market_context",
  description:
    "Surface up to 5 recent web pages with sector outlook, peer " +
    "activity, theme rotation, and sector-specific regulatory or " +
    "supply-chain context for the given ticker.",
  inputSchema: toolInputSchemas.discover_market_context,
  outputSchema: toolOutputSchemas.discover_market_context,
  execute: async (input, ctx) => {
    if (ctx.session.state.costPreset !== "full") {
      return skippedDiscoveryPayload("discover_market_context", input);
    }
    if (pickMode(ctx) === "fixture") {
      return loadFixture("discover_market_context", input);
    }
    return getOrFetch("discover_market_context", input, async () => {
      try {
        return await discoverWeb({
          ticker: input.ticker,
          date: input.date,
          queryTemplate: MARKET_QUERY,
        });
      } catch {
        return emptyPayload("discover_market_context", input);
      }
    });
  },
});
