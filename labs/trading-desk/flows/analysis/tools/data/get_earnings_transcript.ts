/**
 * Earnings-call transcript data tool. Live: Alpha Vantage
 * `EARNINGS_CALL_TRANSCRIPT`, gated on `ALPHAVANTAGE_API_KEY` and resolved to
 * the latest reported fiscal quarter via an `EARNINGS` probe (FIX-798). Returns
 * `available: false` when no AV key is set or no transcript exists for the
 * resolved quarter. Fixture mode returns the fixture (which carries a sample
 * transcript).
 */
import { handler } from "@flow-state-dev/core";
import {
  fetchAlphaVantageEarningsTranscript,
  hasAlphaVantageKey,
} from "@/lib/providers/alpha-vantage";
import { resolveToolPayload } from "../runtime/resolve";
import { emptyPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_earnings_transcript = handler({
  name: "get_earnings_transcript",
  description:
    "Fetch the latest earnings-call transcript for a ticker. Uses Alpha " +
    "Vantage (ALPHAVANTAGE_API_KEY, free tier). Returns capped prepared " +
    "remarks + Q&A slice, or unavailable when no key or transcript exists.",
  inputSchema: toolInputSchemas.get_earnings_transcript,
  outputSchema: toolOutputSchemas.get_earnings_transcript,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_earnings_transcript", input, ctx, async () => {
      if (hasAlphaVantageKey()) {
        try { return await fetchAlphaVantageEarningsTranscript(input); } catch {}
      }
      return emptyPayload("get_earnings_transcript", input);
    });
  },
});
