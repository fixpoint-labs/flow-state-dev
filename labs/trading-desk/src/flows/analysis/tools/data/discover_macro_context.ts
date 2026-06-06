/**
 * Discovery handler for the Macro Analyst. Surfaces up to 5 web pages
 * about global economic conditions, geopolitical risk, trade policy, and
 * central-bank posture relevant to the given ticker. Gated by costPreset
 * like the other discovery tools.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../runtime/cache";
import { discoverWeb, MACRO_QUERY } from "../runtime/discover";
import { loadFixture } from "../runtime/fixtures";
import { emptyPayload, skippedDiscoveryPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_macro_context = handler({
  name: "discover_macro_context",
  description:
    "Surface up to 5 recent web pages with global economic outlook, " +
    "geopolitical risk, trade/tariff policy, and central-bank posture " +
    "relevant to the given ticker.",
  inputSchema: toolInputSchemas.discover_macro_context,
  outputSchema: toolOutputSchemas.discover_macro_context,
  execute: async (input, ctx) => {
    if (ctx.session.state.costPreset !== "full") {
      return skippedDiscoveryPayload("discover_macro_context", input);
    }
    if (pickMode(ctx) === "fixture") {
      return loadFixture("discover_macro_context", input);
    }
    return getOrFetch("discover_macro_context", input, async () => {
      try {
        return await discoverWeb({
          ticker: input.ticker,
          date: input.date,
          queryTemplate: MACRO_QUERY,
        });
      } catch {
        return emptyPayload("discover_macro_context", input);
      }
    });
  },
});
