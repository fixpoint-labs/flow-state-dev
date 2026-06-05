/**
 * Discovery handler for the Sentiment analyst. Surfaces up to 5 web pages
 * with retail-investor / forum chatter context. See
 * `discover_fundamentals_context.ts` for the discipline (cost-preset
 * short-circuit before fixture branch; live failure stays "unavailable").
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../runtime/cache";
import { discoverWeb, SENTIMENT_QUERY } from "../runtime/discover";
import { loadFixture } from "../runtime/fixtures";
import { emptyPayload, skippedDiscoveryPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_sentiment_context = handler({
  name: "discover_sentiment_context",
  description:
    "Surface up to 5 recent web pages with retail-investor sentiment " +
    "context (forum chatter, analyst commentary) for the given ticker.",
  inputSchema: toolInputSchemas.discover_sentiment_context,
  outputSchema: toolOutputSchemas.discover_sentiment_context,
  execute: async (input, ctx) => {
    if (ctx.session.state.costPreset !== "full") {
      return skippedDiscoveryPayload("discover_sentiment_context", input);
    }
    if (pickMode(ctx) === "fixture") {
      return loadFixture("discover_sentiment_context", input);
    }
    return getOrFetch("discover_sentiment_context", input, async () => {
      try {
        return await discoverWeb({
          ticker: input.ticker,
          date: input.date,
          queryTemplate: SENTIMENT_QUERY,
        });
      } catch {
        return emptyPayload("discover_sentiment_context", input);
      }
    });
  },
});
