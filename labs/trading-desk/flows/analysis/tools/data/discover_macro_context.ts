/**
 * Discovery handler for the Macro Analyst. Surfaces up to 5 web pages
 * about global economic conditions, geopolitical risk, trade policy, and
 * central-bank posture relevant to the given ticker. Gated by costPreset
 * like the other discovery tools.
 *
 * NOT entity-scoped (FIX-779): a rates or tariff-policy piece is relevant to
 * the name without ever naming it, so the entity check would drop the whole
 * payload. Tagged `entityCheck: "not-applicable"` instead, so the analyst
 * reads these as environment context rather than evidence about the subject.
 */
import { handler } from "@flow-state-dev/core";
import { MACRO_QUERY, runDiscovery } from "../runtime/discover";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_macro_context = handler({
  name: "discover_macro_context",
  description:
    "Surface up to 5 recent web pages with global economic outlook, " +
    "geopolitical risk, trade/tariff policy, and central-bank posture " +
    "relevant to the given ticker.",
  inputSchema: toolInputSchemas.discover_macro_context,
  outputSchema: toolOutputSchemas.discover_macro_context,
  execute: (input, ctx) =>
    runDiscovery({
      tool: "discover_macro_context",
      input,
      ctx,
      queryTemplate: MACRO_QUERY,
      entityScoped: false,
    }),
});
