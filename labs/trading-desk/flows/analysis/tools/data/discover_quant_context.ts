/**
 * Discovery handler for the Quant Analyst. Surfaces up to 5 web pages
 * about factor investing, quant signals, and statistical risk models
 * relevant to the given ticker. Gated by costPreset like the other
 * discovery tools.
 */
import { handler } from "@flow-state-dev/core";
import { discoverWeb, QUANT_QUERY } from "../runtime/discover";
import { resolveToolPayload } from "../runtime/resolve";
import { emptyPayload, skippedDiscoveryPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_quant_context = handler({
  name: "discover_quant_context",
  description:
    "Surface up to 5 recent web pages with factor-investing commentary, " +
    "quant signals, and statistical risk-model data relevant to the " +
    "given ticker.",
  inputSchema: toolInputSchemas.discover_quant_context,
  outputSchema: toolOutputSchemas.discover_quant_context,
  execute: async (input, ctx) => {
    if (ctx.session.state.costPreset !== "full") {
      return skippedDiscoveryPayload("discover_quant_context", input);
    }
    return resolveToolPayload("discover_quant_context", input, ctx, async () => {
      try {
        return await discoverWeb({
          ticker: input.ticker,
          date: input.date,
          queryTemplate: QUANT_QUERY,
        });
      } catch {
        return emptyPayload("discover_quant_context", input);
      }
    });
  },
});
