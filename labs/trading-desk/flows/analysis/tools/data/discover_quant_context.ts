/**
 * Discovery handler for the Quant Analyst. Surfaces up to 5 web pages
 * about factor investing, quant signals, and statistical risk models
 * relevant to the given ticker. Gated by costPreset like the other
 * discovery tools.
 *
 * Entity-scoped: a positioning or short-interest read is about a specific
 * name, so a result naming a different issuer is dropped (FIX-779).
 */
import { handler } from "@flow-state-dev/core";
import { QUANT_QUERY, runDiscovery } from "../runtime/discover";
import { profileDataResource } from "../../profile-data-resource";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_quant_context = handler({
  name: "discover_quant_context",
  description:
    "Surface up to 5 recent web pages with factor-investing commentary, " +
    "quant signals, and statistical risk-model data relevant to the " +
    "given ticker.",
  inputSchema: toolInputSchemas.discover_quant_context,
  outputSchema: toolOutputSchemas.discover_quant_context,
  resources: { profileData: profileDataResource },
  execute: (input, ctx) =>
    runDiscovery({
      tool: "discover_quant_context",
      input,
      ctx,
      queryTemplate: QUANT_QUERY,
    }),
});
