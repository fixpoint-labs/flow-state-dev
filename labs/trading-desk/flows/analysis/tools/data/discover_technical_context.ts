/**
 * Discovery handler for the Technical analyst. Surfaces up to 5 web pages
 * with chart/setup commentary that may reframe the indicator readings.
 * See `discover_fundamentals_context.ts` for the discipline.
 *
 * Entity-scoped: a chart read of a different name is not this name's setup.
 */
import { handler } from "@flow-state-dev/core";
import { runDiscovery, TECHNICAL_QUERY } from "../runtime/discover";
import { profileDataResource } from "../../profile-data-resource";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_technical_context = handler({
  name: "discover_technical_context",
  description:
    "Surface up to 5 recent web pages with technical-analysis context " +
    "(chart structure, support/resistance, breakout calls) for the ticker.",
  inputSchema: toolInputSchemas.discover_technical_context,
  outputSchema: toolOutputSchemas.discover_technical_context,
  resources: { profileData: profileDataResource },
  execute: (input, ctx) =>
    runDiscovery({
      tool: "discover_technical_context",
      input,
      ctx,
      queryTemplate: TECHNICAL_QUERY,
    }),
});
