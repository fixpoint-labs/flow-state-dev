/**
 * Discovery handler for the Technical analyst. Surfaces up to 5 web pages
 * with chart/setup commentary that may reframe the indicator readings.
 * See `discover_fundamentals_context.ts` for the discipline.
 */
import { handler } from "@flow-state-dev/core";
import { analysisCache } from "../../../shared/cache-capability";
import { discoverWeb, TECHNICAL_QUERY } from "../runtime/discover";
import { loadFixture } from "../runtime/fixtures";
import { emptyPayload, skippedDiscoveryPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_technical_context = handler({
  name: "discover_technical_context",
  description:
    "Surface up to 5 recent web pages with technical-analysis context " +
    "(chart structure, support/resistance, breakout calls) for the ticker.",
  inputSchema: toolInputSchemas.discover_technical_context,
  outputSchema: toolOutputSchemas.discover_technical_context,
  uses: [analysisCache],
  execute: async (input, ctx) => {
    if (ctx.session.state.costPreset !== "full") {
      return skippedDiscoveryPayload("discover_technical_context", input);
    }
    if (pickMode(ctx) === "fixture") {
      return loadFixture("discover_technical_context", input);
    }
    return ctx.cap.cache.getOrFetch("discover_technical_context", input, async () => {
      try {
        return await discoverWeb({
          ticker: input.ticker,
          date: input.date,
          queryTemplate: TECHNICAL_QUERY,
        });
      } catch {
        return emptyPayload("discover_technical_context", input);
      }
    });
  },
});
