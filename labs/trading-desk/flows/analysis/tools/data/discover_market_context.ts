/**
 * Discovery handler for the Market Analyst. Surfaces up to 5 web pages
 * about the name's sector outlook, peer activity, theme rotation, and
 * sector-specific regulatory / supply-chain context. Gated by costPreset
 * like the other discovery tools.
 *
 * NOT entity-scoped (FIX-779): the query deliberately asks about the sector,
 * the peers, and the theme around this name, so a good result frequently never
 * names the subject. Filtering on entity identity here would drop exactly the
 * peer and sector context the analyst was sent to find. The payload is tagged
 * `entityCheck: "not-applicable"` so the analyst reads these as environment
 * context, never as evidence about the subject itself.
 */
import { handler } from "@flow-state-dev/core";
import { MARKET_QUERY, runDiscovery } from "../runtime/discover";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_market_context = handler({
  name: "discover_market_context",
  description:
    "Surface up to 5 recent web pages with sector outlook, peer " +
    "activity, theme rotation, and sector-specific regulatory or " +
    "supply-chain context for the given ticker.",
  inputSchema: toolInputSchemas.discover_market_context,
  outputSchema: toolOutputSchemas.discover_market_context,
  execute: (input, ctx) =>
    runDiscovery({
      tool: "discover_market_context",
      input,
      ctx,
      queryTemplate: MARKET_QUERY,
      entityScoped: false,
    }),
});
