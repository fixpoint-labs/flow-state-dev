/**
 * Institutional-ownership handler: 13F-derived holder set with the
 * accumulation / distribution read, from Finnhub `/stock/ownership`
 * (premium-gated on some plans). Honest degradation — when the key is absent or
 * Finnhub can't answer, returns the `source: "unavailable"` empty payload
 * rather than fabricating positioning. Never falls back to fixture data in live
 * mode (BP-020).
 */
import { handler } from "@flow-state-dev/core";
import { resolveToolPayload } from "../runtime/resolve";
import {
  fetchFinnhubInstitutionalOwnership,
  hasFinnhubKey,
} from "../providers/finnhub";
import { emptyPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_institutional_ownership = handler({
  name: "get_institutional_ownership",
  description:
    "Institutional ownership (13F-derived, from Finnhub): holder count, " +
    "total shares held, net quarter-over-quarter share change, and the " +
    "accumulation/distribution direction. Quarterly, ~45-day lag.",
  inputSchema: toolInputSchemas.get_institutional_ownership,
  outputSchema: toolOutputSchemas.get_institutional_ownership,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_institutional_ownership", input, ctx, async () => {
      if (!hasFinnhubKey()) return emptyPayload("get_institutional_ownership", input);
      try {
        return await fetchFinnhubInstitutionalOwnership(input);
      } catch {
        return emptyPayload("get_institutional_ownership", input);
      }
    });
  },
});
