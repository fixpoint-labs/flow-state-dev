/**
 * Discovery handler for the Fundamentals analyst. Produces up to 5
 * numbered web-search results the analyst may optionally read via `fetch`
 * for material context the structured fundamentals data does not capture
 * (e.g. recent guidance change, segment mix shift, accounting note).
 *
 * Entity-scoped: the query is about the company, so a result that names a
 * different issuer is dropped by the entity check (FIX-779).
 *
 * The cost gate, mode dispatch, and entity check live in `runDiscovery`.
 */
import { handler } from "@flow-state-dev/core";
import { FUNDAMENTALS_QUERY, runDiscovery } from "../runtime/discover";
import { profileDataResource } from "../../profile-data-resource";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_fundamentals_context = handler({
  name: "discover_fundamentals_context",
  description:
    "Surface up to 5 recent web pages with fundamentals context " +
    "(earnings color, guidance, business-mix shifts) for the given ticker.",
  inputSchema: toolInputSchemas.discover_fundamentals_context,
  outputSchema: toolOutputSchemas.discover_fundamentals_context,
  resources: { profileData: profileDataResource },
  execute: (input, ctx) =>
    runDiscovery({
      tool: "discover_fundamentals_context",
      input,
      ctx,
      queryTemplate: FUNDAMENTALS_QUERY,
    }),
});
