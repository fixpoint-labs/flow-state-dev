/**
 * Discovery handler for the Disclosure Analyst. Surfaces up to 5 web pages
 * about SEC filings, earnings guidance, analyst coverage, and disclosure
 * events relevant to the given ticker. Gated by costPreset like the other
 * discovery tools.
 *
 * Entity-scoped: a filing or transcript belongs to one issuer. This is the
 * exact contamination FIX-779 was filed on — a "Black Hills" earnings-call
 * transcript reaching the fundamentals analyst's context for another ticker.
 */
import { handler } from "@flow-state-dev/core";
import { DISCLOSURE_QUERY, runDiscovery } from "../runtime/discover";
import { profileDataResource } from "../../profile-data-resource";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_disclosure_context = handler({
  name: "discover_disclosure_context",
  description:
    "Surface up to 5 recent web pages with SEC filing highlights, " +
    "earnings guidance, analyst coverage, and disclosure events " +
    "relevant to the given ticker.",
  inputSchema: toolInputSchemas.discover_disclosure_context,
  outputSchema: toolOutputSchemas.discover_disclosure_context,
  resources: { profileData: profileDataResource },
  execute: (input, ctx) =>
    runDiscovery({
      tool: "discover_disclosure_context",
      input,
      ctx,
      queryTemplate: DISCLOSURE_QUERY,
    }),
});
