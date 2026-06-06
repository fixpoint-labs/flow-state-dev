/**
 * Discovery handler for the Company Profile analyst. Surfaces up to 5
 * recent web pages with material strategic / regulatory / product context
 * the structured profile fields don't capture. When non-empty, lets the
 * analyst add a "Recent context" body section grounded in fetched URLs.
 * See `discover_fundamentals_context.ts` for the discipline.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../runtime/cache";
import { discoverWeb, PROFILE_QUERY } from "../runtime/discover";
import { loadFixture } from "../runtime/fixtures";
import { emptyPayload, skippedDiscoveryPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_profile_context = handler({
  name: "discover_profile_context",
  description:
    "Surface up to 5 recent web pages with material strategic, " +
    "product, or regulatory context for the given ticker.",
  inputSchema: toolInputSchemas.discover_profile_context,
  outputSchema: toolOutputSchemas.discover_profile_context,
  execute: async (input, ctx) => {
    if (ctx.session.state.costPreset !== "full") {
      return skippedDiscoveryPayload("discover_profile_context", input);
    }
    if (pickMode(ctx) === "fixture") {
      return loadFixture("discover_profile_context", input);
    }
    return getOrFetch("discover_profile_context", input, async () => {
      try {
        return await discoverWeb({
          ticker: input.ticker,
          date: input.date,
          queryTemplate: PROFILE_QUERY,
        });
      } catch {
        return emptyPayload("discover_profile_context", input);
      }
    });
  },
});
