/**
 * Discovery handler for the Fundamentals analyst. Produces up to 5
 * numbered web-search results the analyst may optionally read via `fetch`
 * for material context the structured fundamentals data does not capture
 * (e.g. recent guidance change, segment mix shift, accounting note).
 *
 * Gating: the tool short-circuits to `skippedDiscoveryPayload` when
 * `costPreset !== "full"` — this is the second of two coordinated cost-
 * preset seams (the `investigate` capability preset is the first; it
 * removes the `fetch` tool and INVESTIGATION_CLAUSE on cheap runs). The
 * cost gate fires BEFORE the fixture-mode branch deliberately: a
 * fixture-mode regression run on the `fast` preset should observe the
 * same no-op investigation that a live run would, not a fixture load.
 *
 * Per BP-020 the live branch never falls back to fixture data — a search
 * provider failure tags the result `"unavailable"` so the analyst sees
 * the gap honestly.
 */
import { handler } from "@flow-state-dev/core";
import { discoverWeb, FUNDAMENTALS_QUERY } from "../runtime/discover";
import { resolveToolPayload } from "../runtime/resolve";
import { emptyPayload, skippedDiscoveryPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const discover_fundamentals_context = handler({
  name: "discover_fundamentals_context",
  description:
    "Surface up to 5 recent web pages with fundamentals context " +
    "(earnings color, guidance, business-mix shifts) for the given ticker.",
  inputSchema: toolInputSchemas.discover_fundamentals_context,
  outputSchema: toolOutputSchemas.discover_fundamentals_context,
  execute: async (input, ctx) => {
    if (ctx.session.state.costPreset !== "full") {
      return skippedDiscoveryPayload("discover_fundamentals_context", input);
    }
    return resolveToolPayload("discover_fundamentals_context", input, ctx, async () => {
      try {
        return await discoverWeb({
          ticker: input.ticker,
          date: input.date,
          queryTemplate: FUNDAMENTALS_QUERY,
        });
      } catch {
        return emptyPayload("discover_fundamentals_context", input);
      }
    });
  },
});
