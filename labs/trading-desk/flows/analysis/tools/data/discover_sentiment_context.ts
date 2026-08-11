/**
 * Discovery handler for the Sentiment analyst. Surfaces up to 5 web pages
 * with retail-investor / forum chatter context. See
 * `discover_fundamentals_context.ts` for the discipline (cost-preset
 * short-circuit before fixture branch; live failure stays "unavailable").
 *
 * Entity-scoped: chatter about a different issuer is not this name's sentiment.
 */
import { handler } from "@flow-state-dev/core";
import { runDiscovery, SENTIMENT_QUERY } from "../runtime/discover";
import { profileDataResource } from "../../profile-data-resource";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_sentiment_context = handler({
  name: "discover_sentiment_context",
  description:
    "Surface up to 5 recent web pages with retail-investor sentiment " +
    "context (forum chatter, analyst commentary) for the given ticker.",
  inputSchema: toolInputSchemas.discover_sentiment_context,
  outputSchema: toolOutputSchemas.discover_sentiment_context,
  resources: { profileData: profileDataResource },
  execute: (input, ctx) =>
    runDiscovery({
      tool: "discover_sentiment_context",
      input,
      ctx,
      queryTemplate: SENTIMENT_QUERY,
    }),
});
