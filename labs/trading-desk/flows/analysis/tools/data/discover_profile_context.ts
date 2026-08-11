/**
 * Discovery handler for the Company Profile analyst. Surfaces up to 5
 * recent web pages with material strategic / regulatory / product context
 * the structured profile fields don't capture. When non-empty, lets the
 * analyst add a "Recent context" body section grounded in fetched URLs.
 * See `discover_fundamentals_context.ts` for the discipline.
 *
 * Entity-scoped: another company's announcement is not this company's news —
 * the failure mode this check exists for (FIX-779).
 */
import { handler } from "@flow-state-dev/core";
import { PROFILE_QUERY, runDiscovery } from "../runtime/discover";
import { profileDataResource } from "../../profile-data-resource";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_profile_context = handler({
  name: "discover_profile_context",
  description:
    "Surface up to 5 recent web pages with material strategic, " +
    "product, or regulatory context for the given ticker.",
  inputSchema: toolInputSchemas.discover_profile_context,
  outputSchema: toolOutputSchemas.discover_profile_context,
  resources: { profileData: profileDataResource },
  execute: (input, ctx) =>
    runDiscovery({
      tool: "discover_profile_context",
      input,
      ctx,
      queryTemplate: PROFILE_QUERY,
    }),
});
